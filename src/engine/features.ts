import type { MachOAnalysis, MachOArchitecture } from "./macho";
import type { Artifact } from "./types";
import { baseName, fmtBytes } from "./util";

export interface FeatureFile {
  name: string;
  content: string;
}

export interface Feature {
  id: string;
  label: string;
  title: string;
  detail: string;
  copy: string;
  copyLabel: string;
  files: string[];
}

export interface FeatureSet {
  name: string;
  base: string;
  format: string;
  size: number;
  hash: string;
  headline: string;
  summary: { label: string; value: string }[];
  features: Feature[];
  files: FeatureFile[];
}

const MAX_COPY = 7000;
const MAX_STRING_FILES = 4000;

function trimmed(text: string, limit = MAX_COPY): string {
  const clean = text.trimEnd();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit)}\n\n… ${(clean.length - limit).toLocaleString()} more characters in the bundle.`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function markdownTable(rows: [string, string][]): string {
  if (!rows.length) return "_none recorded_";
  return [
    "| Field | Value |",
    "| --- | --- |",
    ...rows.map(([key, value]) => `| ${key} | ${value.replace(/\|/g, "\\|")} |`),
  ].join("\n");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/* ---------- image ------------------------------------------------------- */

function imageFeatures(artifact: Artifact): { features: Feature[]; files: FeatureFile[] } {
  const image = artifact.image;
  if (!image) return { features: [], files: [] };
  const swatches = unique(image.swatches);
  const aspect = image.width / image.height;
  const ratio =
    Math.abs(aspect - 16 / 9) < 0.02
      ? "16:9"
      : Math.abs(aspect - 4 / 3) < 0.02
        ? "4:3"
        : Math.abs(aspect - 1) < 0.01
          ? "1:1"
          : `${aspect.toFixed(3)}:1`;

  const paletteCss = [
    ":root {",
    ...swatches.map((hex, index) => `  --swatch-${index + 1}: ${hex};`),
    "}",
    "",
  ].join("\n");
  const paletteJson = json({
    source: artifact.name,
    colors: swatches,
    accessibilityPairings: swatches.map((hex) => ({
      background: hex,
      text: luminance(hex) > 0.55 ? "#0b100b" : "#f5faf0",
    })),
  });

  const geometry = {
    width: image.width,
    height: image.height,
    aspect: ratio,
    sampled: `${image.sampleWidth}×${image.sampleHeight}`,
    hasAlpha: image.hasAlpha,
    entropy: artifact.entropy,
  };

  return {
    features: [
      {
        id: "palette",
        label: "PALETTE",
        title: `${swatches.length} color${swatches.length === 1 ? "" : "s"} ready as CSS`,
        detail: "Median-cut swatches from the sampled pixels, with a readable text tone per background.",
        copy: trimmed(paletteCss),
        copyLabel: "CSS",
        files: ["palette.css", "palette.json"],
      },
      {
        id: "geometry",
        label: "GEOMETRY",
        title: `${image.width}×${image.height} · ${ratio}`,
        detail: `${image.hasAlpha ? "Transparent" : "Opaque"} pixels, ${artifact.entropy.toFixed(2)} bits/byte entropy.`,
        copy: json(geometry),
        copyLabel: "JSON",
        files: ["geometry.json"],
      },
    ],
    files: [
      { name: "palette.css", content: paletteCss },
      { name: "palette.json", content: paletteJson },
      { name: "geometry.json", content: json(geometry) },
    ],
  };
}

function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  if (clean.length < 6) return 0;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/* ---------- text -------------------------------------------------------- */

const STOP_WORDS = new Set(
  "the a an and or but if then than that this these those of to in on for with as at by from is are was were be been being it its it's you your we our they their he she his her not no do does did have has had will would can could should may might must about into over under more most some such only own same so too very just also there here what which who whom when where why how all any both each few other".split(
    " ",
  ),
);

interface TextMetrics {
  chars: number;
  words: number;
  uniqueWords: number;
  sentences: number;
  avgSentence: number;
  avgWord: number;
  punctuation: number;
  keywords: { word: string; count: number }[];
}

function textMetrics(sample: string): TextMetrics {
  const words = sample.toLowerCase().match(/[a-z][a-z'’-]*/g) ?? [];
  const sentences = sample.split(/[.!?]+/).filter((part) => part.trim().length > 1);
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const punctuation = (sample.match(/[,;:—–()[\]{}"'“”‘’]/g) ?? []).length;

  const keywords = [...counts.entries()]
    .filter(([word]) => word.length > 2 && !STOP_WORDS.has(word))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 24)
    .map(([word, count]) => ({ word, count }));

  return {
    chars: sample.length,
    words: words.length,
    uniqueWords: counts.size,
    sentences: sentences.length,
    avgSentence: sentences.length ? words.length / sentences.length : words.length,
    avgWord: words.length
      ? words.reduce((sum, word) => sum + word.length, 0) / words.length
      : 0,
    punctuation: sample.length ? punctuation / sample.length : 0,
    keywords,
  };
}

function textFeatures(artifact: Artifact): { features: Feature[]; files: FeatureFile[] } {
  const sample = artifact.text?.sample ?? "";
  if (!sample.trim()) return { features: [], files: [] };
  const metrics = textMetrics(sample);
  const vocabulary = unique(
    (sample.toLowerCase().match(/[a-z][a-z'’-]*/g) ?? []).sort(),
  );
  const styleBrief = [
    "# Voice brief",
    "",
    `Source: \`${artifact.name}\` (${artifact.format}, ${fmtBytes(artifact.size)}).`,
    "",
    "## Cadence",
    "",
    `- Average sentence: ${metrics.avgSentence.toFixed(1)} words`,
    `- Average word: ${metrics.avgWord.toFixed(2)} characters`,
    `- Punctuation density: ${(metrics.punctuation * 100).toFixed(1)}% of characters`,
    `- Vocabulary: ${metrics.uniqueWords.toLocaleString()} unique words across ${metrics.words.toLocaleString()}`,
    "",
    "## Signature vocabulary",
    "",
    metrics.keywords.length
      ? metrics.keywords
          .slice(0, 14)
          .map((entry) => `- ${entry.word} (×${entry.count})`)
          .join("\n")
      : "- too little text to rank terms",
    "",
    "## Reuse",
    "",
    "Paste this brief above a prompt when you want new copy to inherit this",
    "artifact's rhythm and vocabulary. The numbers describe the sample, not the",
    "whole document.",
    "",
  ].join("\n");

  return {
    features: [
      {
        id: "voice",
        label: "VOICE",
        title: `${metrics.words.toLocaleString()} words · ${metrics.avgSentence.toFixed(1)} per sentence`,
        detail: `${metrics.uniqueWords.toLocaleString()} unique words, ${(metrics.punctuation * 100).toFixed(1)}% punctuation.`,
        copy: json({
          words: metrics.words,
          uniqueWords: metrics.uniqueWords,
          sentences: metrics.sentences,
          avgSentenceWords: Number(metrics.avgSentence.toFixed(2)),
          avgWordChars: Number(metrics.avgWord.toFixed(2)),
          punctuationDensity: Number(metrics.punctuation.toFixed(4)),
        }),
        copyLabel: "JSON",
        files: ["voice.json"],
      },
      {
        id: "vocabulary",
        label: "VOCABULARY",
        title: `${metrics.keywords.length} ranked terms`,
        detail: "Most frequent words with stop words removed, plus the full unique vocabulary.",
        copy: metrics.keywords.map((entry) => `${entry.word} ×${entry.count}`).join("\n"),
        copyLabel: "LIST",
        files: ["keywords.txt", "vocabulary.txt"],
      },
      {
        id: "brief",
        label: "STYLE BRIEF",
        title: "Prompt-ready voice brief",
        detail: "A Markdown description of the sample's cadence and vocabulary.",
        copy: trimmed(styleBrief),
        copyLabel: "MD",
        files: ["style-brief.md"],
      },
    ],
    files: [
      {
        name: "voice.json",
        content: json({
          source: artifact.name,
          sampleChars: metrics.chars,
          words: metrics.words,
          uniqueWords: metrics.uniqueWords,
          sentences: metrics.sentences,
          avgSentenceWords: Number(metrics.avgSentence.toFixed(2)),
          avgWordChars: Number(metrics.avgWord.toFixed(2)),
          punctuationDensity: Number(metrics.punctuation.toFixed(4)),
        }),
      },
      {
        name: "keywords.txt",
        content: `${metrics.keywords.map((entry) => `${entry.word}\t${entry.count}`).join("\n")}\n`,
      },
      {
        name: "vocabulary.txt",
        content: `${vocabulary.slice(0, 20000).join("\n")}\n`,
      },
      { name: "style-brief.md", content: styleBrief },
    ],
  };
}

