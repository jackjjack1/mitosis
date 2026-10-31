import type { EvolutionState, PopulationMember, ScorePoint, SearchMode } from "./evolve";
import type { Genome } from "./types";
import { baseName } from "./util";

/**
 * MITOSIS clone session, format version 1.
 *
 * UTI: `io.freebuff.mitosis.clone`
 * Extension: `.clone`
 * MIME: `application/x-mitosis-clone`
 *
 * Little-endian layout:
 *
 * | Offset | Size    | Field                                      |
 * | ------ | ------- | ------------------------------------------ |
 * | 0      | 8       | ASCII magic `MTSCLONE`                     |
 * | 8      | uint16  | format version (1)                         |
 * | 10     | uint16  | flags (must be 0 in version 1)             |
 * | 12     | uint32  | UTF-8 JSON header length                   |
 * | 16     | N       | JSON header                                |
 * | 16+N   | M       | original specimen bytes                    |
 *
 * The header carries `format`, `version`, `savedAt`, `specimen`
 * (`name`, `mime`, `size`), and `evolution` (seed genome, current genome,
 * baseline, score, attempts, accepted, history). The specimen bytes are the
 * payload, not a copy inside the JSON. `specimen.size` must equal `M`.
 *
 * Version 1 readers ignore unknown JSON keys so a later stage can add a note,
 * a population summary, or a sync id without a new version. A new version or
 * a non-zero flags word means the payload layout changed (compression, an
 * external specimen, a population archive). Those files are rejected here
 * instead of being parsed as version 1.
 */
export const CLONE_MAGIC = "MTSCLONE";
export const CLONE_FORMAT_VERSION = 1;
export const CLONE_FORMAT_ID = "io.freebuff.mitosis.clone";
export const CLONE_MIME = "application/x-mitosis-clone";

export class CloneFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloneFormatError";
  }
}

export interface CloneSession {
  version: 1;
  savedAt: number;
  specimen: {
    name: string;
    mime: string;
    bytes: Uint8Array;
  };
  evolution: EvolutionState;
}

export function sessionFilename(name: string): string {
  return `${baseName(name)}.clone`;
}

export function isCloneSession(bytes: Uint8Array): boolean {
  if (bytes.length < CLONE_MAGIC.length) return false;
  return new TextDecoder().decode(bytes.subarray(0, CLONE_MAGIC.length)) === CLONE_MAGIC;
}

export function encodeCloneSession(session: CloneSession): Uint8Array {
  const header = {
    format: CLONE_FORMAT_ID,
    version: CLONE_FORMAT_VERSION,
    savedAt: session.savedAt,
    specimen: {
      name: session.specimen.name,
      mime: session.specimen.mime || "application/octet-stream",
      size: session.specimen.bytes.length,
    },
    evolution: {
      seed: session.evolution.seed,
      genome: session.evolution.genome,
      baseline: session.evolution.baseline,
      score: session.evolution.score,
      attempts: session.evolution.attempts,
      accepted: session.evolution.accepted,
      history: session.evolution.history,
      ...(session.evolution.mode ? { mode: session.evolution.mode } : {}),
      ...(session.evolution.population ? { population: session.evolution.population } : {}),
      ...(session.evolution.populationSize
        ? { populationSize: session.evolution.populationSize }
        : {}),
    },
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const payload = session.specimen.bytes;
  const out = new Uint8Array(16 + json.length + payload.length);
  out.set(new TextEncoder().encode(CLONE_MAGIC), 0);
  const view = new DataView(out.buffer);
  view.setUint16(8, CLONE_FORMAT_VERSION, true);
  view.setUint16(10, 0, true);
  view.setUint32(12, json.length, true);
  out.set(json, 16);
  out.set(payload, 16 + json.length);
  return out;
}

export function decodeCloneSession(bytes: Uint8Array): CloneSession {
  if (!isCloneSession(bytes)) {
    throw new CloneFormatError("Not a MITOSIS .clone file");
  }
  if (bytes.length < 16) {
    throw new CloneFormatError("Truncated .clone file");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(8, true);
  if (version !== CLONE_FORMAT_VERSION) {
    throw new CloneFormatError(`Unsupported .clone version ${version}`);
  }
  const flags = view.getUint16(10, true);
  if (flags !== 0) {
    throw new CloneFormatError(`Unsupported .clone flags ${flags}`);
  }

  const headerLength = view.getUint32(12, true);
  if (16 + headerLength > bytes.length) {
    throw new CloneFormatError("Truncated .clone header");
  }

  let header: HeaderFields;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + headerLength))) as HeaderFields;
  } catch {
    throw new CloneFormatError("Corrupt .clone header");
  }
  if (header.format !== CLONE_FORMAT_ID) {
    throw new CloneFormatError("Unsupported .clone header");
  }
  if (header.version !== CLONE_FORMAT_VERSION) {
    throw new CloneFormatError(`Unsupported .clone version ${String(header.version)}`);
  }

  const payload = bytes.subarray(16 + headerLength);
  const specimen = header.specimen;
  if (!specimen || typeof specimen.name !== "string" || !specimen.name) {
    throw new CloneFormatError("Missing specimen name");
  }
  if (typeof specimen.mime !== "string") {
    throw new CloneFormatError("Missing specimen type");
  }
  if (typeof specimen.size !== "number" || specimen.size !== payload.length) {
    throw new CloneFormatError("Specimen size does not match payload");
  }
  if (typeof header.savedAt !== "number" || !Number.isFinite(header.savedAt)) {
    throw new CloneFormatError("Invalid savedAt");
  }

  const evolution = readEvolution(header.evolution);
  const mode = readMode(header.evolution);
  const population = readPopulation(header.evolution);
  const populationSize = readPopulationSize(header.evolution);
  if (mode) evolution.mode = mode;
  if (population) evolution.population = population;
  if (populationSize !== undefined) evolution.populationSize = populationSize;
  return {
    version: 1,
    savedAt: header.savedAt,
    specimen: {
      name: specimen.name,
      mime: specimen.mime,
      bytes: new Uint8Array(payload),
    },
    evolution,
  };
}

