import type { Artifact, AudioInfo, Cloner, CloneOutput, Genome, Rng } from "./types";
import { baseName, clamp, mulberry32, num, percent, round, seedFromString } from "./util";

const PREVIEW = 48;
const BINS = 24;
const MAX_SAMPLES = 8192;

function readStr(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, Math.round(clamped * 32767), true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

export function parseWav(
  bytes: Uint8Array,
): { sampleRate: number; channels: number; samples: Float32Array } | null {
  if (bytes.length < 44) return null;
  if (readStr(bytes, 0, 4) !== "RIFF" || readStr(bytes, 8, 4) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let data: Uint8Array | null = null;
  while (offset + 8 <= bytes.length) {
    const id = readStr(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (size < 0 || start + size > bytes.length) break;
    if (id === "fmt ") {
      audioFormat = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      bits = view.getUint16(start + 14, true);
    } else if (id === "data") {
      data = bytes.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  if (!data || !channels || !sampleRate || audioFormat !== 1 || (bits !== 16 && bits !== 8)) {
    return null;
  }
  const width = bits / 8;
  const frames = Math.floor(data.length / (channels * width));
  const samples = new Float32Array(frames);
  const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      const pos = (i * channels + channel) * width;
      sum += bits === 16 ? dataView.getInt16(pos, true) / 32768 : (data[pos] - 128) / 128;
    }
    samples[i] = sum / channels;
  }
  return { sampleRate, channels, samples };
}

export function magnitudeSpectrum(samples: Float32Array, bins: number): number[] {
  const size = Math.min(samples.length, 1024);
  const start = Math.max(0, Math.floor((samples.length - size) / 2));
  const window = samples.subarray(start, start + size);
  const nyquist = Math.max(1, Math.floor(size / 2));
  const mags = new Array<number>(bins).fill(0);
  for (let bin = 0; bin < bins; bin++) {
    const k = Math.max(1, Math.round(((bin + 0.5) / bins) * nyquist));
    let real = 0;
    let imag = 0;
    for (let n = 0; n < window.length; n++) {
      const angle = (2 * Math.PI * k * n) / size;
      real += window[n] * Math.cos(angle);
      imag -= window[n] * Math.sin(angle);
    }
    mags[bin] = Math.hypot(real, imag) / Math.max(1, window.length);
  }
  const peak = Math.max(...mags, 1e-9);
  return mags.map((value) => value / peak);
}

function previewEnvelope(samples: ArrayLike<number>, count: number): number[] {
  const out: number[] = [];
  const size = Math.max(1, Math.floor(samples.length / count));
  for (let i = 0; i < count; i++) {
    let peak = 0;
    const start = i * size;
    const end = Math.min(samples.length, start + size);
    for (let j = start; j < end; j++) peak = Math.max(peak, Math.abs(samples[j] ?? 0));
    out.push(peak);
  }
  const max = Math.max(...out, 1e-9);
  return out.map((value) => value / max);
}

function rms(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += (samples[i] ?? 0) ** 2;
  return Math.sqrt(sum / samples.length);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let left = 0;
  let right = 0;
  const count = Math.min(a.length, b.length);
  for (let i = 0; i < count; i++) {
    dot += a[i] * b[i];
    left += a[i] * a[i];
    right += b[i] * b[i];
  }
  if (!left || !right) return 0;
  return dot / Math.sqrt(left * right);
}

export function audioInfoFromPcm(
  parsed: { sampleRate: number; channels: number; samples: Float32Array },
  format: string,
): AudioInfo {
  const stride = Math.max(1, Math.ceil(parsed.samples.length / MAX_SAMPLES));
  const samples: number[] = [];
  for (let i = 0; i < parsed.samples.length; i += stride) samples.push(parsed.samples[i]);
  const floats = Float32Array.from(samples);
  return {
    format,
    sampleRate: Math.max(1, Math.round(parsed.sampleRate / stride)),
    channels: parsed.channels,
    duration: parsed.samples.length / parsed.sampleRate,
    waveform: previewEnvelope(floats, Math.min(PREVIEW, Math.max(8, floats.length))),
    spectrum: magnitudeSpectrum(floats, BINS),
    samples,
    rms: rms(floats),
  };
}

export function looksLikeAudio(bytes: Uint8Array, name: string): boolean {
  if (parseWav(bytes)) return true;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return true;
  return /\.(wav|mp3|ogg|flac|m4a|aac)$/i.test(name);
}

export function audioFormatName(bytes: Uint8Array, name: string): string {
  if (parseWav(bytes)) return "WAV";
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "MP3";
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "MP3";
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1];
  return ext ? ext.toUpperCase() : "AUDIO";
}

export async function decodeWithWebAudio(
  bytes: Uint8Array,
): Promise<{ sampleRate: number; channels: number; samples: Float32Array } | null> {
  const Context =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  const context = new Context();
  try {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const decoded = await context.decodeAudioData(copy as ArrayBuffer);
    const length = decoded.length;
    const mixed = new Float32Array(length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < length; i++) mixed[i] += data[i] / decoded.numberOfChannels;
    }
    return { sampleRate: decoded.sampleRate, channels: decoded.numberOfChannels, samples: mixed };
  } catch {
    return null;
  } finally {
    await context.close();
  }
}

export async function readAudioFile(file: File, bytes: Uint8Array): Promise<AudioInfo | null> {
  const wav = parseWav(bytes);
  if (wav) return audioInfoFromPcm(wav, "WAV");
  const decoded = await decodeWithWebAudio(bytes);
  if (!decoded) return null;
  return audioInfoFromPcm(decoded, audioFormatName(bytes, file.name));
}

export function createAudioCloner(artifact: Artifact): Cloner {
  const info = artifact.audio;
  const source = Float32Array.from(info?.samples ?? []);
  const sourceSpectrum = info?.spectrum?.length ? info.spectrum : magnitudeSpectrum(source, BINS);
  const sourceWave = previewEnvelope(source, PREVIEW);
  const seed = seedFromString(artifact.hash || "audio", 3);
  const cache = new Map<string, { score: number; samples: Float32Array }>();
  const defaults: Genome = { bands: 2, noise: 0.45, smooth: 2, gain: 0.85 };

  function localEnvelope(samples: Float32Array, smooth: number): Float32Array {
    const out = new Float32Array(samples.length);
    const radius = smooth;
    for (let i = 0; i < samples.length; i++) {
      let peak = 0;
      const start = Math.max(0, i - radius);
      const end = Math.min(samples.length, i + radius + 1);
      for (let j = start; j < end; j++) peak = Math.max(peak, Math.abs(samples[j]));
      out[i] = peak;
    }
    return out;
  }

  function synthesize(genome: Genome): Float32Array {
    const bands = clamp(Math.round(num(genome, "bands", 2)), 1, BINS);
    const noise = clamp(num(genome, "noise", 0.45), 0, 1);
    const smooth = clamp(Math.round(num(genome, "smooth", 2)), 1, 12);
    const gain = clamp(num(genome, "gain", 0.85), 0.4, 1.4);
    const out = new Float32Array(source.length);
    const env = localEnvelope(source, smooth * 8);
    const rng = mulberry32(seed);
    for (let band = 0; band < bands; band++) {
      const amp = (sourceSpectrum[band] ?? 0) * gain;
      const k = Math.max(1, Math.round(((band + 0.5) / BINS) * (source.length / 2)));
      for (let i = 0; i < source.length; i++) {
        out[i] += amp * Math.sin((2 * Math.PI * k * i) / source.length);
      }
    }
    let peak = 0;
    for (let i = 0; i < source.length; i++) {
      const n = (rng() * 2 - 1) * noise;
      out[i] = out[i] * (0.25 + 0.75 * env[i]) + n * (0.15 + env[i]);
      peak = Math.max(peak, Math.abs(out[i]));
    }
    const target = Math.min(1, Math.max(...source.map(Math.abs), 0.2) * gain);
    if (peak > 0) {
      for (let i = 0; i < out.length; i++) out[i] = (out[i] / peak) * target;
    }
    return out;
  }

  function scoreOf(samples: Float32Array): number {
    if (!samples.length || !source.length) return 0;
    const specFit = cosine(sourceSpectrum, magnitudeSpectrum(samples, BINS));
    const waveFit = cosine(sourceWave, previewEnvelope(samples, PREVIEW));
    return round(clamp(0.68 * specFit + 0.32 * waveFit, 0, 1), 4);
  }

  const keyOf = (genome: Genome) =>
    [
      Math.round(num(genome, "bands", 2)),
      num(genome, "noise", 0.45).toFixed(2),
      Math.round(num(genome, "smooth", 2)),
      num(genome, "gain", 0.85).toFixed(2),
    ].join("|");

  function run(genome: Genome): { score: number; samples: Float32Array } {
    const key = keyOf(genome);
    const hit = cache.get(key);
    if (hit) return hit;
    const samples = synthesize(genome);
    const result = { score: scoreOf(samples), samples };
    cache.set(key, result);
    return result;
  }

  return {
    kind: "audio",
    defaults,
    evaluate(genome) {
      return run(genome).score;
    },
    materialize(genome): CloneOutput {
      const result = run(genome);
      const waveform = previewEnvelope(result.samples, PREVIEW);
      const spectrum = magnitudeSpectrum(result.samples, BINS);
      return {
        score: result.score,
        bytes: encodeWav(result.samples, info?.sampleRate || 8000),
        filename: `${baseName(artifact.name)}-clone.wav`,
        mime: "audio/wav",
        audioProfile: { waveform, spectrum },
        facts: [
          { label: "SAMPLE RATE", value: `${info?.sampleRate || 8000} Hz` },
          { label: "DURATION", value: `${(info?.duration ?? 0).toFixed(2)} s` },
          { label: "BANDS", value: `${clamp(Math.round(num(genome, "bands", 2)), 1, BINS)}` },
          { label: "RMS", value: percent(rms(result.samples), 1) },
        ],
      };
    },
    mutate(genome: Genome, rng: Rng) {
      const next: Genome = { ...genome };
      const roll = rng();
      let changed = "";
      if (roll < 0.46) {
        const current = clamp(Math.round(num(genome, "bands", 2)), 1, BINS);
        const updated = clamp(current + (rng() < 0.7 ? 2 : -2), 1, BINS);
        next.bands = updated;
        changed = `bands ${current} → ${updated}`;
      } else if (roll < 0.74) {
        const current = clamp(num(genome, "noise", 0.45), 0, 1);
        const updated = clamp(current + (rng() < 0.6 ? -0.12 : 0.12), 0, 1);
        next.noise = round(updated, 2);
        changed = `noise ${current.toFixed(2)} → ${updated.toFixed(2)}`;
      } else if (roll < 0.9) {
        const current = clamp(num(genome, "gain", 0.85), 0.4, 1.4);
        const updated = clamp(current + (rng() < 0.5 ? 0.08 : -0.08), 0.4, 1.4);
        next.gain = round(updated, 2);
        changed = `gain ${current.toFixed(2)} → ${updated.toFixed(2)}`;
      } else {
        const current = clamp(Math.round(num(genome, "smooth", 2)), 1, 12);
        const updated = clamp(current + (rng() < 0.5 ? 1 : -1), 1, 12);
        next.smooth = updated;
        changed = `smooth ${current} → ${updated}`;
      }
      return { genome: next, changed };
    },
    describe(genome) {
      const bands = clamp(Math.round(num(genome, "bands", 2)), 1, BINS);
      const noise = clamp(num(genome, "noise", 0.45), 0, 1);
      const smooth = clamp(Math.round(num(genome, "smooth", 2)), 1, 12);
      const gain = clamp(num(genome, "gain", 0.85), 0.4, 1.4);
      return [
        { key: "bands", label: "BANDS", value: `${bands}`, raw: bands, min: 1, max: BINS },
        { key: "noise", label: "NOISE", value: percent(noise, 0), raw: noise, min: 0, max: 1 },
        { key: "smooth", label: "ENVELOPE", value: `${smooth}`, raw: smooth, min: 1, max: 12 },
        { key: "gain", label: "GAIN", value: gain.toFixed(2), raw: gain, min: 0.4, max: 1.4 },
      ];
    },
    reflect(seedGenome, best, baseline, score) {
      return `Partial count moved ${Math.round(seedGenome.bands)} → ${Math.round(
        best.bands,
      )} and noise ${seedGenome.noise.toFixed(2)} → ${best.noise.toFixed(
        2,
      )}. Spectral match rose ${((score - baseline) * 100).toFixed(1)} points.`;
    },
  };
}
