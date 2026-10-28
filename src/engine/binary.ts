import type { Artifact, Cloner, CloneOutput, Genome, Rng } from "./types";
import {
  baseName,
  clamp,
  fmtBytes,
  mulberry32,
  num,
  percent,
  round,
  seedFromString,
} from "./util";

const BLOCK = 4096;

type Dist = Map<string, number>;

function shannon(bytes: Uint8Array): number {
  if (!bytes.length) return 0;
  const counts = new Uint32Array(256);
  for (let i = 0; i < bytes.length; i++) counts[bytes[i]]++;
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (!counts[i]) continue;
    const p = counts[i] / bytes.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function entropyBlocks(bytes: Uint8Array): number[] {
  const blocks: number[] = [];
  for (let offset = 0; offset < bytes.length; offset += BLOCK) {
    blocks.push(shannon(bytes.subarray(offset, offset + BLOCK)));
  }
  return blocks;
}

function histogram(bytes: Uint8Array): number[] {
  const counts = new Array<number>(256).fill(0);
  for (let i = 0; i < bytes.length; i++) counts[bytes[i]]++;
  return counts;
}

function gramSet(bytes: Uint8Array): Set<number> {
  const set = new Set<number>();
  for (let i = 0; i + 4 <= bytes.length; i++) {
    set.add(((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0);
  }
  return set;
}

function jaccard(a: Set<number>, b: Set<number>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

function histogramSimilarity(source: number[], clone: number[]): number {
  const totalSource = source.reduce((a, b) => a + b, 0);
  const totalClone = clone.reduce((a, b) => a + b, 0);
  if (!totalSource || !totalClone) return 0;
  let difference = 0;
  for (let i = 0; i < 256; i++) {
    difference += Math.abs(source[i] / totalSource - clone[i] / totalClone);
  }
  return clamp(1 - difference / 2, 0, 1);
}

function entropySimilarity(source: number[], clone: number[]): number {
  const count = Math.min(source.length, clone.length);
  if (!count) return 0;
  let difference = 0;
  for (let i = 0; i < count; i++) {
    difference += Math.abs(source[i] - clone[i]);
  }
  return clamp(1 - difference / count / 8, 0, 1);
}

export function createBinaryCloner(artifact: Artifact): Cloner {
  const source = artifact.binary?.sample ?? new Uint8Array();
  const sourceHistogram = artifact.binary?.histogram ?? histogram(source);
  const sourceEntropy = artifact.binary?.entropyBlocks ?? entropyBlocks(source);
  const sourceGrams = gramSet(source);
  const sourceChars = Array.from(source, (byte) => String.fromCharCode(byte));
  const cache = new Map<string, number>();
  const mapCache = new Map<number, Map<string, Dist>[]>();
  const seed = seedFromString(artifact.hash, 2);

  const defaults: Genome = { order: 0, blend: 0.55, prefix: 0 };

  const cumulative = new Uint32Array(257);
  for (let i = 0; i < 256; i++) {
    cumulative[i + 1] = cumulative[i] + sourceHistogram[i];
  }
  const sourceTotal = cumulative[256];

  function sampleGlobal(rng: Rng): number {
    if (!sourceTotal) return 0;
    const target = rng() * sourceTotal;
    let low = 0;
    let high = 256;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (cumulative[mid + 1] <= target) low = mid + 1;
      else high = mid;
    }
    return Math.min(255, low);
  }

  function mapsFor(order: number): Map<string, Dist>[] {
    const cached = mapCache.get(order);
    if (cached) return cached;
    const maps: Map<string, Dist>[] = [new Map()];
    for (let k = 1; k <= order; k++) {
      const map = new Map<string, Dist>();
      for (let i = k; i < sourceChars.length; i++) {
        const key = sourceChars.slice(i - k, i).join("");
        let dist = map.get(key);
        if (!dist) {
          dist = new Map();
          map.set(key, dist);
        }
        dist.set(sourceChars[i], (dist.get(sourceChars[i]) ?? 0) + 1);
      }
      maps[k] = map;
    }
    mapCache.set(order, maps);
    return maps;
  }

  function sampleContext(dist: Dist, rng: Rng): number {
    let total = 0;
    for (const count of dist.values()) total += count;
    let target = rng() * total;
    for (const [token, count] of dist) {
      target -= count;
      if (target <= 0) return token.charCodeAt(0);
    }
    let last = 0;
    for (const token of dist.keys()) last = token.charCodeAt(0);
    return last;
  }

  function synthesize(genome: Genome): Uint8Array {
    const order = clamp(Math.round(num(genome, "order", 0)), 0, 4);
    const blend = clamp(num(genome, "blend", 0.55), 0, 1);
    const prefix = clamp(Math.round(num(genome, "prefix", 0)), 0, 16);
    const length = source.length;
    const out = new Uint8Array(length);
    if (!length) return out;
    const first = Math.min(prefix, length);
    out.set(source.subarray(0, first));
    const rng = mulberry32(seed);
    const maps = order > 0 ? mapsFor(order) : null;
    const window: string[] = [];
    for (let i = Math.max(0, first - order); i < first; i++) {
      window.push(String.fromCharCode(out[i]));
    }

    for (let i = first; i < length; i++) {
      let next: number | undefined;
      if (maps && window.length && rng() >= blend) {
        const maxOrder = Math.min(order, window.length);
        for (let k = maxOrder; k >= 1; k--) {
          const key = window.slice(window.length - k).join("");
          const dist = maps[k].get(key);
          if (dist) {
            next = sampleContext(dist, rng);
            break;
          }
        }
      }
      if (next === undefined) next = sampleGlobal(rng);
      out[i] = next;
      window.push(String.fromCharCode(next));
      if (window.length > order) window.shift();
    }
    return out;
  }

  function measure(genome: Genome): {
    bytes: Uint8Array;
    score: number;
    hist: number;
    entropy: number;
    grams: number;
  } {
    const bytes = synthesize(genome);
    const cloneHistogram = histogram(bytes);
    const cloneEntropy = entropyBlocks(bytes);
    const hist = histogramSimilarity(sourceHistogram, cloneHistogram);
    const entropy = entropySimilarity(sourceEntropy, cloneEntropy);
    const grams = jaccard(sourceGrams, gramSet(bytes));
    const score = round(clamp(0.35 * hist + 0.25 * entropy + 0.4 * grams, 0, 1), 4);
    return { bytes, score, hist, entropy, grams };
  }

  const cacheKey = (genome: Genome) =>
    [
      Math.round(num(genome, "order", 0)),
      num(genome, "blend", 0.55).toFixed(2),
      Math.round(num(genome, "prefix", 0)),
    ].join("|");

  return {
    kind: "binary",
    defaults,
    evaluate(genome) {
      const key = cacheKey(genome);
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const score = measure(genome).score;
      cache.set(key, score);
      return score;
    },
    materialize(genome): CloneOutput {
      const result = measure(genome);
      return {
        score: result.score,
        bytes: result.bytes,
        filename: `${baseName(artifact.name)}.clone.bin`,
        mime: "application/octet-stream",
        facts: [
          { label: "HISTOGRAM", value: percent(result.hist, 1) },
          { label: "ENTROPY SHAPE", value: percent(result.entropy, 1) },
          { label: "SHARED 4-GRAMS", value: percent(result.grams, 1) },
          { label: "SIZE", value: fmtBytes(result.bytes.length) },
        ],
        binaryProfile: {
          entropy: entropyBlocks(result.bytes),
          histogram: histogram(result.bytes),
        },
      };
    },
    mutate(genome: Genome, rng: Rng) {
      const next: Genome = { ...genome };
      const roll = rng();
      let changed = "";
      if (roll < 0.42) {
        const current = clamp(Math.round(num(genome, "order", 0)), 0, 4);
        const updated = clamp(current + (rng() < 0.75 ? 1 : -1), 0, 4);
        next.order = updated;
        changed = `context order ${current} → ${updated}`;
      } else if (roll < 0.76) {
        const current = clamp(num(genome, "blend", 0.55), 0, 1);
        const updated = clamp(current + (rng() < 0.5 ? 0.15 : -0.15), 0, 1);
        next.blend = round(updated, 2);
        changed = `global blend ${Math.round(current * 100)}% → ${Math.round(updated * 100)}%`;
      } else {
        const current = clamp(Math.round(num(genome, "prefix", 0)), 0, 16);
        const updated = clamp(current + (rng() < 0.7 ? 4 : -4), 0, 16);
        next.prefix = updated;
        changed = `copied prefix ${current} → ${updated} bytes`;
      }
      return { genome: next, changed };
    },
    describe(genome: Genome) {
      const order = clamp(Math.round(num(genome, "order", 0)), 0, 4);
      const blend = clamp(num(genome, "blend", 0.55), 0, 1);
      const prefix = clamp(Math.round(num(genome, "prefix", 0)), 0, 16);
      return [
        {
          key: "order",
          label: "CONTEXT ORDER",
          value: `${order}`,
          raw: order,
          min: 0,
          max: 4,
        },
        {
          key: "blend",
          label: "GLOBAL BLEND",
          value: `${Math.round(blend * 100)}%`,
          raw: blend,
          min: 0,
          max: 1,
        },
        {
          key: "prefix",
          label: "HEADER COPY",
          value: `${prefix} bytes`,
          raw: prefix,
          min: 0,
          max: 16,
        },
      ];
    },
    reflect(seedGenome, best, baseline, score) {
      return `Context order ${Math.round(seedGenome.order)} → ${Math.round(
        best.order,
      )} with a ${Math.round(best.prefix)}-byte copied header lifted composite shape match by ${(
        (score - baseline) *
        100
      ).toFixed(1)} points. The binary class now seeds from this genome.`;
    },
  };
}
