import { looksLikeAudio, readAudioFile } from "./audio";
import { extractPdfText, looksLikePdf } from "./pdf";
import { looksLikeSheet, readSheet } from "./sheet";
import type {
  Artifact,
  AudioInfo,
  BinaryInfo,
  ImageInfo,
  Kind,
  PdfInfo,
  SectionInfo,
  SheetInfo,
  TextInfo,
} from "./types";
import { fmtBytes } from "./util";

const READ_LIMIT = 8 * 1024 * 1024;
const MAX_TEXT = 16000;
const MAX_BINARY = 96 * 1024;
const MAX_IMAGE_SIDE = 720;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i;
const TEXT_EXT =
  /\.(txt|md|markdown|json|jsonl|js|mjs|cjs|jsx|ts|tsx|css|scss|sass|less|html?|xml|svg|ya?ml|toml|ini|cfg|csv|tsv|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|sql|graphql|vue|svelte|astro|log|lua|r|pl|ex|exs|erl|dart|scala|clj|env|diff|patch)$/i;

const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

function shannon(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const counts = new Uint32Array(256);
  for (let i = 0; i < bytes.length; i++) counts[bytes[i]]++;
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (!counts[i]) continue;
    const p = counts[i] / bytes.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function byteHistogram(bytes: Uint8Array): number[] {
  const counts = new Array<number>(256).fill(0);
  for (let i = 0; i < bytes.length; i++) counts[bytes[i]]++;
  return counts;
}

function entropyBlocks(bytes: Uint8Array, blockSize: number): number[] {
  const blocks: number[] = [];
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    blocks.push(shannon(bytes.subarray(offset, offset + blockSize)));
  }
  return blocks;
}

async function fingerprint(data: ArrayBuffer): Promise<string> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    let h = 2166136261;
    const bytes = new Uint8Array(data);
    for (let i = 0; i < Math.min(bytes.length, 1024 * 1024); i++) {
      h ^= bytes[i];
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
}

function magicOf(bytes: Uint8Array): string {
  if (!bytes.length) return "—";
  return [...bytes.slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

function formatOf(bytes: Uint8Array, file: File): string {
  const at = (i: number) => bytes[i] ?? 0;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "PNG";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "JPEG";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return "GIF";
  if (at(0) === 0x42 && at(1) === 0x4d) return "BMP";
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46) {
    if (at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return "WEBP";
    return "RIFF";
  }
  if (at(0) === 0x25 && at(1) === 0x50 && at(2) === 0x44 && at(3) === 0x46) return "PDF";
  if (at(0) === 0x50 && at(1) === 0x4b && at(2) === 0x03 && at(3) === 0x04) return "ZIP";
  if (at(0) === 0x1f && at(1) === 0x8b) return "GZIP";
  if (at(0) === 0x7f && at(1) === 0x45 && at(2) === 0x4c && at(3) === 0x46) return "ELF";
  if (at(0) === 0x4d && at(1) === 0x5a) return "PE / MZ";
  if (
    (at(0) === 0xca && at(1) === 0xfe && at(2) === 0xba && at(3) === 0xbe) ||
    (at(0) === 0xbe && at(1) === 0xba && at(2) === 0xfe && at(3) === 0xca) ||
    (at(0) === 0xca && at(1) === 0xfe && at(2) === 0xba && at(3) === 0xbf) ||
    (at(0) === 0xbf && at(1) === 0xba && at(2) === 0xfe && at(3) === 0xca)
  ) {
    return "MACH-O FAT";
  }
  if (
    (at(0) === 0xfe && at(1) === 0xed && at(2) === 0xfa && at(3) === 0xce) ||
    (at(0) === 0xce && at(1) === 0xfa && at(2) === 0xed && at(3) === 0xfe) ||
    (at(0) === 0xfe && at(1) === 0xed && at(2) === 0xfa && at(3) === 0xcf) ||
    (at(0) === 0xcf && at(1) === 0xfa && at(2) === 0xed && at(3) === 0xfe)
  ) {
    return "MACH-O";
  }
  if (at(0) === 0x00 && at(1) === 0x61 && at(2) === 0x73 && at(3) === 0x6d) return "WASM";
  if (
    at(0) === 0x53 &&
    at(1) === 0x51 &&
    at(2) === 0x4c &&
    at(3) === 0x69
  ) {
    return "SQLITE";
  }
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1];
  return ext ? `RAW / ${ext.toUpperCase()}` : "RAW";
}

function pickTextFormat(file: File, sample: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1];
  if (ext) {
    const known: Record<string, string> = {
      js: "JAVASCRIPT",
      mjs: "JAVASCRIPT",
      cjs: "JAVASCRIPT",
      jsx: "JSX",
      ts: "TYPESCRIPT",
      tsx: "TSX",
      md: "MARKDOWN",
      markdown: "MARKDOWN",
      py: "PYTHON",
      rs: "RUST",
      go: "GO",
      yml: "YAML",
      yaml: "YAML",
      sh: "SHELL",
      bash: "SHELL",
      html: "HTML",
      htm: "HTML",
      svg: "SVG",
      json: "JSON",
      txt: "TEXT",
      csv: "CSV",
      xml: "XML",
    };
    if (known[ext.toLowerCase()]) return known[ext.toLowerCase()];
    return ext.toUpperCase();
  }
  const trimmed = sample.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "JSON?";
  return "PLAIN TEXT";
}

