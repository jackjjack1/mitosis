import type {
  Artifact,
  Cloner,
  CloneOutput,
  Genome,
  MemoryEntry,
} from "./engine/types";

export interface HistoryPoint {
  n: number;
  score: number;
}

export interface RunState {
  artifact: Artifact;
  cloner: Cloner;
  recalled: MemoryEntry[];
  seed: Genome;
  seedScore: number;
  blankScore: number;
  genome: Genome;
  baseline: number;
  best: number;
  history: HistoryPoint[];
  attempts: number;
  accepted: number;
  lastChange: string | null;
  status: "ready" | "evolving" | "done";
  output: CloneOutput;
  memoryId: string;
  reflection: string;
}
