import { seedFromString } from "./util";
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

export interface MindSync {
  id: string;
  revision: number;
}

export interface MindSyncStamp extends MindSync {
  etag: string;
}

export interface MindDocument {
  format: "io.freebuff.mitosis.mind";
  version: 1;
  exportedAt: number;
  sync: MindSyncStamp;
  mind: Mind;
}

export const MIND_FILE_MAGIC = "MTSMIND1";
export const MIND_FILE_FORMAT = "io.freebuff.mitosis.mind";
export const MIND_FILE_VERSION = 1;
export const MIND_MIME = "application/x-mitosis-mind";
export const MIND_SYNC_KEY = "mitosis.mind.sync.v1";

/** The genome `startEvolution` / `startPopulation` should start from, if any. */
export function seedFromMemory(
  mind: Mind,
  artifact: Artifact,
): { genome: Genome; source: MemoryEntry } | null {
  const [source] = recallMemories(mind, artifact, 1);
  if (!source) return null;
  return { genome: { ...source.genome }, source };
}

/**
 * Persist a paused run. The first pause inserts a memory. A later pause of the
 * same specimen updates that memory instead of counting another run.
 */
export function rememberRun(mind: Mind, args: RecordArgs): Mind {
  const genome = { ...args.genome };
  const id = entryId(args.artifact.kind, args.artifact.hash);
  const exists = mind.memories.some((memory) => memory.id === id);
  const recorded = exists
    ? updateRun(mind, id, {
        genome,
        score: args.score,
        baseline: args.baseline,
        accepted: args.accepted,
        attempts: args.attempts,
        kind: args.artifact.kind,
        name: args.artifact.name,
      })
    : recordRun(mind, { ...args, genome });
  return {
    ...recorded,
    memories: recorded.memories.map((memory) =>
      memory.id === id ? { ...memory, at: Date.now(), genome: { ...genome } } : memory,
    ),
  };
}

export function mindEtag(mind: Mind): string {
  const canonical = mind.memories
    .map((memory) => `${memory.id}:${memory.score}:${JSON.stringify(memory.genome)}`)
    .sort()
    .join("|");
  return seedFromString(canonical).toString(16);
}

export function encodeMindFile(mind: Mind, sync: MindSync, exportedAt = Date.now()): Uint8Array {
  const document: MindDocument = {
    format: MIND_FILE_FORMAT,
    version: 1,
    exportedAt,
    sync: { id: sync.id, revision: sync.revision, etag: mindEtag(mind) },
    mind,
  };
  return new TextEncoder().encode(`${MIND_FILE_MAGIC}\n${JSON.stringify(document, null, 2)}\n`);
}

export function isMindFile(bytes: Uint8Array): boolean {
  if (bytes.length < MIND_FILE_MAGIC.length) return false;
  return new TextDecoder().decode(bytes.subarray(0, MIND_FILE_MAGIC.length)) === MIND_FILE_MAGIC;
}

export function decodeMindFile(bytes: Uint8Array): MindDocument {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  if (!text.startsWith(MIND_FILE_MAGIC)) {
    throw new Error("Not a MITOSIS mind file");
  }
  let parsed: Partial<MindDocument>;
  try {
    parsed = JSON.parse(text.slice(text.indexOf("\n") + 1)) as Partial<MindDocument>;
  } catch {
    throw new Error("Corrupt mind file");
  }
  if (parsed.format !== MIND_FILE_FORMAT || parsed.version !== MIND_FILE_VERSION) {
    throw new Error("Unsupported mind file");
  }
  if (!parsed.sync || typeof parsed.sync.id !== "string" || typeof parsed.sync.revision !== "number") {
    throw new Error("Mind file is missing sync data");
  }
  return {
    format: MIND_FILE_FORMAT,
    version: 1,
    exportedAt: typeof parsed.exportedAt === "number" ? parsed.exportedAt : 0,
    sync: {
      id: parsed.sync.id,
      revision: parsed.sync.revision,
      etag: typeof parsed.sync.etag === "string" ? parsed.sync.etag : "",
    },
    mind: sanitizeMind(parsed.mind),
  };
}

