import type { Artifact, Cloner, CloneOutput, Genome, PdfInfo, Rng } from "./types";
import { arrayBufferOf, baseName, clamp, mulberry32, num, percent, round, seedFromString } from "./util";

const TOKEN_RE = /\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g;

function latin(bytes: Uint8Array): string {
  let out = "";
  const step = 8192;
  for (let i = 0; i < bytes.length; i += step) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + step));
    out += String.fromCharCode(...slice);
  }
  return out;
}

function unescapePdf(value: string): string {
  return value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_match, code: string) => {
    if (code === "n") return "\n";
    if (code === "r") return "\r";
    if (code === "t") return "\t";
    if (code === "b") return "\b";
    if (code === "f") return "\f";
    if (code === "(" || code === ")" || code === "\\") return code;
    return String.fromCharCode(parseInt(code, 8));
  });
}

function stringsFromOperators(source: string): string[] {
  const out: string[] = [];
  const single = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = single.exec(source))) out.push(unescapePdf(match[1]));
  const arrays = /\[([\s\S]*?)\]\s*TJ/g;
  while ((match = arrays.exec(source))) {
    const inner = /\(((?:\\.|[^\\)])*)\)/g;
    let part: RegExpExecArray | null;
    while ((part = inner.exec(match[1]))) out.push(unescapePdf(part[1]));
  }
  return out;
}

