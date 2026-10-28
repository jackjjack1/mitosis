export type Kind = "image" | "text" | "binary";

/** A cloning genome is a flat bag of numeric hyperparameters. */
export type Genome = Record<string, number>;

export type Rng = () => number;

export interface ParamRow {
  key: string;
  label: string;
  value: string;
  raw: number;
  min: number;
  max: number;
}

export interface CloneOutput {
  score: number;
  dataUrl?: string;
  text?: string;
  bytes?: Uint8Array;
  filename?: string;
  mime?: string;
  facts: { label: string; value: string }[];
  binaryProfile?: { entropy: number[]; histogram: number[] };
}

export interface Cloner {
  kind: Kind;
  defaults: Genome;
  evaluate(genome: Genome): number;
  materialize(genome: Genome): CloneOutput;
  mutate(genome: Genome, rng: Rng): { genome: Genome; changed: string };
  describe(genome: Genome): ParamRow[];
  reflect(seed: Genome, best: Genome, baseline: number, score: number): string;
}

export interface SectionInfo {
  name: string;
  size: number;
  address: number;
}

export interface ImageInfo {
  width: number;
  height: number;
  sampleWidth: number;
  sampleHeight: number;
  pixels: Uint8ClampedArray;
  sourceCanvas: HTMLCanvasElement;
  swatches: string[];
  hasAlpha: boolean;
}

export interface TextInfo {
  sample: string;
  lines: number;
  words: number;
  uniques: number;
}

export interface BinaryInfo {
  sample: Uint8Array;
  histogram: number[];
  entropyBlocks: number[];
  entropyBlockSize: number;
  strings: string[];
  sections: SectionInfo[];
  headerInfo: [string, string][];
}

export interface Artifact {
  name: string;
  size: number;
  mime: string;
  kind: Kind;
  format: string;
  magic: string;
  hash: string;
  entropy: number;
  previewUrl?: string;
  notes: string[];
  image?: ImageInfo;
  text?: TextInfo;
  binary?: BinaryInfo;
}

export interface MemoryEntry {
  id: string;
  at: number;
  kind: Kind;
  name: string;
  format: string;
  size: number;
  genome: Genome;
  baseline: number;
  score: number;
  accepted: number;
  attempts: number;
}

export interface Mind {
  version: 1;
  runs: number;
  generations: number;
  accepted: number;
  best: Partial<
    Record<Kind, { genome: Genome; score: number; name: string; at: number }>
  >;
  memories: MemoryEntry[];
}
