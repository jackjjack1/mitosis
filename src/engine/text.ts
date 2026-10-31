import type { Artifact, Cloner, CloneOutput, Genome, Rng } from "./types";
import {
  baseName,
  clamp,
  mulberry32,
  num,
  percent,
  round,
  seedFromString,
} from "./util";

const TOKEN_RE = /\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g;
const MAX_TOKENS = 7000;
const MAX_GENERATED = 8000;

type Dist = Map<string, number>;

function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

function buildMaps(tokens: string[], maxOrder: number): Map<string, Dist>[] {
  const maps: Map<string, Dist>[] = [new Map()];
  for (let order = 1; order <= maxOrder; order++) {
    const map = new Map<string, Dist>();
    for (let i = order; i < tokens.length; i++) {
      const key = tokens.slice(i - order, i).join("\u0001");
      let dist = map.get(key);
      if (!dist) {
        dist = new Map();
        map.set(key, dist);
      }
      dist.set(tokens[i], (dist.get(tokens[i]) ?? 0) + 1);
    }
    maps[order] = map;
  }
  return maps;
}

function sampleDist(dist: Dist, temperature: number, rng: Rng): string {
  const entries: [string, number][] = [];
  let total = 0;
  const power = 1 / Math.max(0.2, temperature);
  for (const [token, count] of dist) {
    const weight = Math.pow(count, power);
    entries.push([token, weight]);
    total += weight;
  }
  let cursor = rng() * total;
  for (const [token, weight] of entries) {
    cursor -= weight;
    if (cursor <= 0) return token;
  }
  return entries[entries.length - 1]?.[0] ?? " ";
}

function gramSet(tokens: string[], n: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) {
    set.add(tokens.slice(i, i + n).join("\u0001"));
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

function cosine(a: string[], b: string[]): number {
  const countsA = new Map<string, number>();
  const countsB = new Map<string, number>();
  for (const token of a) countsA.set(token, (countsA.get(token) ?? 0) + 1);
  for (const token of b) countsB.set(token, (countsB.get(token) ?? 0) + 1);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const count of countsA.values()) normA += count * count;
  for (const count of countsB.values()) normB += count * count;
  for (const [token, count] of countsA) {
    dot += count * (countsB.get(token) ?? 0);
  }
  if (!normA || !normB) return 0;
  return dot / Math.sqrt(normA * normB);
}