function topSwatches(image: ImageData, count: number): string[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  const total = image.width * image.height;
  const step = Math.max(1, Math.floor(total / 20000));
  for (let i = 0; i < total; i += step) {
    const p = i * 4;
    const a = image.data[p + 3];
    if (a < 64) continue;
    const r = image.data[p];
    const g = image.data[p + 1];
    const b = image.data[p + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const entry = buckets.get(key);
    if (entry) {
      entry.r += r;
      entry.g += g;
      entry.b += b;
      entry.n++;
    } else {
      buckets.set(key, { r, g, b, n: 1 });
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map(({ r, g, b, n }) => {
      const hex = (v: number) =>
        Math.round(v / n)
          .toString(16)
          .padStart(2, "0");
      return `#${hex(r)}${hex(g)}${hex(b)}`;
    });
}

async function loadImage(file: File): Promise<ImageInfo | null> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    let hasAlpha = false;
    for (let i = 3; i < pixels.data.length; i += 4) {
      if (pixels.data[i] < 255) {
        hasAlpha = true;
        break;
      }
    }
    return {
      width: bitmap.width,
      height: bitmap.height,
      sampleWidth: width,
      sampleHeight: height,
      pixels: pixels.data,
      sourceCanvas: canvas,
      swatches: topSwatches(pixels, 6),
      hasAlpha,
    };
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

function readU16(bytes: Uint8Array, offset: number, le: boolean): number {
  if (offset + 2 > bytes.length) return 0;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
    offset,
    le,
  );
}

function readU32(bytes: Uint8Array, offset: number, le: boolean): number {
  if (offset + 4 > bytes.length) return 0;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    le,
  );
}

function readU64(bytes: Uint8Array, offset: number, le: boolean): number {
  if (offset + 8 > bytes.length) return 0;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(
    offset,
    le,
  );
  return v > BigInt(Number.MAX_SAFE_INTEGER) ? 0 : Number(v);
}

const ELF_MACHINES: Record<number, string> = {
  3: "x86",
  8: "MIPS",
  20: "PowerPC",
  40: "ARM",
  62: "x86-64",
  183: "AArch64",
  243: "RISC-V",
};

const ELF_TYPES: Record<number, string> = {
  1: "REL",
  2: "EXEC",
  3: "DYN / PIE",
  4: "CORE",
};

function parseElf(bytes: Uint8Array): {
  header: [string, string][];
  sections: SectionInfo[];
} | null {
  if (
    bytes.length < 52 ||
    bytes[0] !== 0x7f ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0x4c ||
    bytes[3] !== 0x46
  ) {
    return null;
  }
  const is64 = bytes[4] === 2;
  const le = bytes[5] === 1;
  if (bytes[4] !== 1 && bytes[4] !== 2) return null;
  const machine = readU16(bytes, 18, le);
  const type = readU16(bytes, 16, le);
  const entry = is64 ? readU64(bytes, 24, le) : readU32(bytes, 24, le);
  const header: [string, string][] = [
    ["CLASS", is64 ? "ELF64" : "ELF32"],
    ["ENDIAN", le ? "LITTLE" : "BIG"],
    ["TYPE", ELF_TYPES[type] ?? `0x${type.toString(16)}`],
    ["MACHINE", ELF_MACHINES[machine] ?? `0x${machine.toString(16)}`],
    ["ENTRY", `0x${entry.toString(16)}`],
  ];
  const sections: SectionInfo[] = [];
  try {
    const shoff = is64 ? readU64(bytes, 0x28, le) : readU32(bytes, 0x20, le);
    const shentsize = readU16(bytes, is64 ? 0x3a : 0x2e, le);
    const shnum = readU16(bytes, is64 ? 0x3c : 0x30, le);
    const shstrndx = readU16(bytes, is64 ? 0x3e : 0x32, le);
    header.push(["SECTIONS", String(shnum)]);
    if (shoff > 0 && shoff < bytes.length && shnum > 0 && shnum < 128 && shentsize >= 40) {
      const strHeader =
        shstrndx < shnum ? shoff + shstrndx * shentsize : 0;
      const strOffset = strHeader
        ? is64
          ? readU64(bytes, strHeader + 24, le)
          : readU32(bytes, strHeader + 16, le)
        : 0;
      const strSize = strHeader
        ? is64
          ? readU64(bytes, strHeader + 32, le)
          : readU32(bytes, strHeader + 20, le)
        : 0;
      const readName = (offset: number): string => {
        if (!strOffset || offset >= strSize) return "";
        let name = "";
        for (let i = 0; i < 64; i++) {
          const at = strOffset + offset + i;
          if (at >= bytes.length) break;
          const ch = bytes[at];
          if (ch === 0) break;
          if (ch < 32 || ch > 126) break;
          name += String.fromCharCode(ch);
        }
        return name;
      };
      for (let i = 0; i < Math.min(shnum, 24); i++) {
        const base = shoff + i * shentsize;
        if (base + shentsize > bytes.length) break;
        const nameOff = readU32(bytes, base, le);
        const addr = is64 ? readU64(bytes, base + 16, le) : readU32(bytes, base + 12, le);
        const size = is64 ? readU64(bytes, base + 32, le) : readU32(bytes, base + 20, le);
        const name = readName(nameOff);
        if (name && size > 0) {
          sections.push({ name, size, address: addr });
        }
      }
    }
  } catch {
    // A truncated or malformed header should never block the rest of dissection.
  }
  return { header, sections: sections.slice(0, 10) };
}

function parsePe(bytes: Uint8Array): {
  header: [string, string][];
  sections: SectionInfo[];
} | null {
  if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return null;
  const pe = readU32(bytes, 0x3c, true);
  if (pe <= 0 || pe + 24 > bytes.length) return null;
  if (
    bytes[pe] !== 0x50 ||
    bytes[pe + 1] !== 0x45 ||
    bytes[pe + 2] !== 0 ||
    bytes[pe + 3] !== 0
  ) {
    return null;
  }
  const machine = readU16(bytes, pe + 4, true);
  const count = readU16(bytes, pe + 6, true);
  const optionalSize = readU16(bytes, pe + 20, true);
  const entry = readU32(bytes, pe + 24 + 16, true);
  const machines: Record<number, string> = {
    0x14c: "x86",
    0x8664: "x86-64",
    0xaa64: "ARM64",
    0x1c0: "ARM",
  };
  const header: [string, string][] = [
    ["MACHINE", machines[machine] ?? `0x${machine.toString(16)}`],
    ["SECTIONS", String(count)],
    ["ENTRY RVA", `0x${entry.toString(16)}`],
  ];
  const table = pe + 24 + optionalSize;
  const sections: SectionInfo[] = [];
  for (let i = 0; i < Math.min(count, 12); i++) {
    const base = table + i * 40;
    if (base + 40 > bytes.length) break;
    let name = "";
    for (let j = 0; j < 8; j++) {
      const ch = bytes[base + j];
      if (!ch) break;
      name += String.fromCharCode(ch);
    }
    const virtualSize = readU32(bytes, base + 8, true);
    const virtualAddress = readU32(bytes, base + 12, true);
    const rawSize = readU32(bytes, base + 16, true);
    if (name) {
      sections.push({
        name: name.trim() || `section_${i}`,
        size: rawSize || virtualSize,
        address: virtualAddress,
      });
    }
  }
  return { header, sections };
}

const MACHO_CPUS: Record<number, string> = {
  7: "x86",
  0x01000007: "x86-64",
  12: "ARM",
  0x0100000c: "ARM64",
  18: "PowerPC",
  0x01000012: "PowerPC64",
};

const MACHO_TYPES: Record<number, string> = {
  1: "OBJECT",
  2: "EXECUTE",
  3: "FVMLIB",
  4: "CORE",
  5: "PRELOAD",
  6: "DYLIB",
  7: "DYLINKER",
  8: "BUNDLE",
  9: "DYLIB_STUB",
  10: "DSYM",
  11: "KEXT_BUNDLE",
};

function machoArchName(cpu: number, subType: number): string {
  if (cpu === 0x0100000c && (subType === 2 || subType === 0x80000002)) return "ARM64E";
  if (cpu === 0x0100000c && subType === 0x8000000c) return "ARM64E.X1";
  if (cpu === 0x01000007 && subType === 8) return "x86-64H";
  return MACHO_CPUS[cpu] ?? `0x${cpu.toString(16)}`;
}

function readMachName(bytes: Uint8Array, offset: number, length: number): string {
  let name = "";
  for (let i = 0; i < length; i++) {
    const at = offset + i;
    if (at >= bytes.length) break;
    const ch = bytes[at];
    if (ch === 0) break;
    if (ch < 32 || ch > 126) break;
    name += String.fromCharCode(ch);
  }
  return name;
}

function parseMachOThin(bytes: Uint8Array): {
  header: [string, string][];
  sections: SectionInfo[];
} | null {
  const magic = readU32(bytes, 0, false);
  let le: boolean;
  let is64: boolean;
  switch (magic) {
    case 0xcefaedfe:
      le = true;
      is64 = false;
      break;
    case 0xcffaedfe:
      le = true;
      is64 = true;
      break;
    case 0xfeedface:
      le = false;
      is64 = false;
      break;
    case 0xfeedfacf:
      le = false;
      is64 = true;
      break;
    default:
      return null;
  }
  const headerSize = is64 ? 32 : 28;
  if (bytes.length < headerSize) return null;
  const cpu = readU32(bytes, 4, le);
  const subType = readU32(bytes, 8, le);
  const fileType = readU32(bytes, 12, le);
  const ncmds = readU32(bytes, 16, le);
  const sizeofcmds = readU32(bytes, 20, le);
  const flags = readU32(bytes, 24, le);
  const header: [string, string][] = [
    ["CLASS", is64 ? "MACH-O 64" : "MACH-O 32"],
    ["CPU", machoArchName(cpu, subType)],
    ["TYPE", MACHO_TYPES[fileType] ?? `0x${fileType.toString(16)}`],
    ["COMMANDS", String(ncmds)],
    ["ENDIAN", le ? "LITTLE" : "BIG"],
    ["FLAGS", `0x${flags.toString(16)}`],
  ];
  const sections: SectionInfo[] = [];
  const commandEnd = Math.min(bytes.length, headerSize + sizeofcmds);
  let cursor = headerSize;
  for (let i = 0; i < ncmds && cursor + 8 <= commandEnd; i++) {
    const cmd = readU32(bytes, cursor, le);
    const cmdsize = readU32(bytes, cursor + 4, le);
    if (cmdsize < 8 || cursor + cmdsize > commandEnd) break;
    if (cmd === 0x1 || cmd === 0x19) {
      const is64Segment = cmd === 0x19;
      const segmentSize = is64Segment ? 72 : 56;
      const sectionSize = is64Segment ? 80 : 68;
      const sectionCount = readU32(bytes, cursor + (is64Segment ? 64 : 48), le);
      if (cmdsize >= segmentSize && sectionCount < 512) {
        const segmentName = readMachName(bytes, cursor + 8, 16);
        for (let j = 0; j < sectionCount; j++) {
          const sectionOffset = cursor + segmentSize + j * sectionSize;
          if (sectionOffset + sectionSize > cursor + cmdsize) break;
          const sectionName = readMachName(bytes, sectionOffset, 16);
          const address = is64Segment
            ? readU64(bytes, sectionOffset + 32, le)
            : readU32(bytes, sectionOffset + 32, le);
          const size = is64Segment
            ? readU64(bytes, sectionOffset + 40, le)
            : readU32(bytes, sectionOffset + 36, le);
          if (sectionName && size > 0) {
            sections.push({
              name: segmentName ? `${segmentName}.${sectionName}` : sectionName,
              size,
              address,
            });
            if (sections.length >= 48) break;
          }
        }
      }
    }
    cursor += cmdsize;
    if (sections.length >= 48) break;
  }
  header.push(["SECTIONS", String(sections.length)]);
  return { header, sections: sections.slice(0, 48) };
}

function parseFatMachO(bytes: Uint8Array): {
  header: [string, string][];
  sections: SectionInfo[];
} | null {
  const magic = readU32(bytes, 0, false);
  let le: boolean;
  let is64: boolean;
  if (magic === 0xcafebabe) {
    le = false;
    is64 = false;
  } else if (magic === 0xbebafeca) {
    le = true;
    is64 = false;
  } else if (magic === 0xcafebabf) {
    le = false;
    is64 = true;
  } else if (magic === 0xbfbafeca) {
    le = true;
    is64 = true;
  } else {
    return null;
  }
  if (bytes.length < 8) return null;
  const count = Math.min(readU32(bytes, 4, le), 16);
  const entrySize = is64 ? 32 : 20;
  const archNames: string[] = [];
  let thinHeader: [string, string][] = [];
  let sections: SectionInfo[] = [];
  for (let i = 0; i < count; i++) {
    const base = 8 + i * entrySize;
    if (base + entrySize > bytes.length) break;
    const cpu = readU32(bytes, base, le);
    const subType = readU32(bytes, base + 4, le);
    archNames.push(machoArchName(cpu, subType));
    const offset = is64 ? readU64(bytes, base + 8, le) : readU32(bytes, base + 8, le);
    const size = is64 ? readU64(bytes, base + 16, le) : readU32(bytes, base + 12, le);
    if (!thinHeader.length && offset > 0 && offset < bytes.length) {
      const end = Math.min(bytes.length, offset + Math.max(1, size));
      const thin = parseMachOThin(bytes.subarray(offset, end));
      if (thin) {
        thinHeader = thin.header;
        sections = thin.sections;
      }
    }
  }
  const header: [string, string][] = [
    ["FAT", `${count} ARCH`],
    ["ARCHS", archNames.join(", ")],
  ];
  for (const [key, value] of thinHeader) {
    if (key !== "SECTIONS") header.push([key, value]);
  }
  header.push(["SECTIONS", String(sections.length)]);
  return { header, sections: sections.slice(0, 48) };
}

function parseMachO(bytes: Uint8Array): {
  header: [string, string][];
  sections: SectionInfo[];
} | null {
  const magic = readU32(bytes, 0, false);
  if (
    magic === 0xcafebabe ||
    magic === 0xbebafeca ||
    magic === 0xcafebabf ||
    magic === 0xbfbafeca
  ) {
    return parseFatMachO(bytes);
  }
  return parseMachOThin(bytes);
}

function extractStrings(bytes: Uint8Array): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  let run = "";
  const limit = Math.min(bytes.length, 48 * 1024);
  for (let i = 0; i < limit; i++) {
    const ch = bytes[i];
    if (ch >= 32 && ch <= 126) {
      run += String.fromCharCode(ch);
    } else {
      if (run.length >= 5 && !seen.has(run)) {
        seen.add(run);
        found.push(run.slice(0, 64));
        if (found.length >= 18) break;
      }
      run = "";
    }
  }
  if (run.length >= 5 && found.length < 18) found.push(run.slice(0, 64));
  return found;
}