/* ---------- Mach-O ------------------------------------------------------ */

function symbolGroups(architecture: MachOArchitecture): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const symbol of architecture.symbols) {
    const name = symbol.demangled ?? symbol.name;
    if (!name) continue;
    // Swift declarations without a signature are type/property metadata, not API.
    if (symbol.language === "swift" && symbol.demangled && !symbol.demangled.includes("(")) {
      continue;
    }
    const key =
      symbol.objectiveC?.kind === "class"
        ? "Objective-C classes"
        : symbol.objectiveC?.kind === "protocol"
          ? "Objective-C protocols"
          : symbol.language === "swift"
            ? "Swift API"
            : symbol.language === "c++"
              ? "C++ symbols"
              : symbol.language === "objc"
                ? "Objective-C methods"
                : "Exported symbols";
    const list = groups.get(key) ?? [];
    list.push(name);
    groups.set(key, list);
  }
  return groups;
}

function machoFeatures(analysis: MachOAnalysis): { features: Feature[]; files: FeatureFile[] } {
  const api: string[] = ["# API surface", ""];
  const objc: string[] = ["# Objective-C surface", ""];
  const dependencies = unique(
    analysis.architectures.flatMap((architecture) => [
      ...architecture.libraries,
      ...architecture.rpaths.map((rpath) => `rpath: ${rpath}`),
    ]),
  );
  const structure: string[] = ["# Structure", ""];
  const strings = unique(analysis.architectures.flatMap((architecture) => architecture.strings.map((entry) => entry.value)));
  const symbols = analysis.architectures.flatMap((architecture) =>
    architecture.symbols.map((symbol) => ({
      architecture: architecture.name,
      name: symbol.name,
      demangled: symbol.demangled ?? null,
      language: symbol.language ?? "unknown",
      kind: symbol.kind,
      section: symbol.section || null,
      address: symbol.addressHex,
      library: symbol.library ?? null,
    })),
  );

  for (const architecture of analysis.architectures) {
    api.push(`## ${architecture.name} · ${architecture.fileType}`, "");
    const groups = symbolGroups(architecture);
    for (const [group, names] of groups) {
      api.push(`### ${group} (${names.length.toLocaleString()})`, "", "```");
      api.push(...names.slice(0, 2000));
      api.push("```", "");
    }

    objc.push(`## ${architecture.name}`, "");
    if (architecture.objectiveC.classes.length) {
      objc.push(
        `**Classes (${architecture.objectiveC.classes.length}):** ${architecture.objectiveC.classes.join(", ")}`,
        "",
      );
    }
    if (architecture.objectiveC.protocols.length) {
      objc.push(
        `**Protocols (${architecture.objectiveC.protocols.length}):** ${architecture.objectiveC.protocols.join(", ")}`,
        "",
      );
    }
    if (architecture.objectiveC.methods.length) {
      objc.push("| Class | Method | Kind |", "| --- | --- | :---: |");
      for (const method of architecture.objectiveC.methods.slice(0, 2000)) {
        objc.push(
          `| ${method.className} | ${method.selector} | ${method.classMethod ? "class" : "instance"} |`,
        );
      }
      objc.push("");
    }
    if (architecture.objectiveC.selectors.length) {
      objc.push(
        `**Selectors (${architecture.objectiveC.selectors.length}):** ${architecture.objectiveC.selectors.slice(0, 500).join(", ")}`,
        "",
      );
    }

    structure.push(`## ${architecture.name} · ${architecture.fileType} · ${architecture.bitness}-bit`, "");
    structure.push(
      markdownTable([
        ["CPU", architecture.cpu],
        ["Platform", architecture.platform ?? "unknown"],
        ["Min OS", architecture.minOS ?? "unknown"],
        ["SDK", architecture.sdk ?? "unknown"],
        ["Entry point", architecture.entryPoint ?? "unknown"],
        ["Install name", architecture.installName ?? "unknown"],
        ["Encrypted", architecture.encrypted ? "yes" : "no"],
      ]),
      "",
    );
    structure.push("### Segments", "", "| Segment | Size | Protection | Sections |", "| --- | ---: | --- | ---: |");
    for (const segment of architecture.segments) {
      structure.push(
        `| ${segment.name} | ${fmtBytes(segment.fileSize)} | ${segment.protection} | ${segment.sectionCount} |`,
      );
    }
    structure.push("", "### Sections", "", "| Section | Size | Entropy | Symbols |", "| --- | ---: | ---: | ---: |");
    for (const section of architecture.sections) {
      structure.push(
        `| ${section.segment},${section.section} | ${fmtBytes(section.size)} | ${section.entropy.toFixed(2)} | ${section.symbolCount} |`,
      );
    }
    structure.push("");
  }

  const apiText = api.join("\n");
  const objcText = objc.join("\n");
  const structureText = structure.join("\n");
  const totals = analysis.totals;

  return {
    features: [
      {
        id: "api",
        label: "API SURFACE",
        title: `${totals.symbols.toLocaleString()} symbols · ${totals.swiftSymbols.toLocaleString()} Swift`,
        detail: "Recovered declarations grouped by language, ready to paste into a spec or prompt.",
        copy: trimmed(apiText),
        copyLabel: "MD",
        files: ["api.md", "symbols.json"],
      },
      {
        id: "objc",
        label: "OBJECTIVE-C",
        title: `${totals.objcClasses} classes · ${totals.objcMethods} methods`,
        detail: "Classes, protocols, selectors, and methods recovered from symbols and metadata.",
        copy: trimmed(objcText),
        copyLabel: "MD",
        files: ["objective-c.md"],
      },
      {
        id: "dependencies",
        label: "DEPENDENCIES",
        title: `${totals.libraries} linked libraries`,
        detail: "Linked dylibs plus rpath search paths, deduplicated across architectures.",
        copy: trimmed(dependencies.join("\n")),
        copyLabel: "TXT",
        files: ["dependencies.txt"],
      },
      {
        id: "structure",
        label: "STRUCTURE",
        title: `${totals.sections.toLocaleString()} sections · ${analysis.format}`,
        detail: "Segments, sections, entropy, and load-command metadata per architecture.",
        copy: trimmed(structureText),
        copyLabel: "MD",
        files: ["structure.md"],
      },
      {
        id: "strings",
        label: "STRINGS",
        title: `${totals.strings.toLocaleString()} printable strings`,
        detail: "Section-scoped strings, useful for endpoints, messages, and format hints.",
        copy: trimmed(strings.slice(0, 300).join("\n")),
        copyLabel: "TXT",
        files: ["strings.txt"],
      },
    ],
    files: [
      { name: "api.md", content: `${apiText}\n` },
      { name: "objective-c.md", content: `${objcText}\n` },
      { name: "dependencies.txt", content: `${dependencies.join("\n")}\n` },
      { name: "structure.md", content: `${structureText}\n` },
      { name: "strings.txt", content: `${strings.slice(0, MAX_STRING_FILES).join("\n")}\n` },
      { name: "symbols.json", content: json(symbols) },
    ],
  };
}

