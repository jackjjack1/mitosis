import {
  demangleSymbol,
  recoverObjCClassName,
  type ObjectiveCName,
  type ObjectiveCRecovery,
  type ObjectiveCMethod,
  type SymbolLanguage,
} from "./demangle";
import { fmtBytes } from "./util";

/**
 * First-party Mach-O analysis. This is deliberately a static analyzer, not a
 * decompiler: it reports the same structural evidence a Ghidra session starts
 * from (load commands, segments, sections, symbols, libraries, strings) without
 * requiring a Ghidra installation.
 */

const MAX_READ = 64 * 1024 * 1024;
const MAX_SYMBOLS = 20_000;
const MAX_STRINGS = 5_000;
const MAX_SECTION_SCAN = 2 * 1024 * 1024;
const MAX_MARKDOWN_SYMBOLS = 2_500;
const MAX_MARKDOWN_STRINGS = 1_500;
const MAX_MARKDOWN_OBJC = 250;

export type MachOSymbolKind =
  | "exported"
  | "imported"
  | "local"
  | "absolute"
  | "indirect"
  | "undefined";

export interface MachOSymbol {
  name: string;
  kind: MachOSymbolKind;
  external: boolean;
  section: string;
  address: number;
  addressHex: string;
  library?: string;
  typeFlags: number;
  description: number;
  demangled?: string;
  language?: SymbolLanguage;
  objectiveC?: ObjectiveCName;
}

export interface MachOString {
  value: string;
  section: string;
  offset: number;
  encoding: "ascii" | "utf16";
}

export interface MachOSection {
  name: string;
  segment: string;
  section: string;
  address: number;
  addressHex: string;
  size: number;
  fileOffset: number;
  alignment: number;
  flags: string;
  type: string;
  entropy: number;
  symbolCount: number;
  stringCount: number;
}

export interface MachOSegment {
  name: string;
  address: number;
  addressHex: string;
  size: number;
  fileOffset: number;
  fileSize: number;
  protection: string;
  maxProtection: string;
  sectionCount: number;
}

export interface MachOArchitecture {
  name: string;
  cpu: string;
  subType: number;
  fileType: string;
  fileTypeCode: number;
  endian: "little" | "big";
  bitness: 32 | 64;
  offset: number;
  size: number;
  flags: string;
  uuid?: string;
  platform?: string;
  minOS?: string;
  sdk?: string;
  entryPoint?: string;
  dylinker?: string;
  installName?: string;
  encrypted: boolean;
  codeSignature?: { offset: number; size: number };
  functionStarts?: { offset: number; size: number; count: number };
  symbolTable?: { offset: number; size: number; count: number };
  segments: MachOSegment[];
  sections: MachOSection[];
  symbols: MachOSymbol[];
  strings: MachOString[];
  libraries: string[];
  rpaths: string[];
  objectiveC: ObjectiveCRecovery;
  swiftSymbols: number;
  symbolCount: number;
  debugSymbolCount: number;
  stringCount: number;
  sectionCount: number;
  notes: string[];
}

export interface MachOAnalysis {
  tool: "MITOSIS";
  version: 1;
  generatedAt: string;
  fileName: string;
  fileSize: number;
  analyzedBytes: number;
  sha256: string;
  format: "thin" | "fat";
  architectures: MachOArchitecture[];
  totals: {
    architectures: number;
    sections: number;
    symbols: number;
    strings: number;
    libraries: number;
    swiftSymbols: number;
    objcClasses: number;
    objcMethods: number;
  };
  notes: string[];
}

interface SliceEntry {
  offset: number;
  size: number;
  cpu: number;
  subType: number;
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

const PLATFORMS: Record<number, string> = {
  1: "macOS",
  2: "iOS",
  3: "tvOS",
  4: "watchOS",
  5: "bridgeOS",
  6: "Mac Catalyst",
  7: "iOS Simulator",
  8: "tvOS Simulator",
  9: "watchOS Simulator",
  10: "DriverKit",
  11: "visionOS",
  12: "visionOS Simulator",
};

const SECTION_TYPES: Record<number, string> = {
  0x0: "S_REGULAR",
  0x1: "S_ZEROFILL",
  0x2: "S_CSTRING_LITERALS",
  0x3: "S_4BYTE_LITERALS",
  0x4: "S_8BYTE_LITERALS",
  0x5: "S_LITERAL_POINTERS",
  0x6: "S_NON_LAZY_SYMBOL_POINTERS",
  0x7: "S_LAZY_SYMBOL_POINTERS",
  0x8: "S_SYMBOL_STUBS",
  0x9: "S_MOD_INIT_FUNC_POINTERS",
  0xa: "S_MOD_TERM_FUNC_POINTERS",
  0xb: "S_COALESCED",
  0xc: "S_GB_ZEROFILL",
  0xd: "S_INTERPOSING",
  0xe: "S_16BYTE_LITERALS",
  0xf: "S_DTRACE_DOF",
  0x10: "S_LAZY_DYLIB_SYMBOL_POINTERS",
  0x11: "S_THREAD_LOCAL_REGULAR",
  0x12: "S_THREAD_LOCAL_ZEROFILL",
  0x13: "S_THREAD_LOCAL_VARIABLES",
  0x14: "S_THREAD_LOCAL_VARIABLE_POINTERS",
  0x15: "S_THREAD_LOCAL_INIT_FUNCTION_POINTERS",
  0x16: "S_INIT_FUNC_OFFSETS",
};

const CODE_SECTIONS = new Set([
  "__text",
  "__stubs",
  "__stub_helper",
  "__objc_stubs",
  "__unwind_info",
  "__eh_frame",
  "__gcc_except_tab",
]);

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
  const value = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getBigUint64(offset, le);
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? 0 : Number(value);
}