function makeBinaryInfo(bytes: Uint8Array): BinaryInfo {
  const header = parseElf(bytes) ?? parsePe(bytes) ?? parseMachO(bytes);
  return {
    sample: bytes,
    histogram: byteHistogram(bytes),
    entropyBlocks: entropyBlocks(bytes, 4096),
    entropyBlockSize: 4096,
    strings: extractStrings(bytes),
    sections: header?.sections ?? [],
    headerInfo: header?.header ?? [],
  };
}

function makeTextInfo(sample: string): TextInfo {
  const words = sample.match(/[A-Za-z0-9_'-]+/g) ?? [];
  return {
    sample,
    lines: sample.split(/\r\n|\r|\n/).length,
    words: words.length,
    uniques: new Set(words.map((w) => w.toLowerCase())).size,
  };
}

function looksTextual(bytes: Uint8Array): boolean {
  const probe = bytes.subarray(0, 24000);
  if (!probe.length) return false;
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(probe);
  const control = (decoded.match(CONTROL_RE) ?? []).length;
  return !decoded.includes("\u0000") && control / Math.max(1, decoded.length) < 0.02;
}

export async function dissectFile(file: File): Promise<Artifact> {
  const buffer = await file.slice(0, READ_LIMIT).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const hash = await fingerprint(buffer);
  const magic = magicOf(bytes);
  const entropy = shannon(bytes.subarray(0, Math.min(bytes.length, 1024 * 1024)));
  const notes: string[] = [];
  if (file.size > READ_LIMIT) {
    notes.push(`HEAD ${fmtBytes(READ_LIMIT)} ANALYSED`);
  }

  const mime = file.type.toLowerCase();
  const imageCandidate =
    (mime.startsWith("image/") && !mime.includes("svg")) || IMAGE_EXT.test(file.name);

  let kind: Kind = "binary";
  let image: ImageInfo | undefined;
  let text: TextInfo | undefined;
  let binary: BinaryInfo | undefined;
  let audio: AudioInfo | undefined;
  let pdf: PdfInfo | undefined;
  let sheet: SheetInfo | undefined;
  let format = "";
  let previewUrl: string | undefined;

  if (imageCandidate) {
    const info = await loadImage(file);
    if (info) {
      kind = "image";
      image = info;
      format =
        formatOf(bytes, file) === "RAW"
          ? (mime.split("/")[1] ?? "IMAGE").toUpperCase()
          : formatOf(bytes, file);
      previewUrl = URL.createObjectURL(file);
      if (info.sampleWidth !== info.width || info.sampleHeight !== info.height) {
        notes.push(`SCORING SAMPLE ${info.sampleWidth}×${info.sampleHeight}`);
      }
      if (info.hasAlpha) notes.push("ALPHA CHANNEL");
    } else {
      notes.push("IMAGE DECODE FAILED — FALLBACK");
    }
  }

  if (kind === "binary" && looksLikePdf(bytes, file.name)) {
    const extracted = await extractPdfText(bytes);
    kind = "pdf";
    format = "PDF";
    pdf = { pages: extracted.pages, text: extracted.text, chars: extracted.text.length };
    if (!extracted.text) notes.push("NO EXTRACTABLE TEXT");
  }

  if (kind === "binary" && looksLikeAudio(bytes, file.name)) {
    const decoded = await readAudioFile(file, bytes);
    if (decoded) {
      kind = "audio";
      format = decoded.format;
      audio = decoded;
      if (decoded.samples.length < bytes.length / 4) notes.push("AUDIO SAMPLE CAPPED");
    } else {
      notes.push("AUDIO DECODE FAILED — FALLBACK");
    }
  }

  if (kind === "binary" && looksLikeSheet(file.name, mime)) {
    const table = await readSheet(file, bytes);
    if (table) {
      kind = "sheet";
      format = table.format;
      sheet = table;
      if (table.rows.length >= 200) notes.push("SAMPLE 200 ROWS");
    }
  }

  if (kind === "binary") {
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(
      bytes.subarray(0, MAX_TEXT * 2),
    );
    const textual =
      (mime.startsWith("text/") ||
        /json|javascript|xml|yaml|markdown|typescript|csv|sql/i.test(mime) ||
        TEXT_EXT.test(file.name) ||
        looksTextual(bytes)) &&
      looksTextual(bytes);
    if (textual) {
      kind = "text";
      const sample = decoded.replace(/^\uFEFF/, "").slice(0, MAX_TEXT);
      if (decoded.length > MAX_TEXT) notes.push("SAMPLE 16K CHARS");
      text = makeTextInfo(sample);
      format = pickTextFormat(file, sample);
    } else {
      const sample = bytes.slice(0, Math.min(bytes.length, MAX_BINARY));
      if (sample.length < bytes.length) {
        notes.push(`SAMPLE ${fmtBytes(sample.length)} OF ${fmtBytes(file.size)}`);
      }
      binary = makeBinaryInfo(sample);
      format = formatOf(bytes, file);
    }
  }

  return {
    name: file.name || "unnamed.artifact",
    size: file.size,
    mime: file.type || "application/octet-stream",
    kind,
    format: format || "UNKNOWN",
    magic,
    hash,
    entropy,
    previewUrl,
    notes,
    image,
    text,
    binary,
    audio,
    pdf,
    sheet,
  };
}