/* ---------- plain binary ------------------------------------------------ */

function binaryFeatures(artifact: Artifact): { features: Feature[]; files: FeatureFile[] } {
  const binary = artifact.binary;
  if (!binary) return { features: [], files: [] };
  const strings = unique(binary.strings);
  const structure = [
    "# Structure",
    "",
    markdownTable([
      ...binary.headerInfo,
      ["Format", artifact.format],
      ["Entropy", artifact.entropy.toFixed(3)],
    ]),
    "",
    "## Sections",
    "",
    binary.sections.length
      ? ["| Section | Size | Address |", "| --- | ---: | ---: |"]
          .concat(
            binary.sections.map(
              (section) =>
                `| ${section.name} | ${fmtBytes(section.size)} | 0x${section.address.toString(16)} |`,
            ),
          )
          .join("\n")
      : "_No section table recorded._",
    "",
  ].join("\n");

  return {
    features: [
      {
        id: "structure",
        label: "STRUCTURE",
        title: `${binary.sections.length} sections · ${artifact.format}`,
        detail: "Magic, parsed headers, and section table from the analyzed bytes.",
        copy: trimmed(structure),
        copyLabel: "MD",
        files: ["structure.md"],
      },
      {
        id: "strings",
        label: "STRINGS",
        title: `${strings.length.toLocaleString()} printable strings`,
        detail: "Runs of printable bytes from the sampled data sections.",
        copy: trimmed(strings.slice(0, 300).join("\n")),
        copyLabel: "TXT",
        files: ["strings.txt"],
      },
      {
        id: "fingerprint",
        label: "FINGERPRINT",
        title: `${artifact.hash.slice(0, 16).toUpperCase()}…`,
        detail: `SHA-256 of the analyzed head · ${fmtBytes(artifact.size)} · ${artifact.entropy.toFixed(2)} bits/byte.`,
        copy: json({
          name: artifact.name,
          size: artifact.size,
          format: artifact.format,
          magic: artifact.magic,
          sha256: artifact.hash,
          entropy: artifact.entropy,
        }),
        copyLabel: "JSON",
        files: ["fingerprint.json"],
      },
    ],
    files: [
      { name: "structure.md", content: `${structure}\n` },
      { name: "strings.txt", content: `${strings.slice(0, MAX_STRING_FILES).join("\n")}\n` },
      {
        name: "fingerprint.json",
        content: json({
          name: artifact.name,
          size: artifact.size,
          format: artifact.format,
          magic: artifact.magic,
          sha256: artifact.hash,
          entropy: artifact.entropy,
          notes: artifact.notes,
        }),
      },
    ],
  };
}

