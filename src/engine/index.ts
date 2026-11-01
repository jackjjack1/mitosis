import type { Artifact, Cloner } from "./types";
import { createImageCloner } from "./image";
import { createTextCloner } from "./text";
import { createBinaryCloner } from "./binary";
import { createAudioCloner } from "./audio";
import { createPdfCloner } from "./pdf";
import { createSheetCloner } from "./sheet";

export { dissectFile } from "./dissect";
export { readExact, saveExact } from "./exact";
export { extractFeatures } from "./features";
export type { Feature, FeatureFile, FeatureSet } from "./features";
export {
  analyzeMachO,
  downloadMachOReport,
  formatMachOReport,
  isMachOArtifact,
  reportFileName,
} from "./macho";
export type {
  MachOAnalysis,
  MachOArchitecture,
  MachOSection,
  MachOSegment,
  MachOString,
  MachOSymbol,
  MachOSymbolKind,
} from "./macho";
export {
  demangleObjCClass,
  demangleSwift,
  demangleSymbol,
  recoverObjCClassName,
  recoverObjectiveC,
} from "./demangle";
export type {
  DemangledSymbol,
  ObjectiveCKind,
  ObjectiveCMethod,
  ObjectiveCName,
  ObjectiveCRecovery,
  ObjectiveCResult,
  SymbolLanguage,
} from "./demangle";

export {
  adoptPopulation,
  advanceEvolution,
  advancePopulation,
  crossoverGenomes,
  startEvolution,
  startPopulation,
} from "./evolve";
export type { EvolutionState, PopulationMember, ScorePoint, SearchMode } from "./evolve";
export {
  downloadBytes,
  exportReconstruction,
  reconstructionFilename,
  RECONSTRUCTION_EXT,
  RECONSTRUCTION_MIME,
} from "./export";
export type { ExportedFile } from "./export";
export {
  CLONE_FORMAT_ID,
  CLONE_FORMAT_VERSION,
  CLONE_MAGIC,
  CLONE_MIME,
  CloneFormatError,
  decodeCloneSession,
  encodeCloneSession,
  isCloneSession,
  sessionFilename,
} from "./session";
export type { CloneSession } from "./session";
export {
  batchEntries,
  batchReportJson,
  batchReportMarkdown,
  runBatch,
} from "./batch";
export type { BatchFile, BatchOptions, BatchResult, BatchRow } from "./batch";
export {
  MIND_FILE_FORMAT,
  MIND_FILE_MAGIC,
  MIND_FILE_VERSION,
  MIND_MIME,
  applyMindImport,
  decodeMindFile,
  emptyMind,
  encodeMindFile,
  freshSyncId,
  isMindFile,
  loadMind,
  loadSync,
  mergeMinds,
  mindEtag,
  recallMemories,
  recordRun,
  rememberRun,
  saveMind,
  saveSync,
  seedFromMemory,
} from "./memory";
export type { MindDocument, MindSync } from "./memory";

export function createCloner(artifact: Artifact): Cloner {
  if (artifact.kind === "image" && artifact.image) return createImageCloner(artifact);
  if (artifact.kind === "text" && artifact.text) return createTextCloner(artifact);
  if (artifact.kind === "audio" && artifact.audio) return createAudioCloner(artifact);
  if (artifact.kind === "pdf" && artifact.pdf) return createPdfCloner(artifact);
  if (artifact.kind === "sheet" && artifact.sheet) return createSheetCloner(artifact);
  return createBinaryCloner(artifact);
}

export function genomeSignature(genome: Record<string, number>): string {
  return Object.keys(genome)
    .sort()
    .map((key) => `${key}:${Number(genome[key]).toFixed(4)}`)
    .join("|");
}

export function describeChange(
  cloner: Cloner,
  previous: Record<string, number>,
  next: Record<string, number>,
): string {
  const before = cloner.describe(previous);
  const after = cloner.describe(next);
  for (let i = 0; i < after.length; i++) {
    if (before[i]?.value !== after[i]?.value) {
      return `${after[i].label.toLowerCase()} ${before[i]?.value ?? "?"} → ${after[i].value}`;
    }
  }
  return "unclassified mutation";
}
