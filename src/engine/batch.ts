import { createCloner } from "./index";
import { dissectFile } from "./dissect";
import { advancePopulation, startPopulation } from "./evolve";
import { rememberRun, seedFromMemory } from "./memory";
import { encodeCloneSession, sessionFilename } from "./session";
import type { Kind, Mind } from "./types";
import { percent } from "./util";

export interface BatchRow {
  name: string;
  kind: Kind;
  format: string;
  baseline: number;
  score: number;
  accepted: number;
  attempts: number;
  cloneFile: string;
  seededFrom: string | null;
  error?: string;
}

export interface BatchFile {
  name: string;
  bytes: Uint8Array;
}

export interface BatchResult {
  rows: BatchRow[];
  mind: Mind;
  files: BatchFile[];
}

export interface BatchOptions {
  generations?: number;
  population?: number;
  yield?: () => Promise<void>;
  onStart?: (index: number) => void;
  onRow?: (row: BatchRow, index: number) => void;
}

const MAX_BATCH = 24;

export async function runBatch(files: File[], mind: Mind, options: BatchOptions = {}): Promise<BatchResult> {
  const rows: BatchRow[] = [];
  const archived: BatchFile[] = [];
  let current = mind;
  const queue = files.slice(0, MAX_BATCH);
  for (const [index, file] of queue.entries()) {
    options.onStart?.(index);
    if (!file.size) {
      const row = failed(file.name, "Empty file");
      rows.push(row);
      options.onRow?.(row, index);
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const artifact = await dissectFile(file);
      const cloner = createCloner(artifact);
      const recalled = seedFromMemory(current, artifact);
      const generations = options.generations ?? (artifact.kind === "image" ? 4 : 8);
      const population = options.population ?? 4;
      let state = startPopulation(cloner, {
        size: population,
        seed: recalled?.genome,
      });
      for (let step = 0; step < generations; step++) {
        state = advancePopulation(cloner, state, Math.random);
        if (options.yield) await options.yield();
      }
      const session = encodeCloneSession({
        version: 1,
        savedAt: Date.now(),
        specimen: {
          name: file.name,
          mime: file.type || "application/octet-stream",
          bytes,
        },
        evolution: state,
      });
      const cloneFile = archived.some((fileEntry) => fileEntry.name === sessionFilename(file.name))
        ? `${index + 1}-${sessionFilename(file.name)}`
        : sessionFilename(file.name);
      archived.push({ name: cloneFile, bytes: session });
      current = rememberRun(current, {
        artifact,
        genome: state.genome,
        baseline: state.baseline,
        score: state.score,
        accepted: state.accepted,
        attempts: state.attempts,
      });
      rows.push({
        name: file.name,
        kind: artifact.kind,
        format: artifact.format,
        baseline: state.baseline,
        score: state.score,
        accepted: state.accepted,
        attempts: state.attempts,
        cloneFile,
        seededFrom: recalled?.source.name ?? null,
      });
      options.onRow?.(rows[rows.length - 1], index);
    } catch (caught) {
      const row = failed(file.name, caught instanceof Error ? caught.message : "Could not evolve this file");
      rows.push(row);
      options.onRow?.(row, index);
    }
  }
  if (files.length > MAX_BATCH) {
    rows.push(failed(`${files.length - MAX_BATCH} more`, `Batch keeps the first ${MAX_BATCH} files`));
  }
  return { rows, mind: current, files: archived };
}

export function batchReportMarkdown(rows: BatchRow[]): string {
  const lines = [
    "# MITOSIS batch",
    "",
    `${rows.filter((row) => !row.error).length} sessions · ${rows.filter((row) => row.error).length} skipped`,
    "",
    "| File | Kind | Format | Seed | Baseline | Score | Accepted | Attempts | Clone |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.name} | ${row.kind} | ${row.format} | ${row.seededFrom ?? "—"} | ${percent(row.baseline, 1)} | ${percent(row.score, 1)} | ${row.accepted} | ${row.attempts} | ${row.error ?? row.cloneFile} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function batchReportJson(rows: BatchRow[]): string {
  return `${JSON.stringify(
    {
      format: "io.freebuff.mitosis.batch",
      version: 1,
      rows,
    },
    null,
    2,
  )}\n`;
}

export function batchEntries(result: BatchResult): { name: string; data: Uint8Array }[] {
  const encoder = new TextEncoder();
  return [
    ...result.files.map((file) => ({ name: file.name, data: file.bytes })),
    { name: "batch-report.md", data: encoder.encode(batchReportMarkdown(result.rows)) },
    { name: "batch-report.json", data: encoder.encode(batchReportJson(result.rows)) },
  ];
}

function failed(name: string, error: string): BatchRow {
  return {
    name,
    kind: "binary",
    format: "—",
    baseline: 0,
    score: 0,
    accepted: 0,
    attempts: 0,
    cloneFile: "",
    seededFrom: null,
    error,
  };
}