function hex(value: number, width = 0): string {
  return `0x${value.toString(16).padStart(width, "0")}`;
}

function fixedName(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let i = 0; i < length; i++) {
    const at = offset + i;
    if (at >= bytes.length) break;
    const ch = bytes[at];
    if (ch === 0) break;
    if (ch < 32 || ch > 126) break;
    value += String.fromCharCode(ch);
  }
  return value;
}

function cString(bytes: Uint8Array, offset: number, maxLength = 2048): string {
  if (offset < 0 || offset >= bytes.length) return "";
  const limit = Math.min(bytes.length, offset + maxLength);
  let end = offset;
  while (end < limit && bytes[end] !== 0) end++;
  return new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(offset, end))
    .replace(/\u0000/g, "");
}

function machoArchName(cpu: number, subType: number): string {
  if (cpu === 0x0100000c && (subType === 2 || subType === 0x80000002)) return "ARM64E";
  if (cpu === 0x0100000c && subType === 0x8000000c) return "ARM64E.X1";
  if (cpu === 0x01000007 && subType === 8) return "x86-64H";
  return MACHO_CPUS[cpu] ?? hex(cpu);
}

function versionString(raw: number): string {
  return `${raw >>> 16}.${(raw >>> 8) & 0xff}.${raw & 0xff}`;
}

function protection(value: number): string {
  return `${value & 1 ? "r" : "-"}${value & 2 ? "w" : "-"}${value & 4 ? "x" : "-"}`;
}

function uuidString(bytes: Uint8Array, offset: number): string {
  const hexBytes = [];
  for (let i = 0; i < 16; i++) {
    hexBytes.push((bytes[offset + i] ?? 0).toString(16).padStart(2, "0"));
  }
  const value = hexBytes.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(
    12,
    16,
  )}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function shannon(bytes: Uint8Array): number {
  if (!bytes.length) return 0;
  const counts = new Uint32Array(256);
  for (const byte of bytes) counts[byte]++;
  let entropy = 0;
  for (const count of counts) {
    if (!count) continue;
    const p = count / bytes.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function parseSlices(bytes: Uint8Array): {
  format: "thin" | "fat";
  entries: SliceEntry[];
} | null {
  const magic = readU32(bytes, 0, false);
  let fat = false;
  let le = false;
  let fat64 = false;
  if (magic === 0xcafebabe) {
    fat = true;
  } else if (magic === 0xbebafeca) {
    fat = true;
    le = true;
  } else if (magic === 0xcafebabf) {
    fat = true;
    fat64 = true;
  } else if (magic === 0xbfbafeca) {
    fat = true;
    fat64 = true;
    le = true;
  }

  if (!fat) {
    if (
      magic !== 0xcefaedfe &&
      magic !== 0xcffaedfe &&
      magic !== 0xfeedface &&
      magic !== 0xfeedfacf
    ) {
      return null;
    }
    const thinLe = magic === 0xcefaedfe || magic === 0xcffaedfe;
    return {
      format: "thin",
      entries: [
        {
          offset: 0,
          size: bytes.length,
          cpu: readU32(bytes, 4, thinLe),
          subType: readU32(bytes, 8, thinLe),
        },
      ],
    };
  }

  if (bytes.length < 8) return null;
  const count = Math.min(readU32(bytes, 4, le), 32);
  const entrySize = fat64 ? 32 : 20;
  const entries: SliceEntry[] = [];
  for (let index = 0; index < count; index++) {
    const base = 8 + index * entrySize;
    if (base + entrySize > bytes.length) break;
    const offset = fat64
      ? readU64(bytes, base + 8, le)
      : readU32(bytes, base + 8, le);
    const size = fat64
      ? readU64(bytes, base + 16, le)
      : readU32(bytes, base + 12, le);
    if (offset <= 0 || offset >= bytes.length || size <= 0) continue;
    entries.push({
      offset,
      size: Math.min(size, bytes.length - offset),
      cpu: readU32(bytes, base, le),
      subType: readU32(bytes, base + 4, le),
    });
  }
  return entries.length ? { format: "fat", entries } : null;
}

function readUleb(bytes: Uint8Array, offset: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  for (let index = 0; index < 10; index++) {
    const at = offset + index;
    if (at >= bytes.length) return null;
    const byte = bytes[at];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: value >>> 0, next: at + 1 };
    }
    shift += 7;
  }
  return null;
}

function countFunctionStarts(
  bytes: Uint8Array,
  offset: number,
  size: number,
): number {
  if (!size || offset >= bytes.length) return 0;
  const end = Math.min(bytes.length, offset + size);
  let cursor = offset;
  let count = 0;
  while (cursor < end) {
    const next = readUleb(bytes, cursor);
    if (!next) break;
    if (next.value === 0) break;
    count++;
    cursor = next.next;
  }
  return count;
}