/* ---------- stage 2 kinds ---------------------------------------------- */

function audioFeatures(artifact: Artifact): { features: Feature[]; files: FeatureFile[] } {
  const audio = artifact.audio;
  if (!audio) return { features: [], files: [] };
  const profile = {
    format: audio.format,
    sampleRate: audio.sampleRate,
    channels: audio.channels,
    duration: audio.duration,
    rms: audio.rms,
    spectrum: audio.spectrum,
  };
  return {
    features: [
      {
        id: "waveform",
        label: "WAVEFORM",
        title: "Loudness contour",
        detail: `${audio.waveform.length} peaks over ${audio.duration.toFixed(2)} s at ${audio.sampleRate} Hz.`,
        copy: audio.waveform.map((value) => value.toFixed(4)).join("\n"),
        copyLabel: "TEXT",
        files: ["waveform.txt"],
      },
      {
        id: "spectrum",
        label: "SPECTRUM",
        title: "Spectral shape",
        detail: `${audio.spectrum.length} magnitude bins, RMS ${audio.rms.toFixed(3)}.`,
        copy: json(profile),
        copyLabel: "JSON",
        files: ["spectrum.json"],
      },
    ],
    files: [
      { name: "waveform.txt", content: `${audio.waveform.map((value) => value.toFixed(4)).join("\n")}\n` },
      { name: "spectrum.json", content: json(profile) },
    ],
  };
}

