import type { Artifact, Cloner } from "./types";
import { createImageCloner } from "./image";
import { createTextCloner } from "./text";
import { createBinaryCloner } from "./binary";

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

export function createCloner(artifact: Artifact): Cloner {
  if (artifact.kind === "image" && artifact.image) return createImageCloner(artifact);
  if (artifact.kind === "text" && artifact.text) return createTextCloner(artifact);
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
