import typesSource from "../engine/types.ts?raw";
import utilSource from "../engine/util.ts?raw";
import dissectSource from "../engine/dissect.ts?raw";
import imageSource from "../engine/image.ts?raw";
import textSource from "../engine/text.ts?raw";
import binarySource from "../engine/binary.ts?raw";
import clonerSource from "../engine/index.ts?raw";
import exactSource from "../engine/exact.ts?raw";
import demangleSource from "../engine/demangle.ts?raw";
import machoSource from "../engine/macho.ts?raw";
import memorySource from "../engine/memory.ts?raw";

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const README = [
  "# MITOSIS engine kit",
  "",
  "This is the reusable core of MITOSIS: artifact dissection, image/text/binary",
  "cloners, exact-copy helpers, Mach-O reports, and the local retain/recall/reflect loop.",
  "",
  "It has no runtime dependencies. The engine uses browser APIs: File, Blob,",
  "Canvas 2D, crypto.subtle, and localStorage.",
  "",
  "## Use it",
  "",
  "1. Copy `engine/` into your project.",
  "2. Import the barrel from `engine/index.ts`.",
  "",
  "```ts",
  'import { createCloner, dissectFile } from "./engine";',
  "",
  "const artifact = await dissectFile(file);",
  "const cloner = createCloner(artifact);",
  "const clone = cloner.materialize(cloner.defaults);",
  "```",
  "",
  "`dissectFile` returns an Artifact with format, a 64-hex SHA-256 of the",
  "analyzed sample, entropy,",
  "strings, headers, and sections. Binary dissection parses ELF, PE, and",
  "Mach-O headers and section tables, including fat Mach-O architectures.",
  "`createCloner` selects the image, text, or binary strategy. Each cloner exposes:",
  "",
  "- `defaults` and `evaluate(genome)`",
  "- `materialize(genome)` for the current reconstruction",
  "- `mutate(genome, rng)` for the next candidate",
  "- `describe(genome)` for UI parameter rows",
  "- `reflect(seed, best, baseline, score)` for the learning loop summary",
  "",
  "The memory module is optional. `recordRun`, `recallMemories`, and",
  "`updateRun` operate on a plain `Mind` object and persist through",
  "`loadMind`/`saveMind`.",
  "",
  "## Mach-O reports",
  "",
  "`analyzeMachO(file)` parses a thin or universal Mach-O executable and returns",
  "segments, sections, `LC_SYMTAB` symbols, linked libraries, rpaths, and",
  "printable strings. Each symbol carries its raw name plus a best-effort",
  "`demangled` name and `language`; Objective-C classes, protocols, methods,",
  "ivars, and selectors are collected separately. This is static structural",
  "analysis, not decompilation.",
  "",
  "```ts",
  'import { analyzeMachO, formatMachOReport } from "./engine";',
  "",
  "const report = await analyzeMachO(file);",
  "if (report) {",
  '  const json = formatMachOReport(report, "json");',
  '  const markdown = formatMachOReport(report, "markdown");',
  "}",
  "```",
  "",
  "The analyzer reads up to 64 MB and caps the report at 20,000 symbols and",
  "5,000 strings. It needs `File`, `crypto.subtle`, and `Blob`/DOM for downloads.",
  "Swift demangling is best-effort for common mangled forms; C++ names are",
  "identified but not demangled. You can call `demangleSymbol(raw)` directly.",
  "",
  "The exact-copy helper is separate from the statistical cloners:",
  "",
  "```ts",
  'import { readExact, saveExact } from "./engine";',
  "",
  "saveExact(file);",
  "const bytes = await readExact(file);",
  "```",
  "",
  "See `example.ts` for a small integration and `manifest.json` for the file",
  "layout. The engine is browser-side code, not a Node service.",
  "",
  "## Constraints",
  "",
  "MITOSIS intentionally reads a bounded sample (8 MB) and reconstructs",
  "statistics rather than copying bytes. `saveExact` downloads the original",
  "file bytes exactly. It cannot copy directories or app bundles; use your",
  "host app's native file-copy path for those.",
  "",
  "Source: https://github.com/jackjjack1/mitosis",
].join("\n");

const EXAMPLE = [
  'import { createCloner, dissectFile } from "./engine";',
  "",
  "export async function cloneFile(file: File) {",
  "  const artifact = await dissectFile(file);",
  "  const cloner = createCloner(artifact);",
  "",
  "  let genome = cloner.defaults;",
  "  let score = cloner.evaluate(genome);",
  "",
  "  for (let attempt = 0; attempt < 32; attempt++) {",
  "    const mutation = cloner.mutate(genome, Math.random);",
  "    const candidate = cloner.evaluate(mutation.genome);",
  "    if (candidate > score) {",
  "      genome = mutation.genome;",
  "      score = candidate;",
  "    }",
  "  }",
  "",
  "  return {",
  "    artifact,",
  "    genome,",
  "    score,",
  "    output: cloner.materialize(genome),",
  "  };",
  "}",
  "",
].join("\n");

const MANIFEST = `${JSON.stringify(
  {
    name: "mitosis-engine",
    version: "0.1.0",
    entry: "engine/index.ts",
    runtime: "browser",
    features: [
      "artifact dissection",
      "ELF/PE/Mach-O headers",
      "Mach-O symbols/strings/sections",
      "Swift and Objective-C name recovery",
      "JSON and Markdown analysis reports",
      "image cloner",
      "text cloner",
      "binary cloner",
      "exact original download",
      "retain/recall/reflect memory",
    ],
    source: "https://github.com/jackjjack1/mitosis",
  },
  null,
  2,
)}\n`;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zipStore(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const now = new Date();
  const time =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    (Math.floor(now.getSeconds() / 2) & 0x1f);
  const date =
    (((now.getFullYear() - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data;
    const checksum = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);

    localChunks.push(local, data);
    centralChunks.push(central);
    offset += local.length + data.length;
  }

  const centralOffset = offset;
  for (const central of centralChunks) {
    localChunks.push(central);
    offset += central.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, offset - centralOffset, true);
  endView.setUint32(16, centralOffset, true);
  endView.setUint16(20, 0, true);
  localChunks.push(end);

  const total = localChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of localChunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.length;
  }
  return new Blob([bytes.buffer as ArrayBuffer], { type: "application/zip" });
}

function encode(source: string): Uint8Array {
  return new TextEncoder().encode(source);
}

export function buildEngineKit(): Blob {
  return zipStore([
    { name: "README.md", data: encode(README) },
    { name: "manifest.json", data: encode(MANIFEST) },
    { name: "example.ts", data: encode(EXAMPLE) },
    { name: "engine/types.ts", data: encode(typesSource) },
    { name: "engine/util.ts", data: encode(utilSource) },
    { name: "engine/dissect.ts", data: encode(dissectSource) },
    { name: "engine/image.ts", data: encode(imageSource) },
    { name: "engine/text.ts", data: encode(textSource) },
    { name: "engine/binary.ts", data: encode(binarySource) },
    { name: "engine/exact.ts", data: encode(exactSource) },
    { name: "engine/demangle.ts", data: encode(demangleSource) },
    { name: "engine/macho.ts", data: encode(machoSource) },
    { name: "engine/index.ts", data: encode(clonerSource) },
    { name: "engine/memory.ts", data: encode(memorySource) },
  ]);
}

export function downloadEngineKit(): void {
  const url = URL.createObjectURL(buildEngineKit());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "mitosis-engine-kit.zip";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 600);
}