function pdfFeatures(artifact: Artifact): { features: Feature[]; files: FeatureFile[] } {
  const pdf = artifact.pdf;
  if (!pdf) return { features: [], files: [] };
  return {
    features: [
      {
        id: "page-text",
        label: "PAGE TEXT",
        title: "Extracted page text",
        detail: `${pdf.pages} page${pdf.pages === 1 ? "" : "s"} · ${pdf.chars.toLocaleString()} characters.`,
        copy: trimmed(pdf.text || "No extractable text."),
        copyLabel: "TEXT",
        files: ["page-text.txt"],
      },
    ],
    files: [
      { name: "page-text.txt", content: `${pdf.text}\n` },
      { name: "pages.json", content: json({ pages: pdf.pages, chars: pdf.chars }) },
    ],
  };
}

function sheetFeatures(artifact: Artifact): { features: Feature[]; files: FeatureFile[] } {
  const sheet = artifact.sheet;
  if (!sheet) return { features: [], files: [] };
  const preview = [sheet.headers.join(","), ...sheet.rows.slice(0, 12).map((row) => row.join(","))].join("\n");
  return {
    features: [
      {
        id: "columns",
        label: "COLUMNS",
        title: "Table schema",
        detail: `${sheet.headers.length} columns · ${sheet.rows.length} rows.`,
        copy: json({ format: sheet.format, headers: sheet.headers, rows: sheet.rows.length }),
        copyLabel: "JSON",
        files: ["columns.json"],
      },
      {
        id: "preview",
        label: "PREVIEW",
        title: "First rows",
        detail: sheet.headers.slice(0, 6).join(" · ") || "Empty sheet",
        copy: preview,
        copyLabel: "CSV",
        files: ["preview.csv"],
      },
    ],
    files: [
      { name: "columns.json", content: json({ format: sheet.format, headers: sheet.headers, rows: sheet.rows.length }) },
      { name: "preview.csv", content: `${preview}\n` },
    ],
  };
}

