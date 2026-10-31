import type { Artifact, Cloner, CloneOutput, Genome, Rng, SheetInfo } from "./types";
import { arrayBufferOf, baseName, clamp, mulberry32, num, percent, round, seedFromString } from "./util";

export interface Table {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string, delimiter?: string): Table {
  const source = text.replace(/^\uFEFF/, "");
  const split = delimiter ?? (source.split("\t").length > source.split(",").length ? "\t" : ",");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === split) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const kept = rows.filter((entry) => entry.some((value) => value.length));
  if (!kept.length) return { headers: [], rows: [] };
  const width = Math.max(...kept.map((entry) => entry.length));
  const padded = kept.map((entry) => {
    const copy = entry.slice();
    while (copy.length < width) copy.push("");
    return copy;
  });
  return { headers: padded[0], rows: padded.slice(1) };
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([arrayBufferOf(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 30 <= bytes.length && out.size < 40) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const data = bytes.subarray(dataStart, dataStart + compSize);
    if (method === 0) out.set(name, new Uint8Array(data));
    else if (method === 8) {
      try {
        out.set(name, await inflate(data));
      } catch {
        // Skip an entry the browser cannot inflate.
      }
    }
    offset = dataStart + compSize;
  }
  return out;
}

export async function parseXlsx(bytes: Uint8Array): Promise<Table> {
  const entries = await readZip(bytes);
  const sharedRaw = entries.get("xl/sharedStrings.xml");
  const sheetName = [...entries.keys()].find((name) => /xl\/worksheets\/sheet\d+\.xml$/.test(name));
  const sheetRaw = sheetName ? entries.get(sheetName) : undefined;
  if (!sheetRaw) return { headers: [], rows: [] };
  const sharedXml = sharedRaw ? new TextDecoder().decode(sharedRaw) : "";
  const strings = [...sharedXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) =>
    decodeXml(match[1]),
  );
  const xml = new TextDecoder().decode(sheetRaw);
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const type = /t="([^"]+)"/.exec(cell[1])?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1] ?? "";
      if (type === "s") cells.push(strings[Number(value)] ?? "");
      else if (type === "inlineStr") {
        cells.push(decodeXml(/<t[^>]*>([\s\S]*?)<\/t>/.exec(cell[2])?.[1] ?? ""));
      } else cells.push(decodeXml(value));
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return { headers: [], rows: [] };
  const width = Math.max(...rows.map((row) => row.length));
  const padded = rows.map((row) => {
    const copy = row.slice();
    while (copy.length < width) copy.push("");
    return copy;
  });
  return { headers: padded[0], rows: padded.slice(1) };
}

export function looksLikeSheet(name: string, mime: string): boolean {
  return (
    /\.(csv|tsv|xlsx)$/i.test(name) ||
    /csv|spreadsheet|excel/i.test(mime)
  );
}

export function sheetFormat(name: string): string {
  if (/\.xlsx$/i.test(name)) return "XLSX";
  if (/\.tsv$/i.test(name)) return "TSV";
  return "CSV";
}

export async function readSheet(file: File, bytes: Uint8Array): Promise<SheetInfo | null> {
  const format = sheetFormat(file.name);
  if (format === "XLSX") {
    const table = await parseXlsx(bytes);
    if (!table.headers.length) return null;
    return { format, headers: table.headers, rows: table.rows.slice(0, 200) };
  }
  const text = new TextDecoder().decode(bytes);
  const table = parseCsv(text, format === "TSV" ? "\t" : undefined);
  if (!table.headers.length) return null;
  return { format, headers: table.headers, rows: table.rows.slice(0, 200) };
}