function exportTrie(
  bytes: Uint8Array,
  offset: number,
  size: number,
  notes: string[],
): MachOSymbol[] {
  if (!size || offset >= bytes.length) return [];
  const end = Math.min(bytes.length, offset + size);
  const found: MachOSymbol[] = [];
  const stack: { offset: number; prefix: string; depth: number }[] = [
    { offset, prefix: "", depth: 0 },
  ];
  const seenNodes = new Set<number>();
  while (stack.length && found.length < MAX_SYMBOLS) {
    const node = stack.pop()!;
    if (node.depth > 128 || !seenNodes.add(node.offset)) continue;
    const terminal = readUleb(bytes, node.offset);
    if (!terminal || terminal.next > end) continue;
    const terminalStart = terminal.next;
    const terminalEnd = Math.min(end, terminalStart + terminal.value);
    let cursor = terminalStart;
    if (terminal.value > 0) {
      const flags = readUleb(bytes, terminalStart);
      if (!flags) continue;
      cursor = flags.next;
      if (flags.value & 0x08) {
        const ordinal = readUleb(bytes, cursor);
        if (!ordinal) continue;
        cursor = ordinal.next;
        const importName = cString(bytes, cursor, 1024);
        if (node.prefix) {
          found.push({
            name: node.prefix,
            kind: "exported",
            external: true,
            section: "",
            address: 0,
            addressHex: "",
            library: importName || `reexport ${ordinal.value}`,
            typeFlags: 0,
            description: 0,
          });
        }
      } else {
        const address = readUleb(bytes, cursor);
        if (!address) continue;
        if (node.prefix) {
          found.push({
            name: node.prefix,
            kind: "exported",
            external: true,
            section: "",
            address: address.value,
            addressHex: hex(address.value),
            typeFlags: 0,
            description: 0,
          });
        }
      }
    }
    cursor = terminalEnd;
    const children = readUleb(bytes, cursor);
    if (!children) continue;
    cursor = children.next;
    const childCount = Math.min(children.value, 4096);
    for (let index = 0; index < childCount; index++) {
      const edgeLength = readUleb(bytes, cursor);
      if (!edgeLength) break;
      cursor = edgeLength.next;
      const edgeEnd = cursor + edgeLength.value;
      if (edgeEnd > end) break;
      const edge = new TextDecoder("utf-8", { fatal: false }).decode(
        bytes.subarray(cursor, edgeEnd),
      );
      cursor = edgeEnd;
      const child = readUleb(bytes, cursor);
      if (!child) break;
      cursor = child.next;
      stack.push({
        offset: offset + child.value,
        prefix: node.prefix + edge,
        depth: node.depth + 1,
      });
    }
  }
  if (found.length >= MAX_SYMBOLS) {
    notes.push("Export trie truncated at the symbol cap.");
  }
  return found;
}

function isObjCSelector(value: string): boolean {
  if (!value || value.startsWith(".") || value.includes(" ")) return false;
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?::[A-Za-z_$][A-Za-z0-9_$]*)*:?$/.test(
    value,
  );
}

function buildObjectiveCRecovery(
  symbols: MachOSymbol[],
  strings: MachOString[],
): ObjectiveCRecovery {
  const classes = new Set<string>();
  const protocols = new Set<string>();
  const selectors = new Set<string>();
  const ivars = new Set<string>();
  const methods = new Map<string, ObjectiveCMethod>();

  for (const symbol of symbols) {
    const info = symbol.objectiveC;
    if (!info) continue;
    if ((info.kind === "class" || info.kind === "metaclass") && info.className) {
      classes.add(info.className);
    }
    if (info.kind === "protocol" && info.className) {
      protocols.add(info.className);
    }
    if (info.kind === "ivar" && info.className && info.ivar) {
      ivars.add(`${info.className}.${info.ivar}`);
    }
    if (
      info.kind === "method" &&
      info.className &&
      info.selector &&
      !info.selector.startsWith(".")
    ) {
      const key = `${info.className}:${info.selector}:${info.classMethod ? "class" : "instance"}`;
      methods.set(key, {
        className: info.className,
        selector: info.selector,
        classMethod: Boolean(info.classMethod),
        symbol: symbol.name,
        demangled: symbol.demangled ?? symbol.name,
      });
      selectors.add(info.selector);
    }
  }

  for (const string of strings) {
    if (string.section.endsWith("__objc_classname")) {
      const name = recoverObjCClassName(string.value);
      if (name) classes.add(name);
    }
    if (
      string.section.endsWith("__objc_methname") &&
      isObjCSelector(string.value)
    ) {
      selectors.add(string.value);
    }
  }

  for (const ivar of ivars) {
    selectors.delete(ivar.slice(ivar.lastIndexOf(".") + 1));
  }

  return {
    classes: [...classes].sort(),
    protocols: [...protocols].sort(),
    methods: [...methods.values()].sort(
      (a, b) =>
        a.className.localeCompare(b.className) ||
        a.selector.localeCompare(b.selector),
    ),
    ivars: [...ivars].sort(),
    selectors: [...selectors].sort(),
  };
}