/* ---------- assembly ---------------------------------------------------- */

export function extractFeatures(
  artifact: Artifact,
  analysis: MachOAnalysis | null,
): FeatureSet {
  const extracted = analysis
    ? machoFeatures(analysis)
    : artifact.kind === "image"
      ? imageFeatures(artifact)
      : artifact.kind === "text"
        ? textFeatures(artifact)
        : artifact.kind === "audio"
          ? audioFeatures(artifact)
          : artifact.kind === "pdf"
            ? pdfFeatures(artifact)
            : artifact.kind === "sheet"
              ? sheetFeatures(artifact)
              : binaryFeatures(artifact);

  const summary: { label: string; value: string }[] = [
    { label: "FORMAT", value: artifact.format },
    { label: "SIZE", value: fmtBytes(artifact.size) },
    { label: "ENTROPY", value: `${artifact.entropy.toFixed(2)} b/B` },
  ];
  if (analysis) {
    summary.push(
      { label: "ARCH", value: `${analysis.totals.architectures}` },
      { label: "SYMBOLS", value: analysis.totals.symbols.toLocaleString() },
      { label: "SWIFT", value: analysis.totals.swiftSymbols.toLocaleString() },
      { label: "STRINGS", value: analysis.totals.strings.toLocaleString() },
    );
  } else if (artifact.kind === "image" && artifact.image) {
    summary.push(
      { label: "PIXELS", value: `${artifact.image.width}×${artifact.image.height}` },
      { label: "SWATCHES", value: `${artifact.image.swatches.length}` },
    );
  } else if (artifact.kind === "text" && artifact.text) {
    summary.push(
      { label: "WORDS", value: artifact.text.words.toLocaleString() },
      { label: "LINES", value: artifact.text.lines.toLocaleString() },
    );
  } else if (artifact.kind === "audio" && artifact.audio) {
    summary.push(
      { label: "RATE", value: `${artifact.audio.sampleRate} Hz` },
      { label: "DURATION", value: `${artifact.audio.duration.toFixed(2)} s` },
    );
  } else if (artifact.kind === "pdf" && artifact.pdf) {
    summary.push(
      { label: "PAGES", value: `${artifact.pdf.pages}` },
      { label: "CHARS", value: artifact.pdf.chars.toLocaleString() },
    );
  } else if (artifact.kind === "sheet" && artifact.sheet) {
    summary.push(
      { label: "COLUMNS", value: `${artifact.sheet.headers.length}` },
      { label: "ROWS", value: `${artifact.sheet.rows.length}` },
    );
  } else if (artifact.binary) {
    summary.push(
      { label: "SECTIONS", value: `${artifact.binary.sections.length}` },
      { label: "STRINGS", value: `${artifact.binary.strings.length}` },
    );
  }

  const featuredFiles = new Set(extracted.files.map((file) => file.name));
  const features = extracted.features.filter((feature) =>
    feature.files.some((file) => featuredFiles.has(file)),
  );

  const base = baseName(artifact.name);
  const files: FeatureFile[] = [
    ...extracted.files,
    {
      name: "artifact.json",
      content: json({
        name: artifact.name,
        size: artifact.size,
        format: artifact.format,
        magic: artifact.magic,
        sha256: artifact.hash,
        entropy: artifact.entropy,
        kind: artifact.kind,
        notes: artifact.notes,
        sections: artifact.binary?.sections ?? [],
        headers: artifact.binary?.headerInfo ?? [],
      }),
    },
    {
      name: "README.md",
      content: bundleReadme(artifact, analysis, features),
    },
    {
      name: "features.json",
      content: json({
        name: artifact.name,
        format: artifact.format,
        generatedAt: new Date().toISOString(),
        features: features.map((feature) => ({
          id: feature.id,
          label: feature.label,
          title: feature.title,
          detail: feature.detail,
          files: feature.files,
        })),
      }),
    },
  ];

  return {
    name: artifact.name,
    base,
    format: artifact.format,
    size: artifact.size,
    hash: artifact.hash,
    headline: `${features.length} reusable feature${features.length === 1 ? "" : "s"} from ${artifact.name}`,
    summary,
    features,
    files,
  };
}