async function inflateFlate(bytes: Uint8Array): Promise<string[]> {
  const texts: string[] = [];
  const source = latin(bytes);
  const marker = "FlateDecode";
  let cursor = 0;
  while (cursor < source.length) {
    const at = source.indexOf(marker, cursor);
    if (at < 0) break;
    const streamAt = source.indexOf("stream", at);
    if (streamAt < 0) break;
    let dataAt = streamAt + "stream".length;
    if (source[dataAt] === "\r") dataAt++;
    if (source[dataAt] === "\n") dataAt++;
    const end = source.indexOf("endstream", dataAt);
    if (end < 0) break;
    const slice = bytes.subarray(dataAt, end);
    try {
      const stream = new Blob([arrayBufferOf(slice)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
      texts.push(latin(inflated));
    } catch {
      // A stream that is not deflate stays out of the text sample.
    }
    cursor = end + "endstream".length;
  }
  return texts;
}

export function looksLikePdf(bytes: Uint8Array, name: string): boolean {
  return (
    (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) ||
    name.toLowerCase().endsWith(".pdf")
  );
}

export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const raw = latin(bytes);
  const pages = (raw.match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
  const inflated = await inflateFlate(bytes);
  const pieces = [raw, ...inflated].flatMap(stringsFromOperators);
  const text = pieces.join(" ").replace(/\s+/g, " ").trim().slice(0, 16000);
  return { text, pages };
}

export async function readPdf(bytes: Uint8Array): Promise<PdfInfo> {
  const extracted = await extractPdfText(bytes);
  return { pages: extracted.pages, text: extracted.text, chars: extracted.text.length };
}

function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

function gramSet(tokens: string[], n: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + n <= tokens.length; i++) set.add(tokens.slice(i, i + n).join("\u0001"));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

function escapePdf(value: string): string {
  return value.replace(/[\\()]/g, (char) => `\\${char}`);
}

export function buildPdf(text: string, fontSize: number): Uint8Array {
  const lines = text.replace(/\s+/g, " ").trim().match(/.{1,80}(\s|$)/g) ?? [text || " "];
  const size = clamp(Math.round(fontSize), 8, 18);
  const commands = ["BT", `/F1 ${size} Tf`, "72 740 Td"];
  lines.slice(0, 40).forEach((line, index) => {
    if (index) commands.push("0 -16 Td");
    commands.push(`(${escapePdf(line.trim())}) Tj`);
  });
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

export function createPdfCloner(artifact: Artifact): Cloner {
  const tokens = tokenize(artifact.pdf?.text ?? "").slice(0, 4000);
  const sourceTrigrams = gramSet(tokens, 3);
  const seed = seedFromString(artifact.hash || "pdf", 4);
  const cache = new Map<string, { score: number; text: string }>();
  const defaults: Genome = { order: 2, temperature: 0.8, fontSize: 12 };

  function generate(genome: Genome): string {
    if (tokens.length < 4) return artifact.pdf?.text ?? "";
    const order = clamp(Math.round(num(genome, "order", 2)), 1, 5);
    const temperature = clamp(num(genome, "temperature", 0.8), 0.3, 1.6);
    const maps = new Map<string, Map<string, number>>();
    for (let i = order; i < tokens.length; i++) {
      const key = tokens.slice(i - order, i).join("\u0001");
      let dist = maps.get(key);
      if (!dist) {
        dist = new Map();
        maps.set(key, dist);
      }
      const token = tokens[i];
      dist.set(token, (dist.get(token) ?? 0) + 1);
    }
    const rng = mulberry32(seed);
    const start = Math.floor(rng() * Math.max(1, tokens.length - order));
    const output = tokens.slice(start, start + order);
    const target = Math.min(tokens.length, 1200);
    while (output.length < target) {
      const key = output.slice(output.length - order).join("\u0001");
      const dist = maps.get(key);
      if (!dist) break;
      const entries = [...dist.entries()];
      let total = 0;
      const power = 1 / Math.max(0.25, temperature);
      const weights = entries.map(([, count]) => {
        const weight = count ** power;
        total += weight;
        return weight;
      });
      let cursor = rng() * total;
      let next = entries[entries.length - 1][0];
      for (let i = 0; i < entries.length; i++) {
        cursor -= weights[i];
        if (cursor <= 0) {
          next = entries[i][0];
          break;
        }
      }
      output.push(next);
    }
    return output.join("");
  }

  function run(genome: Genome): { score: number; text: string } {
    const key = [
      Math.round(num(genome, "order", 2)),
      num(genome, "temperature", 0.8).toFixed(2),
      Math.round(num(genome, "fontSize", 12)),
    ].join("|");
    const hit = cache.get(key);
    if (hit) return hit;
    const text = generate(genome);
    const score = round(clamp(jaccard(sourceTrigrams, gramSet(tokenize(text), 3)), 0, 1), 4);
    const result = { score, text };
    cache.set(key, result);
    return result;
  }

  return {
    kind: "pdf",
    defaults,
    evaluate: (genome) => run(genome).score,
    materialize(genome): CloneOutput {
      const result = run(genome);
      const fontSize = clamp(Math.round(num(genome, "fontSize", 12)), 8, 18);
      return {
        score: result.score,
        text: result.text,
        bytes: buildPdf(result.text, fontSize),
        filename: `${baseName(artifact.name)}-clone.pdf`,
        mime: "application/pdf",
        facts: [
          { label: "PAGES", value: `${artifact.pdf?.pages ?? 0}` },
          { label: "CHARACTERS", value: result.text.length.toLocaleString() },
          { label: "TRIGRAMS", value: percent(result.score, 1) },
          { label: "FONT", value: `${fontSize} pt` },
        ],
      };
    },
    mutate(genome: Genome, rng: Rng) {
      const next: Genome = { ...genome };
      const roll = rng();
      let changed = "";
      if (roll < 0.46) {
        const current = clamp(Math.round(num(genome, "order", 2)), 1, 5);
        const updated = clamp(current + (rng() < 0.7 ? 1 : -1), 1, 5);
        next.order = updated;
        changed = `context order ${current} → ${updated}`;
      } else if (roll < 0.8) {
        const current = clamp(num(genome, "temperature", 0.8), 0.3, 1.6);
        const updated = clamp(current + (rng() < 0.5 ? 0.15 : -0.15), 0.3, 1.6);
        next.temperature = round(updated, 2);
        changed = `temperature ${current.toFixed(2)} → ${updated.toFixed(2)}`;
      } else {
        const current = clamp(Math.round(num(genome, "fontSize", 12)), 8, 18);
        const updated = clamp(current + (rng() < 0.5 ? 1 : -1), 8, 18);
        next.fontSize = updated;
        changed = `font ${current} → ${updated} pt`;
      }
      return { genome: next, changed };
    },
    describe(genome) {
      const order = clamp(Math.round(num(genome, "order", 2)), 1, 5);
      const temperature = clamp(num(genome, "temperature", 0.8), 0.3, 1.6);
      const fontSize = clamp(Math.round(num(genome, "fontSize", 12)), 8, 18);
      return [
        { key: "order", label: "CONTEXT ORDER", value: `${order} tokens`, raw: order, min: 1, max: 5 },
        {
          key: "temperature",
          label: "TEMPERATURE",
          value: temperature.toFixed(2),
          raw: temperature,
          min: 0.3,
          max: 1.6,
        },
        { key: "fontSize", label: "FONT", value: `${fontSize} pt`, raw: fontSize, min: 8, max: 18 },
      ];
    },
    reflect(seedGenome, best, baseline, score) {
      return `Context order moved ${Math.round(seedGenome.order)} → ${Math.round(
        best.order,
      )}. Page text match rose ${((score - baseline) * 100).toFixed(1)} points.`;
    },
  };
}