export function createTextCloner(artifact: Artifact): Cloner {
  const tokens = tokenize(artifact.text?.sample ?? "").slice(0, MAX_TOKENS);
  const sourceTrigrams = gramSet(tokens, 3);
  const sourceEightgrams = gramSet(tokens, 8);
  const cache = new Map<string, { score: number; text: string; detail: MetricSet }>();
  const seed = seedFromString(artifact.hash, 1);

  interface MetricSet {
    trigram: number;
    cosine: number;
    novelty: number;
    lengthFit: number;
    fidelity: number;
    generatedTokens: number;
  }

  const defaults: Genome = { order: 1, temperature: 0.95, lengthRatio: 1 };

  function run(genome: Genome): { text: string; score: number; detail: MetricSet } {
    const order = clamp(Math.round(num(genome, "order", 1)), 1, 6);
    const temperature = clamp(num(genome, "temperature", 0.95), 0.3, 1.8);
    const lengthRatio = clamp(num(genome, "lengthRatio", 1), 0.65, 1.35);
    if (tokens.length < 4) {
      return {
        text: artifact.text?.sample ?? "",
        score: 0,
        detail: {
          trigram: 0,
          cosine: 0,
          novelty: 0,
          lengthFit: 0,
          fidelity: 0,
          generatedTokens: 0,
        },
      };
    }

    const effectiveOrder = Math.min(order, Math.max(1, tokens.length - 1));
    const maps = buildMaps(tokens, effectiveOrder);
    const global: Dist = new Map();
    for (const token of tokens) global.set(token, (global.get(token) ?? 0) + 1);

    const target = clamp(
      Math.round(tokens.length * lengthRatio),
      1,
      Math.min(MAX_GENERATED, tokens.length * 2),
    );
    const rng = mulberry32(seed);
    const start = Math.floor(rng() * Math.max(1, tokens.length - effectiveOrder));
    const output = tokens.slice(start, start + effectiveOrder);

    while (output.length < target) {
      let next: string | undefined;
      for (let orderTry = effectiveOrder; orderTry >= 1; orderTry--) {
        if (output.length < orderTry) continue;
        const key = output.slice(output.length - orderTry).join("\u0001");
        const dist = maps[orderTry].get(key);
        if (dist) {
          next = sampleDist(dist, temperature, rng);
          break;
        }
      }
      if (!next) next = sampleDist(global, temperature, rng);
      output.push(next);
    }

    const generated = output.slice(0, target);
    const trigramScore = jaccard(sourceTrigrams, gramSet(generated, 3));
    const cosineScore = cosine(tokens, generated);
    const fidelity = trigramScore * 0.55 + cosineScore * 0.45;
    const generatedEight = gramSet(generated, 8);
    let shared = 0;
    for (const gram of generatedEight) {
      if (sourceEightgrams.has(gram)) shared++;
    }
    const novelty = generatedEight.size ? 1 - shared / generatedEight.size : 0;
    const lengthFit =
      Math.min(tokens.length, generated.length) / Math.max(tokens.length, generated.length);
    const score = 0.62 * fidelity + 0.23 * novelty + 0.15 * lengthFit;

    return {
      text: generated.join(""),
      score: round(clamp(score, 0, 1), 4),
      detail: {
        trigram: trigramScore,
        cosine: cosineScore,
        novelty,
        lengthFit,
        fidelity,
        generatedTokens: generated.length,
      },
    };
  }

  const cacheKey = (genome: Genome) =>
    [
      Math.round(num(genome, "order", 1)),
      num(genome, "temperature", 0.95).toFixed(2),
      num(genome, "lengthRatio", 1).toFixed(2),
    ].join("|");

  return {
    kind: "text",
    defaults,
    evaluate(genome) {
      const key = cacheKey(genome);
      const hit = cache.get(key);
      if (hit) return hit.score;
      const result = run(genome);
      cache.set(key, result);
      return result.score;
    },
    materialize(genome): CloneOutput {
      const key = cacheKey(genome);
      let result = cache.get(key);
      if (!result) {
        result = run(genome);
        cache.set(key, result);
      }
      const detail = result.detail;
      return {
        score: result.score,
        text: result.text,
        filename: `${baseName(artifact.name)}-clone.txt`,
        mime: "text/plain",
        facts: [
          { label: "TRIGRAM MATCH", value: percent(detail.trigram, 1) },
          { label: "NOVELTY", value: percent(detail.novelty, 1) },
          { label: "TOKENS", value: detail.generatedTokens.toLocaleString() },
          { label: "CHARACTERS", value: result.text.length.toLocaleString() },
        ],
      };
    },
    mutate(genome: Genome, rng: Rng) {
      const next: Genome = { ...genome };
      const roll = rng();
      let changed = "";
      if (roll < 0.46) {
        const current = clamp(Math.round(num(genome, "order", 1)), 1, 6);
        const updated = clamp(current + (rng() < 0.72 ? 1 : -1), 1, 6);
        next.order = updated;
        changed = `context order ${current} → ${updated}`;
      } else if (roll < 0.78) {
        const current = clamp(num(genome, "temperature", 0.95), 0.3, 1.8);
        const updated = clamp(current + (rng() < 0.5 ? 0.15 : -0.15), 0.3, 1.8);
        next.temperature = round(updated, 2);
        changed = `temperature ${current.toFixed(2)} → ${updated.toFixed(2)}`;
      } else {
        const current = clamp(num(genome, "lengthRatio", 1), 0.65, 1.35);
        const updated = clamp(current + (rng() < 0.6 ? 0.07 : -0.07), 0.65, 1.35);
        next.lengthRatio = round(updated, 2);
        changed = `length ${Math.round(current * 100)}% → ${Math.round(updated * 100)}%`;
      }
      return { genome: next, changed };
    },
    describe(genome: Genome) {
      const order = clamp(Math.round(num(genome, "order", 1)), 1, 6);
      const temperature = clamp(num(genome, "temperature", 0.95), 0.3, 1.8);
      const lengthRatio = clamp(num(genome, "lengthRatio", 1), 0.65, 1.35);
      return [
        {
          key: "order",
          label: "CONTEXT ORDER",
          value: `${order} tokens`,
          raw: order,
          min: 1,
          max: 6,
        },
        {
          key: "temperature",
          label: "TEMPERATURE",
          value: temperature.toFixed(2),
          raw: temperature,
          min: 0.3,
          max: 1.8,
        },
        {
          key: "lengthRatio",
          label: "LENGTH",
          value: `${Math.round(lengthRatio * 100)}%`,
          raw: lengthRatio,
          min: 0.65,
          max: 1.35,
        },
      ];
    },
    reflect(seedGenome, best, baseline, score) {
      return `Context order moved ${Math.round(seedGenome.order)} → ${Math.round(
        best.order,
      )} and temperature ${seedGenome.temperature.toFixed(2)} → ${best.temperature.toFixed(
        2,
      )}; composite match rose ${((score - baseline) * 100).toFixed(1)} points. The text class will recall this starting genome.`;
    },
  };
}