function bundleReadme(
  artifact: Artifact,
  analysis: MachOAnalysis | null,
  features: Feature[],
): string {
  return [
    `# ${artifact.name} — extracted features`,
    "",
    `Generated locally by MITOSIS on ${new Date().toISOString()}.`,
    "",
    "## Artifact",
    "",
    markdownTable([
      ["Format", artifact.format],
      ["Size", fmtBytes(artifact.size)],
      ["SHA-256", artifact.hash],
      ["Entropy", `${artifact.entropy.toFixed(3)} bits/byte`],
      [
        "Analyzed",
        analysis
          ? `${analysis.analyzedBytes.toLocaleString()} bytes, ${analysis.format} Mach-O`
          : "8 MB sample",
      ],
    ]),
    "",
    "## What is inside",
    "",
    ...features.map((feature) => `- **${feature.label}** — ${feature.title} (${feature.files.join(", ")})`),
    "",
    "## Use it",
    "",
    "Every file here is plain text or JSON. Drop the CSS variables into a stylesheet,",
    "paste the Markdown into a spec or prompt, or load the JSON in code. Nothing in",
    "this bundle executes the original artifact.",
    "",
    "## Limits",
    "",
    "MITOSIS reads a bounded sample and reports structural evidence. Signatures are",
    "best-effort demanglings, strings come from data sections, and no decompilation",
    "or source recovery happens. Verify anything before relying on it.",
    "",
    `Raw artifact hash: \`${artifact.hash}\``,
    "",
  ].join("\n");
}
