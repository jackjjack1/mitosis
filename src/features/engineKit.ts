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
import featuresSource from "../engine/features.ts?raw";
import evolveSource from "../engine/evolve.ts?raw";
import sessionSource from "../engine/session.ts?raw";
import exportSource from "../engine/export.ts?raw";
import audioSource from "../engine/audio.ts?raw";
import pdfSource from "../engine/pdf.ts?raw";
import sheetSource from "../engine/sheet.ts?raw";
import { zipStore } from "./zip";

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
  "`loadMind`/`saveMind`. `startEvolution(cloner, seed?)` and",
  "`advanceEvolution` hill-climb one genome and record a score history.",
  "`exportReconstruction` turns the current clone into PNG, text, or raw",
  "bytes. `encodeCloneSession` / `decodeCloneSession` save and reopen that",
  "run as a versioned `.clone` file (UTI `io.freebuff.mitosis.clone`).",
  "`startPopulation` / `advancePopulation` add crossover and selection.",
  "`advanceEvolution` remains the single-genome hill climb.",
  "Audio, PDF, and spreadsheet artifacts select their own cloners.",
  "",
  "## Usable features",
  "",
  "`extractFeatures(artifact, analysis)` turns a dissected artifact into feature",
  "cards plus plain files: palette CSS, voice JSON, API Markdown, dependencies,",
  "structure, strings, and an artifact fingerprint.",
  "",
  "```ts",
  'import { analyzeMachO, dissectFile, extractFeatures } from "./engine";',
  "",
  "const artifact = await dissectFile(file);",
  "const analysis = await analyzeMachO(file);",
  "const features = extractFeatures(artifact, analysis);",
  "```",
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
      "usable feature extraction",
      "image cloner",
      "text cloner",
      "binary cloner",
      "exact original download",
      "retain/recall/reflect memory",
      "single-genome evolution history",
      "png/txt/bin reconstruction export",
      "versioned .clone sessions",
      "audio wav/mp3 cloner",
      "pdf cloner",
      "spreadsheet csv/xlsx cloner",
      "population crossover",
    ],
    source: "https://github.com/jackjjack1/mitosis",
  },
  null,
  2,
)}\n`;

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
    { name: "engine/features.ts", data: encode(featuresSource) },
    { name: "engine/index.ts", data: encode(clonerSource) },
    { name: "engine/memory.ts", data: encode(memorySource) },
    { name: "engine/evolve.ts", data: encode(evolveSource) },
    { name: "engine/session.ts", data: encode(sessionSource) },
    { name: "engine/export.ts", data: encode(exportSource) },
    { name: "engine/audio.ts", data: encode(audioSource) },
    { name: "engine/pdf.ts", data: encode(pdfSource) },
    { name: "engine/sheet.ts", data: encode(sheetSource) },
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