interface HeaderFields {
  format?: unknown;
  version?: unknown;
  savedAt?: unknown;
  specimen?: { name?: unknown; mime?: unknown; size?: unknown };
  evolution?: unknown;
}

function evolutionRow(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function readMode(value: unknown): SearchMode | undefined {
  const mode = evolutionRow(value).mode;
  if (mode === undefined) return undefined;
  if (mode === "hill" || mode === "population") return mode;
  throw new CloneFormatError("Invalid evolution mode");
}

function readPopulationSize(value: unknown): number | undefined {
  const size = evolutionRow(value).populationSize;
  if (size === undefined) return undefined;
  return readNumber(size, "populationSize");
}

function readPopulation(value: unknown): PopulationMember[] | undefined {
  const population = evolutionRow(value).population;
  if (population === undefined) return undefined;
  if (!Array.isArray(population)) throw new CloneFormatError("Invalid population");
  return population.map((member, index) => {
    if (!member || typeof member !== "object") {
      throw new CloneFormatError(`Invalid population member ${index}`);
    }
    const row = member as Record<string, unknown>;
    return {
      genome: readGenome(row.genome, `population ${index}`),
      score: readNumber(row.score, `population ${index} score`),
    };
  });
}

function readEvolution(value: unknown): EvolutionState {
  if (!value || typeof value !== "object") {
    throw new CloneFormatError("Missing evolution");
  }
  const row = value as Record<string, unknown>;
  return {
    seed: readGenome(row.seed, "seed"),
    genome: readGenome(row.genome, "genome"),
    baseline: readNumber(row.baseline, "baseline"),
    score: readNumber(row.score, "score"),
    attempts: readNumber(row.attempts, "attempts"),
    accepted: readNumber(row.accepted, "accepted"),
    history: readHistory(row.history),
  };
}

function readGenome(value: unknown, label: string): Genome {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CloneFormatError(`Invalid ${label} genome`);
  }
  const genome: Genome = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new CloneFormatError(`Invalid ${label} value ${key}`);
    }
    genome[key] = raw;
  }
  return genome;
}

function readNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CloneFormatError(`Invalid ${label}`);
  }
  return value;
}

function readHistory(value: unknown): ScorePoint[] {
  if (!Array.isArray(value)) throw new CloneFormatError("Invalid evolution history");
  return value.map((point, index) => {
    if (!point || typeof point !== "object") {
      throw new CloneFormatError(`Invalid history point ${index}`);
    }
    const row = point as Record<string, unknown>;
    if (typeof row.change !== "string") {
      throw new CloneFormatError(`Invalid history point ${index}`);
    }
    if (typeof row.accepted !== "boolean") {
      throw new CloneFormatError(`Invalid history point ${index}`);
    }
    return {
      attempt: readNumber(row.attempt, `history ${index} attempt`),
      score: readNumber(row.score, `history ${index} score`),
      best: readNumber(row.best, `history ${index} best`),
      accepted: row.accepted,
      change: row.change,
    };
  });
}
