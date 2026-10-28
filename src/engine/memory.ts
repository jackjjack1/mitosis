import type { Artifact, Genome, Kind, MemoryEntry, Mind } from "./types";

export const MIND_KEY = "mitosis.mind.v1";

export function emptyMind(): Mind {
  return {
    version: 1,
    runs: 0,
    generations: 0,
    accepted: 0,
    best: {},
    memories: [],
  };
}

export function loadMind(): Mind {
  try {
    const raw = localStorage.getItem(MIND_KEY);
    if (!raw) return emptyMind();
    const parsed = JSON.parse(raw) as Partial<Mind>;
    if (parsed.version !== 1) return emptyMind();
    return {
      version: 1,
      runs: typeof parsed.runs === "number" ? parsed.runs : 0,
      generations: typeof parsed.generations === "number" ? parsed.generations : 0,
      accepted: typeof parsed.accepted === "number" ? parsed.accepted : 0,
      best: parsed.best ?? {},
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
    };
  } catch {
    return emptyMind();
  }
}

export function saveMind(mind: Mind): void {
  try {
    localStorage.setItem(MIND_KEY, JSON.stringify(mind));
  } catch {
    // A full or blocked storage quota should not break the lab.
  }
}

export function clearMind(): void {
  try {
    localStorage.removeItem(MIND_KEY);
  } catch {
    // Ignore storage access failures.
  }
}

export function recallMemories(
  mind: Mind,
  artifact: Artifact,
  limit = 3,
): MemoryEntry[] {
  return mind.memories
    .filter((memory) => memory.kind === artifact.kind)
    .map((memory) => {
      const sizeFit =
        Math.min(memory.size, artifact.size) /
        Math.max(1, Math.max(memory.size, artifact.size));
      const ageDays = (Date.now() - memory.at) / 86_400_000;
      const affinity =
        0.55 +
        sizeFit * 0.25 +
        (memory.format === artifact.format ? 0.12 : 0) +
        Math.max(0, 0.08 - ageDays * 0.001);
      return { memory, affinity };
    })
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, limit)
    .map(({ memory }) => memory);
}

interface RecordArgs {
  artifact: Artifact;
  genome: Genome;
  baseline: number;
  score: number;
  accepted: number;
  attempts: number;
}

function entryId(kind: Kind, hash: string): string {
  return `${kind}:${hash}`;
}

export function recordRun(mind: Mind, args: RecordArgs): Mind {
  const { artifact, genome, baseline, score, accepted, attempts } = args;
  const id = entryId(artifact.kind, artifact.hash);
  const entry: MemoryEntry = {
    id,
    at: Date.now(),
    kind: artifact.kind,
    name: artifact.name,
    format: artifact.format,
    size: artifact.size,
    genome,
    baseline,
    score,
    accepted,
    attempts,
  };
  const best = { ...mind.best };
  const previousBest = best[artifact.kind];
  if (!previousBest || score > previousBest.score) {
    best[artifact.kind] = {
      genome,
      score,
      name: artifact.name,
      at: Date.now(),
    };
  }
  return {
    ...mind,
    runs: mind.runs + 1,
    generations: mind.generations + attempts,
    accepted: mind.accepted + accepted,
    best,
    memories: [entry, ...mind.memories.filter((memory) => memory.id !== id)].slice(0, 30),
  };
}

export function updateRun(
  mind: Mind,
  id: string,
  patch: {
    genome: Genome;
    score: number;
    baseline: number;
    accepted: number;
    attempts: number;
    kind: Kind;
    name: string;
  },
): Mind {
  const index = mind.memories.findIndex((memory) => memory.id === id);
  if (index < 0) return mind;
  const previous = mind.memories[index];
  const updated: MemoryEntry = {
    ...previous,
    genome: patch.genome,
    score: patch.score,
    baseline: patch.baseline,
    accepted: patch.accepted,
    attempts: patch.attempts,
  };
  const memories = [...mind.memories];
  memories[index] = updated;
  const best = { ...mind.best };
  const previousBest = best[updated.kind];
  if (!previousBest || updated.score > previousBest.score) {
    best[updated.kind] = {
      genome: updated.genome,
      score: updated.score,
      name: updated.name,
      at: Date.now(),
    };
  }
  return {
    ...mind,
    generations: mind.generations + Math.max(0, patch.attempts - previous.attempts),
    accepted: mind.accepted + Math.max(0, patch.accepted - previous.accepted),
    best,
    memories,
  };
}
