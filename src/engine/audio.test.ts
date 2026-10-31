import { describe, expect, it } from "vitest";
import { dissectFile } from "./dissect";
import { arrayBufferOf } from "./util";
import { exportReconstruction } from "./export";
import {
  createAudioCloner,
  encodeWav,
  magnitudeSpectrum,
  parseWav,
} from "./audio";

function tone(length: number, sampleRate: number): Float32Array {
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    samples[i] =
      0.6 * Math.sin(2 * Math.PI * 440 * t) + 0.3 * Math.sin(2 * Math.PI * 880 * t);
  }
  return samples;
}

describe("audio cloner", () => {
  it("round-trips 16-bit PCM WAV", () => {
    const samples = tone(800, 8000);
    const wav = encodeWav(samples, 8000);
    const parsed = parseWav(wav);
    expect(parsed).not.toBeNull();
    expect(parsed?.sampleRate).toBe(8000);
    expect(parsed?.channels).toBe(1);
    expect(parsed?.samples.length).toBe(samples.length);
    let error = 0;
    for (let i = 0; i < samples.length; i++) {
      error = Math.max(error, Math.abs(parsed!.samples[i] - samples[i]));
    }
    expect(error).toBeLessThan(1 / 200);
  });

  it("puts a 440 Hz sine into a low spectrum bin", () => {
    const sampleRate = 8000;
    const samples = new Float32Array(1024);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }
    const spectrum = magnitudeSpectrum(samples, 32);
    expect(spectrum).toHaveLength(32);
    const peak = spectrum.indexOf(Math.max(...spectrum));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(8);
  });

  it("dissects a WAV as audio and exports a WAV reconstruction", async () => {
    const wav = encodeWav(tone(1600, 8000), 8000);
    const file = new File([arrayBufferOf(wav)], "tone.wav", { type: "audio/wav" });
    const artifact = await dissectFile(file);
    expect(artifact.kind).toBe("audio");
    expect(artifact.format).toBe("WAV");
    expect(artifact.audio?.sampleRate).toBe(8000);
    expect(artifact.audio?.waveform.length).toBeGreaterThan(8);
    expect(artifact.audio?.spectrum.length).toBeGreaterThan(4);

    const cloner = createAudioCloner(artifact);
    const coarse = cloner.materialize({ bands: 1, noise: 0.8, smooth: 1, gain: 0.6 });
    const fine = cloner.materialize({ bands: 24, noise: 0.02, smooth: 1, gain: 1 });
    expect(fine.score).toBeGreaterThan(coarse.score);
    expect(coarse.filename).toBe("tone-clone.wav");
    expect(coarse.mime).toBe("audio/wav");

    const exported = exportReconstruction("audio", artifact.name, fine);
    expect(exported.filename).toBe("tone-clone.wav");
    expect(exported.mime).toBe("audio/wav");
    expect(new TextDecoder().decode(exported.bytes.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(exported.bytes.subarray(8, 12))).toBe("WAVE");
    expect(fine.audioProfile?.waveform.length).toBeGreaterThan(8);
    expect(fine.audioProfile?.spectrum.length).toBeGreaterThan(4);
  });
});