function analyzeSlice(slice: Uint8Array, entry: SliceEntry): MachOArchitecture | null {
  const magic = readU32(slice, 0, false);
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
  if (slice.length < headerSize) return null;

  const cpuRaw = readU32(slice, 4, le);
  const subType = readU32(slice, 8, le);
  const fileTypeCode = readU32(slice, 12, le);
  const ncmds = readU32(slice, 16, le);
  const sizeofcmds = readU32(slice, 20, le);
  const flags = readU32(slice, 24, le);
  const notes: string[] = [];
  const sections: MachOSection[] = [];
  const segments: MachOSegment[] = [];
  const libraries: string[] = [];
  const rpaths: string[] = [];
  let uuid: string | undefined;
  let platform: string | undefined;
  let minOS: string | undefined;
  let sdk: string | undefined;
  let entryPoint: string | undefined;
  let dylinker: string | undefined;
  let installName: string | undefined;
  let encrypted = false;
  let codeSignature: MachOArchitecture["codeSignature"];
  let functionStarts: MachOArchitecture["functionStarts"];
  let symbolTable: MachOArchitecture["symbolTable"];
  let symtab: { symoff: number; nsyms: number; stroff: number; strsize: number } | null =
    null;
  let exportTrieRange: { offset: number; size: number } | null = null;

  const commandEnd = Math.min(slice.length, headerSize + sizeofcmds);
  let cursor = headerSize;
  for (let commandIndex = 0; commandIndex < ncmds && cursor + 8 <= commandEnd; commandIndex++) {
    const cmd = readU32(slice, cursor, le);
    const cmdsize = readU32(slice, cursor + 4, le);
    if (cmdsize < 8 || cursor + cmdsize > commandEnd) {
      notes.push(`Malformed load command at offset ${hex(cursor)}.`);
      break;
    }

    if (cmd === 0x1 || cmd === 0x19) {
      const segment64 = cmd === 0x19;
      const segmentSize = segment64 ? 72 : 56;
      const sectionSize = segment64 ? 80 : 68;
      if (cmdsize >= segmentSize) {
        const segmentName = fixedName(slice, cursor + 8, 16);
        const address = segment64
          ? readU64(slice, cursor + 24, le)
          : readU32(slice, cursor + 24, le);
        const size = segment64
          ? readU64(slice, cursor + 32, le)
          : readU32(slice, cursor + 28, le);
        const fileOffset = segment64
          ? readU64(slice, cursor + 40, le)
          : readU32(slice, cursor + 32, le);
        const fileSize = segment64
          ? readU64(slice, cursor + 48, le)
          : readU32(slice, cursor + 36, le);
        const maxProtection = readU32(slice, cursor + (segment64 ? 56 : 40), le);
        const initProtection = readU32(slice, cursor + (segment64 ? 60 : 44), le);
        const sectionCount = readU32(slice, cursor + (segment64 ? 64 : 48), le);
        segments.push({
          name: segmentName || `segment_${segments.length}`,
          address,
          addressHex: hex(address),
          size,
          fileOffset,
          fileSize,
          protection: protection(initProtection),
          maxProtection: protection(maxProtection),
          sectionCount,
        });
        const availableSections = Math.min(sectionCount, 512);
        for (let sectionIndex = 0; sectionIndex < availableSections; sectionIndex++) {
          const base = cursor + segmentSize + sectionIndex * sectionSize;
          if (base + sectionSize > cursor + cmdsize) break;
          const sectionName = fixedName(slice, base, 16);
          const sectionSegment = fixedName(slice, base + 16, 16) || segmentName;
          const sectionAddress = segment64
            ? readU64(slice, base + 32, le)
            : readU32(slice, base + 32, le);
          const sectionLength = segment64
            ? readU64(slice, base + 40, le)
            : readU32(slice, base + 36, le);
          const sectionOffset = readU32(slice, base + (segment64 ? 48 : 40), le);
          const alignment = readU32(slice, base + (segment64 ? 52 : 44), le);
          const sectionFlags = readU32(slice, base + (segment64 ? 64 : 56), le);
          if (!sectionName) continue;
          sections.push({
            name: sectionSegment
              ? `${sectionSegment}.${sectionName}`
              : sectionName,
            segment: sectionSegment,
            section: sectionName,
            address: sectionAddress,
            addressHex: hex(sectionAddress),
            size: sectionLength,
            fileOffset: sectionOffset,
            alignment,
            flags: hex(sectionFlags),
            type: SECTION_TYPES[sectionFlags & 0xff] ?? `TYPE_0x${(sectionFlags & 0xff).toString(16)}`,
            entropy: 0,
            symbolCount: 0,
            stringCount: 0,
          });
        }
      }
    } else if (cmd === 0x2 && cmdsize >= 24) {
      symtab = {
        symoff: readU32(slice, cursor + 8, le),
        nsyms: readU32(slice, cursor + 12, le),
        stroff: readU32(slice, cursor + 16, le),
        strsize: readU32(slice, cursor + 20, le),
      };
      symbolTable = {
        offset: symtab.symoff,
        size: symtab.nsyms * (is64 ? 16 : 12),
        count: symtab.nsyms,
      };
    } else if (cmd === 0x1b && cmdsize >= 24) {
      uuid = uuidString(slice, cursor + 8);
    } else if (cmd === 0x32 && cmdsize >= 24) {
      platform = PLATFORMS[readU32(slice, cursor + 8, le)] ?? hex(readU32(slice, cursor + 8, le));
      minOS = versionString(readU32(slice, cursor + 12, le));
      sdk = versionString(readU32(slice, cursor + 16, le));
    } else if (
      cmd === 0x24 ||
      cmd === 0x25 ||
      cmd === 0x2f ||
      cmd === 0x30
    ) {
      platform =
        cmd === 0x24
          ? "macOS"
          : cmd === 0x25
            ? "iOS"
            : cmd === 0x2f
              ? "tvOS"
              : "watchOS";
      minOS = versionString(readU32(slice, cursor + 8, le));
      sdk = versionString(readU32(slice, cursor + 12, le));
    } else if (cmd === 0x28 && cmdsize >= 16) {
      entryPoint = hex(readU64(slice, cursor + 8, le));
    } else if (cmd === 0x1d && cmdsize >= 16) {
      codeSignature = {
        offset: readU32(slice, cursor + 8, le),
        size: readU32(slice, cursor + 12, le),
      };
    } else if (cmd === 0x26 && cmdsize >= 16) {
      const offset = readU32(slice, cursor + 8, le);
      const size = readU32(slice, cursor + 12, le);
      functionStarts = {
        offset,
        size,
        count: countFunctionStarts(slice, offset, size),
      };
    } else if (
      cmd === 0xc ||
      cmd === 0xd ||
      cmd === 0x80000018 ||
      cmd === 0x8000001f ||
      cmd === 0x20 ||
      cmd === 0x80000023
    ) {
      const nameOffset = readU32(slice, cursor + 8, le);
      const name = cString(slice, cursor + nameOffset, Math.max(0, cmdsize - nameOffset));
      if (name) {
        if (cmd === 0xd) installName = name;
        else libraries.push(name);
      }
    } else if (cmd === 0xe || cmd === 0x27) {
      const nameOffset = readU32(slice, cursor + 8, le);
      const name = cString(slice, cursor + nameOffset, Math.max(0, cmdsize - nameOffset));
      if (name) dylinker = name;
    } else if (cmd === 0x8000001c) {
      const nameOffset = readU32(slice, cursor + 8, le);
      const name = cString(slice, cursor + nameOffset, Math.max(0, cmdsize - nameOffset));
      if (name) rpaths.push(name);
    } else if (cmd === 0x21 || cmd === 0x2c) {
      const cryptId = readU32(slice, cursor + 16, le);
      encrypted = cryptId !== 0;
    } else if (cmd === 0x80000022 && cmdsize >= 48) {
      const offset = readU32(slice, cursor + 40, le);
      const size = readU32(slice, cursor + 44, le);
      if (size) exportTrieRange = { offset, size };
    } else if (cmd === 0x80000033 && cmdsize >= 16) {
      const offset = readU32(slice, cursor + 8, le);
      const size = readU32(slice, cursor + 12, le);
      if (size) exportTrieRange = { offset, size };
    }
    cursor += cmdsize;
  }

  for (const section of sections) {
    const zeroFill =
      section.type === "S_ZEROFILL" ||
      section.type === "S_GB_ZEROFILL" ||
      section.type === "S_THREAD_LOCAL_ZEROFILL";
    if (!zeroFill && section.fileOffset < slice.length && section.size > 0) {
      const sample = slice.subarray(
        section.fileOffset,
        Math.min(slice.length, section.fileOffset + Math.min(section.size, 1024 * 1024)),
      );
      section.entropy = shannon(sample);
    }
  }

  const parseSymbolTable = (): {
    symbols: MachOSymbol[];
    debugCount: number;
  } => {
    if (!symtab || !symtab.nsyms || !symtab.strsize) return { symbols: [], debugCount: 0 };
    const nlistSize = is64 ? 16 : 12;
    const tableEnd = symtab.symoff + symtab.nsyms * nlistSize;
    if (symtab.symoff >= slice.length || tableEnd > slice.length) {
      notes.push("Symbol table extends beyond the analyzed bytes.");
    }
    const count = Math.min(symtab.nsyms, MAX_SYMBOLS);
    if (symtab.nsyms > count) {
      notes.push(`Symbol table truncated at ${count.toLocaleString()} entries.`);
    }
    const symbols: MachOSymbol[] = [];
    let debugCount = 0;
    for (let index = 0; index < count; index++) {
      const base = symtab.symoff + index * nlistSize;
      if (base + nlistSize > slice.length) break;
      const strx = readU32(slice, base, le);
      const type = slice[base + 4] ?? 0;
      const nSect = slice[base + 5] ?? 0;
      const description = readU16(slice, base + 6, le);
      const value = is64 ? readU64(slice, base + 8, le) : readU32(slice, base + 8, le);
      if (strx === 0 || strx >= symtab.strsize) continue;
      const name = cString(
        slice,
        symtab.stroff + strx,
        Math.min(2048, symtab.strsize - strx),
      ).slice(0, 512);
      if (!name) continue;
      if (type & 0xe0) {
        debugCount++;
        continue;
      }
      const external = Boolean(type & 0x01);
      const symbolType = type & 0x0e;
      let kind: MachOSymbolKind;
      if (symbolType === 0x0 || symbolType === 0xc) {
        kind = external ? "imported" : "undefined";
      } else if (symbolType === 0x2) {
        kind = "absolute";
      } else if (symbolType === 0xa) {
        kind = "indirect";
      } else if (symbolType === 0xe) {
        kind = external ? "exported" : "local";
      } else {
        kind = "local";
      }
      const section =
        nSect > 0 && nSect <= sections.length
          ? sections[nSect - 1].name
          : "";
      if (nSect > 0 && nSect <= sections.length) {
        sections[nSect - 1].symbolCount++;
      }
      let library: string | undefined;
      if (kind === "imported" || kind === "undefined") {
        const ordinal = (description >> 8) & 0xff;
        if (ordinal === 0xfe) library = "dynamic lookup";
        else if (ordinal === 0xff) library = "main executable";
        else if (ordinal > 0) library = libraries[ordinal - 1] ?? `library ${ordinal}`;
      }
      symbols.push({
        name,
        kind,
        external,
        section,
        address: value,
        addressHex: value ? hex(value) : "",
        library,
        typeFlags: type,
        description,
      });
    }
    return { symbols, debugCount };
  };

  const symbolResult = parseSymbolTable();
  const symbols = symbolResult.symbols;
  if (exportTrieRange) {
    const exported = exportTrie(
      slice,
      exportTrieRange.offset,
      exportTrieRange.size,
      notes,
    );
    const known = new Set(symbols.map((symbol) => `${symbol.name}:${symbol.address}`));
    for (const symbol of exported) {
      const key = `${symbol.name}:${symbol.address}`;
      if (known.has(key)) continue;
      known.add(key);
      symbols.push(symbol);
      if (symbols.length >= MAX_SYMBOLS) break;
    }
  }

  for (const symbol of symbols) {
    const recovered = demangleSymbol(symbol.name);
    symbol.demangled = recovered.demangled;
    symbol.language = recovered.language;
    symbol.objectiveC = recovered.objectiveC;
  }
  const swiftSymbols = symbols.filter(
    (symbol) => symbol.language === "swift",
  ).length;

  const strings: MachOString[] = [];
  const seenStrings = new Set<string>();
  let stringsTruncated = false;
  for (const section of sections) {
    if (CODE_SECTIONS.has(section.section)) continue;
    if (
      section.type === "S_ZEROFILL" ||
      section.type === "S_GB_ZEROFILL" ||
      section.type === "S_THREAD_LOCAL_ZEROFILL"
    ) {
      continue;
    }
    if (!section.size || section.fileOffset >= slice.length) continue;
    const available = Math.min(section.size, MAX_SECTION_SCAN);
    if (section.size > available) {
      notes.push(`${section.name} string scan capped at ${fmtBytes(available)}.`);
    }
    const data = slice.subarray(
      section.fileOffset,
      Math.min(slice.length, section.fileOffset + available),
    );
    const utf16 = section.section === "__ustring";
    const minLength = utf16 ? 4 : 5;
    let run = "";
    let runStart = -1;
    const flush = (end: number) => {
      if (run.trim().length >= minLength && !seenStrings.has(run)) {
        seenStrings.add(run);
        const current = section.stringCount;
        section.stringCount = current + 1;
        strings.push({
          value: run.slice(0, 512),
          section: section.name,
          offset: section.fileOffset + Math.max(0, runStart),
          encoding: utf16 ? "utf16" : "ascii",
        });
        if (strings.length >= MAX_STRINGS) stringsTruncated = true;
      }
      run = "";
      runStart = -1;
      void end;
    };
    if (utf16) {
      for (let offset = 0; offset + 1 < data.length; offset += 2) {
        const code = data[offset] | (data[offset + 1] << 8);
        if (code >= 32 && code <= 126) {
          if (runStart < 0) runStart = offset;
          run += String.fromCharCode(code);
        } else {
          flush(offset);
        }
        if (stringsTruncated) break;
      }
      flush(data.length);
    } else {
      for (let offset = 0; offset < data.length; offset++) {
        const code = data[offset];
        if (code >= 32 && code <= 126) {
          if (runStart < 0) runStart = offset;
          run += String.fromCharCode(code);
        } else {
          flush(offset);
        }
        if (stringsTruncated) break;
      }
      flush(data.length);
    }
    if (stringsTruncated) break;
  }
  if (stringsTruncated) {
    notes.push(`String table truncated at ${MAX_STRINGS.toLocaleString()} entries.`);
  }
  const objectiveC = buildObjectiveCRecovery(symbols, strings);

  return {
    name: machoArchName(cpuRaw, subType),
    cpu: MACHO_CPUS[cpuRaw] ?? hex(cpuRaw),
    subType,
    fileType: MACHO_TYPES[fileTypeCode] ?? hex(fileTypeCode),
    fileTypeCode,
    endian: le ? "little" : "big",
    bitness: is64 ? 64 : 32,
    offset: entry.offset,
    size: entry.size,
    flags: hex(flags),
    uuid,
    platform,
    minOS,
    sdk,
    entryPoint,
    dylinker,
    installName,
    encrypted,
    codeSignature,
    functionStarts,
    symbolTable,
    segments,
    sections,
    symbols,
    strings,
    libraries,
    rpaths,
    objectiveC,
    swiftSymbols,
    symbolCount: symbolTable?.count ?? symbols.length,
    debugSymbolCount: symbolResult.debugCount,
    stringCount: strings.length,
    sectionCount: sections.length,
    notes,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  try {
    const data = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}

export async function analyzeMachO(file: File): Promise<MachOAnalysis | null> {
  const readSize = Math.min(file.size, MAX_READ);
  if (!readSize) return null;
  const bytes = new Uint8Array(await file.slice(0, readSize).arrayBuffer());
  const parsed = parseSlices(bytes);
  if (!parsed) return null;
  const notes: string[] = [];
  if (file.size > readSize) {
    notes.push(
      `Analysis read the first ${fmtBytes(readSize)} of ${fmtBytes(file.size)}.`,
    );
  }
  const architectures: MachOArchitecture[] = [];
  for (let index = 0; index < parsed.entries.length; index++) {
    const entry = parsed.entries[index];
    const end = Math.min(bytes.length, entry.offset + entry.size);
    if (entry.offset >= bytes.length || end <= entry.offset) {
      notes.push(`Slice ${index + 1} is outside the analyzed bytes.`);
      continue;
    }
    const analyzed = analyzeSlice(bytes.subarray(entry.offset, end), entry);
    if (analyzed) architectures.push(analyzed);
    else notes.push(`Slice ${index + 1} is not a parseable Mach-O image.`);
  }
  if (!architectures.length) return null;

  const symbols = architectures.reduce(
    (total, architecture) => total + architecture.symbols.length,
    0,
  );
  const strings = architectures.reduce(
    (total, architecture) => total + architecture.strings.length,
    0,
  );
  const sections = architectures.reduce(
    (total, architecture) => total + architecture.sections.length,
    0,
  );
  const libraries = new Set(
    architectures.flatMap((architecture) => architecture.libraries),
  );
  const swiftSymbols = architectures.reduce(
    (total, architecture) => total + architecture.swiftSymbols,
    0,
  );
  const objcClasses = new Set(
    architectures.flatMap((architecture) => architecture.objectiveC.classes),
  ).size;
  const objcMethods = architectures.reduce(
    (total, architecture) => total + architecture.objectiveC.methods.length,
    0,
  );

  return {
    tool: "MITOSIS",
    version: 1,
    generatedAt: new Date().toISOString(),
    fileName: file.name || "artifact",
    fileSize: file.size,
    analyzedBytes: bytes.length,
    sha256: await sha256Hex(bytes),
    format: parsed.format,
    architectures,
    totals: {
      architectures: architectures.length,
      sections,
      symbols,
      strings,
      libraries: libraries.size,
      swiftSymbols,
      objcClasses,
      objcMethods,
    },
    notes,
  };
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function markdownCode(value: string): string {
  return `\`${value.replace(/`/g, "\\`")}\``;
}

export function formatMachOReport(
  report: MachOAnalysis,
  format: "json" | "markdown" = "json",
): string {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;

  const lines: string[] = [
    "# MITOSIS Mach-O analysis",
    "",
    `Generated: ${report.generatedAt}`,
    `File: ${report.fileName}`,
    `Format: ${report.format === "fat" ? "Universal Mach-O" : "Mach-O"}`,
    `Size: ${fmtBytes(report.fileSize)}`,
    `Analyzed: ${fmtBytes(report.analyzedBytes)}`,
    `SHA-256: ${report.sha256 || "unavailable"}`,
    "",
    "## Summary",
    "",
    "| Architectures | Sections | Symbols | Strings | Libraries |",
    "| ---: | ---: | ---: | ---: | ---: |",
    `| ${report.totals.architectures} | ${report.totals.sections} | ${report.totals.symbols} | ${report.totals.strings} | ${report.totals.libraries} |`,
    "",
    "| Swift symbols | Objective-C classes | Objective-C methods |",
    "| ---: | ---: | ---: |",
    `| ${report.totals.swiftSymbols} | ${report.totals.objcClasses} | ${report.totals.objcMethods} |`,
    "",
    "This is a static structural report. It does not decompile code, recover a control-flow graph, or reconstruct source. Demangled names are best-effort; raw symbols are retained.",
    "",
  ];

  if (report.notes.length) {
    lines.push("### Notes", "");
    for (const note of report.notes) lines.push(`- ${note}`);
    lines.push("");
  }

  for (const [index, architecture] of report.architectures.entries()) {
    lines.push(
      `## ${index + 1}. ${architecture.name}`,
      "",
      `- File type: ${architecture.fileType}`,
      `- CPU: ${architecture.cpu}`,
      `- Bitness: ${architecture.bitness}-bit ${architecture.endian}-endian`,
      `- Slice: offset ${hex(architecture.offset)}, ${fmtBytes(architecture.size)}`,
      `- Flags: ${architecture.flags}`,
    );
    if (architecture.uuid) lines.push(`- UUID: ${architecture.uuid}`);
    if (architecture.platform) lines.push(`- Platform: ${architecture.platform}`);
    if (architecture.minOS) lines.push(`- Minimum OS: ${architecture.minOS}`);
    if (architecture.sdk) lines.push(`- SDK: ${architecture.sdk}`);
    if (architecture.entryPoint) lines.push(`- Entry: ${architecture.entryPoint}`);
    if (architecture.dylinker) lines.push(`- Dynamic linker: ${architecture.dylinker}`);
    if (architecture.installName) lines.push(`- Install name: ${architecture.installName}`);
    if (architecture.encrypted) lines.push("- Encryption: encrypted");
    if (architecture.codeSignature) {
      lines.push(
        `- Code signature: ${hex(architecture.codeSignature.offset)} (${fmtBytes(
          architecture.codeSignature.size,
        )})`,
      );
    }
    if (architecture.functionStarts) {
      lines.push(
        `- Function starts: ${architecture.functionStarts.count} entries`,
      );
    }
    lines.push(
      `- Swift symbols: ${architecture.swiftSymbols}`,
      `- Objective-C: ${architecture.objectiveC.classes.length} classes, ${architecture.objectiveC.protocols.length} protocols, ${architecture.objectiveC.methods.length} methods`,
      "",
    );

    lines.push("### Segments", "");
    lines.push(
      "| Name | Address | Size | File offset | File size | Protection |",
      "| --- | ---: | ---: | ---: | ---: | :---: |",
    );
    for (const segment of architecture.segments) {
      lines.push(
        `| ${markdownCell(markdownCode(segment.name))} | ${segment.addressHex} | ${fmtBytes(
          segment.size,
        )} | ${hex(segment.fileOffset)} | ${fmtBytes(segment.fileSize)} | ${segment.protection} |`,
      );
    }
    lines.push("");

    lines.push("### Sections", "");
    lines.push(
      "| Section | Address | Size | File offset | Type | Entropy | Symbols | Strings |",
      "| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |",
    );
    for (const section of architecture.sections) {
      lines.push(
        `| ${markdownCell(markdownCode(section.name))} | ${section.addressHex} | ${fmtBytes(
          section.size,
        )} | ${hex(section.fileOffset)} | ${section.type} | ${section.entropy.toFixed(
          2,
        )} | ${section.symbolCount} | ${section.stringCount} |`,
      );
    }
    lines.push("");

    lines.push("### Linked libraries", "");
    if (architecture.libraries.length) {
      for (const library of architecture.libraries) lines.push(`- ${markdownCode(library)}`);
    } else {
      lines.push("_No linked libraries recorded._");
    }
    lines.push("");
    if (architecture.rpaths.length) {
      lines.push("### Rpaths", "");
      for (const rpath of architecture.rpaths) lines.push(`- ${markdownCode(rpath)}`);
      lines.push("");
    }

    lines.push("### Objective-C recovery", "");
    const objc = architecture.objectiveC;
    if (!objc.classes.length && !objc.protocols.length && !objc.methods.length && !objc.ivars.length && !objc.selectors.length) {
      lines.push("_No Objective-C metadata recovered._", "");
    } else {
      const classList = objc.classes.slice(0, MAX_MARKDOWN_OBJC);
      const selectorList = objc.selectors.slice(0, MAX_MARKDOWN_OBJC);
      const protocolList = objc.protocols.slice(0, MAX_MARKDOWN_OBJC);
      const ivarList = objc.ivars.slice(0, MAX_MARKDOWN_OBJC);
      const methodList = objc.methods.slice(0, MAX_MARKDOWN_OBJC);
      if (classList.length) {
        lines.push(`**Classes (${objc.classes.length}):** ${classList.map(markdownCode).join(", ")}`);
        if (objc.classes.length > classList.length) {
          lines.push(`_Showing first ${classList.length} classes; export JSON for all._`);
        }
        lines.push("");
      }
      if (protocolList.length) {
        lines.push(`**Protocols (${objc.protocols.length}):** ${protocolList.map(markdownCode).join(", ")}`);
        if (objc.protocols.length > protocolList.length) {
          lines.push(`_Showing first ${protocolList.length} protocols; export JSON for all._`);
        }
        lines.push("");
      }
      if (selectorList.length) {
        lines.push(`**Selectors (${objc.selectors.length}):** ${selectorList.map(markdownCode).join(", ")}`);
        if (objc.selectors.length > selectorList.length) {
          lines.push(`_Showing first ${selectorList.length} selectors; export JSON for all._`);
        }
        lines.push("");
      }
      if (ivarList.length) {
        lines.push(`**Ivars (${objc.ivars.length}):** ${ivarList.map(markdownCode).join(", ")}`);
        if (objc.ivars.length > ivarList.length) {
          lines.push(`_Showing first ${ivarList.length} ivars; export JSON for all._`);
        }
        lines.push("");
      }
      if (methodList.length) {
        lines.push(
          "| Class | Method | Type |",
          "| --- | --- | :---: |",
        );
        for (const method of methodList) {
          lines.push(
            `| ${markdownCell(markdownCode(method.className))} | ${markdownCell(markdownCode(method.selector))} | ${method.classMethod ? "class" : "instance"} |`,
          );
        }
        if (objc.methods.length > methodList.length) {
          lines.push(
            "",
            `_Showing ${methodList.length} of ${objc.methods.length} methods; export JSON for all._`,
          );
        }
        lines.push("");
      } else {
        lines.push("_No Objective-C method symbols recovered._", "");
      }
    }

    lines.push(`### Symbols (${architecture.symbols.length.toLocaleString()})`, "");
    if (architecture.symbols.length) {
      lines.push(
        "| Name | Raw | Kind | Section | Address | Library |",
        "| --- | --- | --- | --- | ---: | --- |",
      );
      const shown = architecture.symbols.slice(0, MAX_MARKDOWN_SYMBOLS);
      for (const symbol of shown) {
        const name = symbol.demangled ?? symbol.name;
        const raw = name === symbol.name ? "" : markdownCell(markdownCode(symbol.name));
        lines.push(
          `| ${markdownCell(markdownCode(name))} | ${raw} | ${symbol.kind} | ${
            symbol.section ? markdownCell(markdownCode(symbol.section)) : ""
          } | ${symbol.addressHex} | ${
            symbol.library ? markdownCell(markdownCode(symbol.library)) : ""
          } |`,
        );
      }
      if (architecture.symbols.length > shown.length) {
        lines.push(
          "",
          `_Showing ${shown.length.toLocaleString()} of ${architecture.symbols.length.toLocaleString()} symbols; export JSON for the complete list._`,
        );
      }
    } else {
      lines.push("_No non-debug symbols in LC_SYMTAB._");
    }
    lines.push("");

    lines.push(`### Strings (${architecture.strings.length.toLocaleString()})`, "");
    if (architecture.strings.length) {
      lines.push("| Value | Section | Offset |", "| --- | --- | ---: |");
      const shown = architecture.strings.slice(0, MAX_MARKDOWN_STRINGS);
      for (const string of shown) {
        lines.push(
          `| ${markdownCell(string.value)} | ${markdownCell(
            markdownCode(string.section),
          )} | ${hex(string.offset)} |`,
        );
      }
      if (architecture.strings.length > shown.length) {
        lines.push(
          "",
          `_Showing ${shown.length.toLocaleString()} of ${architecture.strings.length.toLocaleString()} strings; export JSON for the complete list._`,
        );
      }
    } else {
      lines.push("_No printable strings found in data sections._");
    }
    lines.push("");
  }

  lines.push(
    "---",
    "",
    "Generated locally by MITOSIS. The report is static evidence, not a decompilation.",
    "",
  );
  return lines.join("\n");
}

export function reportFileName(report: MachOAnalysis, format: "json" | "markdown"): string {
  const base = report.fileName.replace(/\.[^./\\]+$/, "") || "artifact";
  return `${base}-analysis.${format === "json" ? "json" : "md"}`;
}

export function downloadMachOReport(
  report: MachOAnalysis,
  format: "json" | "markdown",
): void {
  const text = formatMachOReport(report, format);
  const blob = new Blob([text], {
    type: format === "json" ? "application/json" : "text/markdown",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = reportFileName(report, format);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 600);
}

export function isMachOArtifact(format: string): boolean {
  return format.startsWith("MACH-O");
}