function quote(value: string, delimiter: string): string {
  if (/["\n\r]/.test(value) || value.includes(delimiter)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function tableToCsv(headers: string[], rows: string[][], delimiter = ","): string {
  const lines = [headers, ...rows].map((row) => row.map((cell) => quote(cell, delimiter)).join(delimiter));
  return `${lines.join("\n")}\n`;
}

function columnIsNumeric(rows: string[][], index: number): boolean {
  let seen = 0;
  for (const row of rows) {
    const value = (row[index] ?? "").trim();
    if (!value) continue;
    seen++;
    // Leading zeros are identifiers (01, 02), not quantities to perturb.
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return false;
  }
  return seen > 0;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function createSheetCloner(artifact: Artifact): Cloner {
  const headers = artifact.sheet?.headers ?? [];
  const rows = artifact.sheet?.rows ?? [];
  const numeric = headers.map((_, index) => columnIsNumeric(rows, index));
  const deviation = headers.map((_, index) =>
    numeric[index] ? stdev(rows.map((row) => Number(row[index])).filter(Number.isFinite)) : 0,
  );
  const seed = seedFromString(artifact.hash || "sheet", 5);
  const delimiter = artifact.sheet?.format === "TSV" ? "\t" : ",";
  const cache = new Map<string, { score: number; headers: string[]; rows: string[][] }>();
  const defaults: Genome = { spread: 0.35, shift: 0, rowRatio: 1, temperature: 0.7 };

  function build(genome: Genome): { headers: string[]; rows: string[][] } {
    const spread = clamp(num(genome, "spread", 0.35), 0, 1.5);
    const shift = clamp(num(genome, "shift", 0), -0.4, 0.4);
    const rowRatio = clamp(num(genome, "rowRatio", 1), 0.5, 1.25);
    const temperature = clamp(num(genome, "temperature", 0.7), 0.1, 1.6);
    const count = rows.length ? clamp(Math.round(rows.length * rowRatio), 1, Math.ceil(rows.length * 1.25)) : 0;
    const rng = mulberry32(seed);
    const next: string[][] = [];
    for (let r = 0; r < count; r++) {
      const source =
        temperature < 0.35
          ? rows[r % rows.length]
          : rows[Math.floor(rng() * rows.length)];
      next.push(
        headers.map((_, index) => {
          const raw = source?.[index] ?? "";
          if (!numeric[index]) return raw;
          const value = Number(raw);
          if (!Number.isFinite(value)) return raw;
          const noise = (rng() * 2 - 1) * spread * (deviation[index] || 0);
          return String(round(value * (1 + shift) + noise, 4));
        }),
      );
    }
    return { headers: headers.slice(), rows: next };
  }

  function scoreTable(table: { rows: string[][] }): number {
    if (!rows.length) return 0;
    const rowFit =
      Math.min(rows.length, table.rows.length) / Math.max(rows.length, table.rows.length);
    let numericError = 0;
    let numericCount = 0;
    const width = Math.min(headers.length, 12);
    for (let index = 0; index < width; index++) {
      if (!numeric[index]) continue;
      const source = rows.map((row) => Number(row[index])).filter(Number.isFinite);
      const clone = table.rows.map((row) => Number(row[index])).filter(Number.isFinite);
      if (!source.length || !clone.length) continue;
      const sourceMean = source.reduce((sum, value) => sum + value, 0) / source.length;
      const cloneMean = clone.reduce((sum, value) => sum + value, 0) / clone.length;
      const scale = Math.max(1, Math.abs(sourceMean), deviation[index]);
      numericError += Math.min(1, Math.abs(sourceMean - cloneMean) / scale);
      numericCount++;
    }
    const numericFit = numericCount ? 1 - numericError / numericCount : 1;
    return round(clamp(0.25 + 0.45 * numericFit + 0.3 * rowFit, 0, 1), 4);
  }

  function run(genome: Genome) {
    const key = [
      num(genome, "spread", 0.35).toFixed(2),
      num(genome, "shift", 0).toFixed(2),
      num(genome, "rowRatio", 1).toFixed(2),
      num(genome, "temperature", 0.7).toFixed(2),
    ].join("|");
    const hit = cache.get(key);
    if (hit) return hit;
    const table = build(genome);
    const result = { score: scoreTable(table), ...table };
    cache.set(key, result);
    return result;
  }

  return {
    kind: "sheet",
    defaults,
    evaluate: (genome) => run(genome).score,
    materialize(genome): CloneOutput {
      const result = run(genome);
      const csv = tableToCsv(result.headers, result.rows, delimiter);
      return {
        score: result.score,
        text: csv,
        bytes: new TextEncoder().encode(csv),
        filename: `${baseName(artifact.name)}-clone.csv`,
        mime: "text/csv",
        table: { headers: result.headers, rows: result.rows },
        facts: [
          { label: "COLUMNS", value: `${result.headers.length}` },
          { label: "ROWS", value: `${result.rows.length}` },
          { label: "HEADER", value: result.headers.slice(0, 3).join(" · ") || "—" },
          { label: "FIT", value: percent(result.score, 1) },
        ],
      };
    },
    mutate(genome: Genome, rng: Rng) {
      const next: Genome = { ...genome };
      const roll = rng();
      let changed = "";
      if (roll < 0.4) {
        const current = clamp(num(genome, "spread", 0.35), 0, 1.5);
        const updated = clamp(current + (rng() < 0.55 ? -0.15 : 0.15), 0, 1.5);
        next.spread = round(updated, 2);
        changed = `spread ${current.toFixed(2)} → ${updated.toFixed(2)}`;
      } else if (roll < 0.65) {
        const current = clamp(num(genome, "shift", 0), -0.4, 0.4);
        const updated = clamp(current + (rng() < 0.5 ? 0.08 : -0.08), -0.4, 0.4);
        next.shift = round(updated, 2);
        changed = `shift ${current.toFixed(2)} → ${updated.toFixed(2)}`;
      } else if (roll < 0.85) {
        const current = clamp(num(genome, "rowRatio", 1), 0.5, 1.25);
        const updated = clamp(current + (rng() < 0.5 ? 0.1 : -0.1), 0.5, 1.25);
        next.rowRatio = round(updated, 2);
        changed = `rows ${Math.round(current * 100)}% → ${Math.round(updated * 100)}%`;
      } else {
        const current = clamp(num(genome, "temperature", 0.7), 0.1, 1.6);
        const updated = clamp(current + (rng() < 0.5 ? 0.2 : -0.2), 0.1, 1.6);
        next.temperature = round(updated, 2);
        changed = `temperature ${current.toFixed(2)} → ${updated.toFixed(2)}`;
      }
      return { genome: next, changed };
    },
    describe(genome) {
      const spread = clamp(num(genome, "spread", 0.35), 0, 1.5);
      const shift = clamp(num(genome, "shift", 0), -0.4, 0.4);
      const rowRatio = clamp(num(genome, "rowRatio", 1), 0.5, 1.25);
      const temperature = clamp(num(genome, "temperature", 0.7), 0.1, 1.6);
      return [
        { key: "spread", label: "SPREAD", value: spread.toFixed(2), raw: spread, min: 0, max: 1.5 },
        { key: "shift", label: "SHIFT", value: shift.toFixed(2), raw: shift, min: -0.4, max: 0.4 },
        {
          key: "rowRatio",
          label: "ROWS",
          value: `${Math.round(rowRatio * 100)}%`,
          raw: rowRatio,
          min: 0.5,
          max: 1.25,
        },
        {
          key: "temperature",
          label: "SHUFFLE",
          value: temperature.toFixed(2),
          raw: temperature,
          min: 0.1,
          max: 1.6,
        },
      ];
    },
    reflect(seedGenome, best, baseline, score) {
      return `Spread moved ${seedGenome.spread.toFixed(2)} → ${best.spread.toFixed(
        2,
      )} and row count ${Math.round(seedGenome.rowRatio * 100)}% → ${Math.round(
        best.rowRatio * 100,
      )}%. Column fit rose ${((score - baseline) * 100).toFixed(1)} points.`;
    },
  };
}