export function mergeMinds(local: Mind, incoming: Mind): Mind {
  const byId = new Map<string, MemoryEntry>();
  for (const memory of [...incoming.memories, ...local.memories]) {
    const copy = { ...memory, genome: { ...memory.genome } };
    const previous = byId.get(copy.id);
    if (!previous || copy.score > previous.score || (copy.score === previous.score && copy.at >= previous.at)) {
      byId.set(copy.id, copy);
    }
  }
  const memories = [...byId.values()].sort((a, b) => b.at - a.at).slice(0, 30);
  const best: Mind["best"] = {};
  for (const memory of memories) {
    const current = best[memory.kind];
    if (!current || memory.score > current.score) {
      best[memory.kind] = {
        genome: { ...memory.genome },
        score: memory.score,
        name: memory.name,
        at: memory.at,
      };
    }
  }
  return {
    version: 1,
    runs: Math.max(local.runs, incoming.runs),
    generations: Math.max(local.generations, incoming.generations),
    accepted: Math.max(local.accepted, incoming.accepted),
    best,
    memories,
  };
}

export function applyMindImport(
  local: Mind,
  localSync: MindSync,
  document: MindDocument,
): { mind: Mind; sync: MindSync } {
  return {
    mind: mergeMinds(local, document.mind),
    sync: {
      id: localSync.id || document.sync.id,
      revision: Math.max(localSync.revision, document.sync.revision) + 1,
    },
  };
}

export function loadSync(): MindSync {
  try {
    const raw = localStorage.getItem(MIND_SYNC_KEY);
    if (!raw) return { id: "", revision: 0 };
    const parsed = JSON.parse(raw) as Partial<MindSync>;
    return {
      id: typeof parsed.id === "string" ? parsed.id : "",
      revision: typeof parsed.revision === "number" ? parsed.revision : 0,
    };
  } catch {
    return { id: "", revision: 0 };
  }
}

export function saveSync(sync: MindSync): void {
  try {
    localStorage.setItem(MIND_SYNC_KEY, JSON.stringify(sync));
  } catch {
    // A blocked storage quota should not block the lab.
  }
}

export function freshSyncId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sanitizeMind(value: unknown): Mind {
  const parsed = (value ?? {}) as Partial<Mind>;
  const memories = Array.isArray(parsed.memories) ? parsed.memories.flatMap(sanitizeMemory) : [];
  const base = {
    version: 1 as const,
    runs: typeof parsed.runs === "number" ? parsed.runs : 0,
    generations: typeof parsed.generations === "number" ? parsed.generations : 0,
    accepted: typeof parsed.accepted === "number" ? parsed.accepted : 0,
    best: {},
    memories,
  };
  return mergeMinds(emptyMind(), base);
}

function sanitizeMemory(value: unknown): MemoryEntry[] {
  if (!value || typeof value !== "object") return [];
  const row = value as Partial<MemoryEntry>;
  if (typeof row.id !== "string" || typeof row.kind !== "string" || typeof row.name !== "string") return [];
  if (!row.genome || typeof row.genome !== "object") return [];
  const genome: Genome = {};
  for (const [key, raw] of Object.entries(row.genome)) {
    if (typeof raw === "number" && Number.isFinite(raw)) genome[key] = raw;
  }
  return [
    {
      id: row.id,
      at: typeof row.at === "number" ? row.at : 0,
      kind: row.kind as Kind,
      name: row.name,
      format: typeof row.format === "string" ? row.format : "",
      size: typeof row.size === "number" ? row.size : 0,
      genome,
      baseline: typeof row.baseline === "number" ? row.baseline : 0,
      score: typeof row.score === "number" ? row.score : 0,
      accepted: typeof row.accepted === "number" ? row.accepted : 0,
      attempts: typeof row.attempts === "number" ? row.attempts : 0,
    },
  ];
}
