export type SymbolLanguage = "swift" | "objc" | "c" | "c++" | "unknown";

export type ObjectiveCKind =
  | "class"
  | "metaclass"
  | "protocol"
  | "method"
  | "ivar"
  | "unknown";

export interface ObjectiveCName {
  kind: ObjectiveCKind;
  className?: string;
  selector?: string;
  classMethod?: boolean;
  ivar?: string;
}

export interface DemangledSymbol {
  demangled?: string;
  language: SymbolLanguage;
  objectiveC?: ObjectiveCName;
}

export interface ObjectiveCMethod {
  className: string;
  selector: string;
  classMethod: boolean;
  symbol: string;
  demangled: string;
}

export interface ObjectiveCRecovery {
  classes: string[];
  protocols: string[];
  methods: ObjectiveCMethod[];
  ivars: string[];
  selectors: string[];
}

interface SwiftType {
  text: string;
  tuple?: SwiftType[];
  standardKind?: "array" | "dictionary" | "set" | "optional";
  fn?: { params: SwiftType; result: SwiftType; annotations: string[] };
}

type SubEntry =
  | { kind: "name"; text: string }
  | { kind: "type"; type: SwiftType };

type Unit =
  | { kind: "type"; type: SwiftType }
  | { kind: "name"; text: string }
  | { kind: "marker" }
  | { kind: "empty" }
  | { kind: "annotation"; text: string }
  | { kind: "requirement"; text: string };

interface SwiftPath {
  path: string[];
  typeText: string;
  kind: string | null;
  moduleOnly: boolean;
}

function moduleOfTypeText(text: string): string {
  const bare = text.replace(/^\(extension in [^)]+\):/, "");
  return bare.split(".")[0] || "Swift";
}

const SWIFT_STDLIB: Record<string, string> = {
  A: "Swift.AutoreleasingUnsafeMutablePointer",
  a: "Swift.Array",
  B: "Swift.BinaryFloatingPoint",
  b: "Swift.Bool",
  D: "Swift.Dictionary",
  d: "Swift.Double",
  E: "Swift.Encodable",
  e: "Swift.Decodable",
  F: "Swift.FloatingPoint",
  f: "Swift.Float",
  G: "Swift.RandomNumberGenerator",
  H: "Swift.Hashable",
  h: "Swift.Set",
  I: "Swift.DefaultIndices",
  i: "Swift.Int",
  J: "Swift.Character",
  j: "Swift.Numeric",
  K: "Swift.BidirectionalCollection",
  k: "Swift.RandomAccessCollection",
  L: "Swift.Comparable",
  l: "Swift.Collection",
  M: "Swift.MutableCollection",
  m: "Swift.RangeReplaceableCollection",
  N: "Swift.ClosedRange",
  n: "Swift.Range",
  O: "Swift.ObjectIdentifier",
  P: "Swift.UnsafePointer",
  p: "Swift.UnsafeMutablePointer",
  Q: "Swift.Equatable",
  q: "Swift.Optional",
  R: "Swift.UnsafeBufferPointer",
  r: "Swift.UnsafeMutableBufferPointer",
  S: "Swift.String",
  s: "Swift.Substring",
  T: "Swift.Sequence",
  t: "Swift.IteratorProtocol",
  U: "Swift.UnsignedInteger",
  u: "Swift.UInt",
  V: "Swift.UnsafeRawPointer",
  v: "Swift.UnsafeMutableRawPointer",
  W: "Swift.UnsafeRawBufferPointer",
  w: "Swift.UnsafeMutableRawBufferPointer",
  X: "Swift.RangeExpression",
  x: "Swift.Strideable",
  Y: "Swift.RawRepresentable",
  y: "Swift.StringProtocol",
  Z: "Swift.SignedInteger",
  z: "Swift.BinaryInteger",
};

const SWIFT_STDLIB_2: Record<string, string> = {
  A: "Swift.Actor",
  C: "Swift.CheckedContinuation",
  c: "Swift.UnsafeContinuation",
  E: "Swift.CancellationError",
  e: "Swift.UnownedSerialExecutor",
  F: "Swift.Executor",
  f: "Swift.SerialExecutor",
  G: "Swift.TaskGroup",
  g: "Swift.ThrowingTaskGroup",
  I: "Swift.AsyncIteratorProtocol",
  i: "Swift.AsyncSequence",
  J: "Swift.UnownedJob",
  M: "Swift.MainActor",
  P: "Swift.TaskPriority",
  S: "Swift.AsyncStream",
  s: "Swift.AsyncThrowingStream",
  T: "Swift.Task",
  t: "Swift.UnsafeCurrentTask",
};

const BUILTIN_TYPES: Record<string, string> = {
  b: "Builtin.BridgeObject",
  B: "Builtin.UnsafeValueBuffer",
  c: "Builtin.RawUnsafeContinuation",
  D: "Builtin.DefaultActorStorage",
  e: "Builtin.Executor",
  J: "Builtin.Job",
  O: "Builtin.UnknownObject",
  o: "Builtin.NativeObject",
  P: "Builtin.RawPointer",
  p: "Builtin.RawPointer",
  t: "Builtin.SILToken",
  w: "Builtin.Word",
  I: "Builtin.IntLiteral",
};

const THUNKS: { suffix: string; prefix: string }[] = [
  { suffix: "Tj", prefix: "dispatch thunk of " },
  { suffix: "Tu", prefix: "async function pointer to " },
  { suffix: "Tq", prefix: "method descriptor for " },
  { suffix: "Tm", prefix: "merged " },
  { suffix: "TO", prefix: "Objective-C to Swift thunk of " },
  { suffix: "To", prefix: "Swift to Objective-C thunk of " },
];

const FUNCTION_KINDS = new Set(["f", "U", "K", "B", "L", "C", "A", "E", "O"]);
const NOMINAL_MARKERS = new Set(["V", "C", "O", "P", "a"]);
const MAX_REPEAT = 64;
const MAX_GENERIC_COUNT = 64;

function isDigit(ch: string | undefined): boolean {
  return Boolean(ch && ch >= "0" && ch <= "9");
}

function isLowerLetter(ch: string | undefined): boolean {
  return Boolean(ch && ch >= "a" && ch <= "z");
}

function isUpperLetter(ch: string | undefined): boolean {
  return Boolean(ch && ch >= "A" && ch <= "Z");
}

function isWordStart(ch: string | undefined): boolean {
  return Boolean(ch && ch !== "_" && ch !== "\0" && !isDigit(ch));
}

function isWordEnd(ch: string | undefined, previous: string | undefined): boolean {
  if (!ch || ch === "_" || ch === "\0") return true;
  return !isUpperLetter(previous) && isUpperLetter(ch);
}

function scanIdentifier(
  text: string,
  index: number,
): { value: string; next: number } | null {
  let cursor = index;
  let digits = "";
  while (isDigit(text[cursor])) {
    digits += text[cursor];
    cursor++;
  }
  if (!digits) return null;
  const length = Number(digits);
  if (!Number.isFinite(length) || length < 1 || cursor + length > text.length) {
    return null;
  }
  return {
    value: text.slice(cursor, cursor + length),
    next: cursor + length,
  };
}

function genericParamName(depth: number, index: number): string {
  const letter =
    index < 26 ? String.fromCharCode("A".charCodeAt(0) + index) : `T${index}`;
  return depth > 0 ? `${letter}${depth}` : letter;
}

function accessorLabel(accessor: string | undefined): string {
  switch (accessor) {
    case "g":
    case "G":
      return "getter";
    case "s":
      return "setter";
    case "M":
    case "x":
      return "modify";
    case "r":
    case "y":
      return "read";
    case "w":
      return "willSet";
    case "W":
      return "didSet";
    case "b":
      return "borrow";
    case "p":
      return "";
    default:
      return "";
  }
}

function tupleText(elements: SwiftType[]): string {
  return `(${elements.map((element) => element.text).join(", ")})`;
}

function functionText(
  params: SwiftType,
  result: SwiftType,
  annotations: string[] = [],
): string {
  const paramsText =
    params.tuple !== undefined ? tupleText(params.tuple) : `(${params.text})`;
  const suffix = annotations.length ? ` ${annotations.join(" ")}` : "";
  return `${paramsText}${suffix} -> ${result.text}`;
}

function applyGeneric(base: SwiftType, args: SwiftType[]): string {
  const first = args[0]?.text ?? "Any";
  switch (base.standardKind) {
    case "array":
      return `[${first}]`;
    case "dictionary":
      return `[${first} : ${args[1]?.text ?? "Any"}]`;
    case "set":
      return `Swift.Set<${first}>`;
    case "optional":
      return args[0]?.fn ? `(${first})?` : `${first}?`;
    default:
      return args.length
        ? `${base.text}<${args.map((arg) => arg.text).join(", ")}>`
        : base.text;
  }
}

function flattenParams(params: SwiftType): SwiftType[] {
  return params.tuple ?? [params];
}

function genericParameters(
  counts: number[],
  requirements: string[],
): string {
  const count = Math.min(counts[0] ?? 0, MAX_GENERIC_COUNT);
  if (count <= 0) return "";
  const names: string[] = [];
  for (let index = 0; index < count; index++) {
    names.push(genericParamName(0, index));
  }
  if (!requirements.length) return `<${names.join(", ")}>`;
  return `<${names.join(", ")} where ${requirements.join(", ")}>`;
}

class SwiftDemangler {
  private readonly text: string;
  private pos = 0;
  private readonly subs: SubEntry[] = [];
  private readonly words: string[] = [];
  private readonly stack: Unit[] = [];
  private collectedNames: string[] = [];

  constructor(text: string) {
    this.text = text;
  }

  get remaining(): string {
    return this.text.slice(this.pos);
  }

  get fallbackName(): string | null {
    return this.collectedNames[0] ?? null;
  }

  // ---- path -------------------------------------------------------------

  parsePath(): SwiftPath | null {
    let module: string;
    if (this.text.startsWith("So", this.pos)) {
      this.pos += 2;
      module = "__C";
    } else if (this.text.startsWith("SC", this.pos)) {
      this.pos += 2;
      module = "ClangImporter";
    } else if (this.text[this.pos] === "s") {
      this.pos += 1;
      module = "Swift";
    } else {
      const identifier = this.readIdentifier();
      if (!identifier) return null;
      module = identifier;
    }

    const path = [module];
    let typeText = module;
    let kind: string | null = null;
    let guard = 0;
    while (isDigit(this.text[this.pos]) && guard++ < 64) {
      const savePos = this.pos;
      const saveSubs = this.subs.length;
      const saveWords = this.words.length;
      const identifier = this.readIdentifier();
      if (!identifier) return null;
      if (this.hasNominalMarker()) {
        kind = this.readNominalMarker();
        typeText = `${typeText}.${identifier}`;
        this.recordType({ text: typeText });
        path.push(identifier);
        continue;
      }
      this.pos = savePos;
      this.subs.length = saveSubs;
      this.words.length = saveWords;
      break;
    }

    // Extension contexts: `<module>E` (or a bare `E` for the type's own module)
    // wrap everything that follows, e.g. "(extension in Foundation):Swift.String".
    let extensionModule: string | null = null;
    let extensionGuard = 0;
    while (extensionGuard++ < 4) {
      const savePos = this.pos;
      const saveSubs = this.subs.length;
      const saveWords = this.words.length;
      let owner: string | null = null;
      if (this.text.startsWith("AAE", this.pos)) {
        // Protocol extension: `AA` substitutes the protocol just parsed.
        owner = path[0];
        this.pos += 2;
      } else if (this.text[this.pos] === "E") {
        owner = path[0];
      } else if (isDigit(this.text[this.pos])) {
        const identifier = this.readIdentifier();
        if (identifier && this.text[this.pos] === "E") owner = identifier;
      }
      if (!owner) {
        this.restore(savePos, saveSubs, saveWords);
        break;
      }
      this.pos += 1;
      extensionModule = owner;

      // Nested nominal types declared inside the extension.
      let nested = 0;
      while (isDigit(this.text[this.pos]) && nested++ < 32) {
        const nestedPos = this.pos;
        const nestedSubs = this.subs.length;
        const nestedWords = this.words.length;
        const identifier = this.readIdentifier();
        if (!identifier) {
          this.restore(nestedPos, nestedSubs, nestedWords);
          break;
        }
        if (this.hasNominalMarker()) {
          kind = this.readNominalMarker();
          typeText = `${typeText}.${identifier}`;
          this.recordType({ text: `(extension in ${owner}):${typeText}` });
          path.push(identifier);
          continue;
        }
        this.restore(nestedPos, nestedSubs, nestedWords);
        break;
      }
    }
    if (extensionModule) {
      typeText = `(extension in ${extensionModule}):${typeText}`;
    }

    return { path, typeText, kind, moduleOnly: kind === null };
  }

  parseTypeContext(): SwiftPath | null {
    const savePos = this.pos;
    const saveSubs = this.subs.length;
    const saveWords = this.words.length;
    const terminator = this.parseTypeOps(true);
    const unit = this.stack.pop();
    if (
      terminator === null ||
      !unit ||
      unit.kind !== "type" ||
      this.stack.length > 0
    ) {
      this.restore(savePos, saveSubs, saveWords);
      return null;
    }
    this.stack.length = 0;
    return {
      path: [],
      typeText: unit.type.text,
      kind: null,
      moduleOnly: false,
    };
  }

  // ---- entity -----------------------------------------------------------

  parseEntity(path: SwiftPath): string | null {
    const savePos = this.pos;
    const saveSubs = this.subs.length;
    const saveWords = this.words.length;
    this.stack.length = 0;
    this.collectedNames = [];

    if (this.text[this.pos] === "Z") this.pos++;

    // Extension on the context type: `<module>E`, `sE` or a bare `E`.
    // `SS10FoundationE19_bridgeToObjectiveC` becomes
    // "(extension in Foundation):Swift.String._bridgeToObjectiveC".
    const extensionAt = this.pos;
    const extensionSubs = this.subs.length;
    const extensionWords = this.words.length;
    let extensionOwner: string | null = null;
    if (this.text.startsWith("sE", this.pos)) {
      extensionOwner = "Swift";
      this.pos += 1;
    } else if (this.text[this.pos] === "E") {
      extensionOwner = "";
    } else if (isDigit(this.text[this.pos])) {
      const identifier = this.readIdentifier();
      if (identifier && this.text[this.pos] === "E") extensionOwner = identifier;
    }
    if (extensionOwner !== null) {
      this.pos += 1;
      const owner = extensionOwner || moduleOfTypeText(path.typeText);
      path = { ...path, typeText: `(extension in ${owner}):${path.typeText}` };
      if (isDigit(this.text[this.pos])) {
        const nestedPos = this.pos;
        const nestedSubs = this.subs.length;
        const nestedWords = this.words.length;
        const nested = this.readIdentifier();
        if (nested && this.hasNominalMarker()) {
          const marker = this.readNominalMarker();
          path = {
            ...path,
            typeText: `${path.typeText}.${nested}`,
            kind: marker,
            moduleOnly: false,
          };
        } else {
          this.restore(nestedPos, nestedSubs, nestedWords);
        }
      }
    } else {
      this.restore(extensionAt, extensionSubs, extensionWords);
    }

    const names: string[] = [];
    while (this.pos < this.text.length) {
      if (this.text[this.pos] === "_") {
        names.push("");
        this.pos++;
        continue;
      }
      if (!isDigit(this.text[this.pos])) break;
      if (this.looksLikeNominalStart()) break;
      const identifier = this.readIdentifier();
      if (!identifier) break;
      // Private discriminator: `<name><discriminator>LL` prints as
      // `(name in discriminator)`.
      if (this.text.startsWith("LL", this.pos)) {
        const previous = names[names.length - 1];
        if (previous === undefined) break;
        this.pos += 2;
        names[names.length - 1] = `(${previous} in ${identifier})`;
        continue;
      }
      names.push(identifier);
    }
    this.collectedNames = names;

    const terminator = this.parseTypeOps();
    if (terminator === null) {
      this.restore(savePos, saveSubs, saveWords);
      return null;
    }

    if (terminator === "F" || terminator === "l" || terminator === "r") {
      let generic: { counts: number[]; requirements: string[] } | null = null;
      if (terminator === "l" || terminator === "r") {
        generic = this.parseGenericSignature();
        if (!generic) {
          this.restore(savePos, saveSubs, saveWords);
          return null;
        }
      }
      if (this.text[this.pos] !== "F") {
        this.restore(savePos, saveSubs, saveWords);
        return null;
      }
      this.pos++;
      let isStatic = false;
      if (this.text[this.pos] === "Z") {
        isStatic = true;
        this.pos++;
      }
      const labels = names.slice(1);
      const built = this.buildFunction(path, names[0], labels, generic);
      if (!built || !this.atEndOrSuffix()) {
        this.restore(savePos, saveSubs, saveWords);
        return null;
      }
      return isStatic ? `static ${built}` : built;
    }

    if (terminator === "v") {
      this.pos++;
      const accessor = this.text[this.pos];
      this.pos++;
      if (accessor === "a" || accessor === "l") this.pos++;
      const staticAccessor = this.text[this.pos] === "Z";
      if (staticAccessor) this.pos++;
      const typeUnit = this.stack.pop();
      if (
        !accessor ||
        !typeUnit ||
        typeUnit.kind !== "type" ||
        names.length === 0 ||
        !this.atEndOrSuffix()
      ) {
        this.restore(savePos, saveSubs, saveWords);
        return null;
      }
      const label = accessorLabel(accessor);
      let text = `${staticAccessor ? "static " : ""}${path.typeText}.${names[0]}${label ? `.${label}` : ""} : ${typeUnit.type.text}`;
      if (this.text[this.pos] === ".") {
        text += ` with unmangled suffix "${this.remaining}"`;
      }
      return text;
    }

    if (terminator === "f") {
      if (this.text.startsWith("fD", this.pos)) {
        this.pos += 2;
        return `${path.typeText}.__deallocating_deinit`;
      }
      if (this.text.startsWith("fd", this.pos)) {
        this.pos += 2;
        return `${path.typeText}.deinit`;
      }
      if (this.text.startsWith("fE", this.pos)) {
        this.pos += 2;
        return `${path.typeText}.__ivar_destroyer`;
      }
      if (
        this.text.startsWith("fC", this.pos) ||
        this.text.startsWith("fc", this.pos)
      ) {
        const allocating = this.text.startsWith("fC", this.pos);
        this.pos += 2;
        const typeUnit = this.stack.pop();
        if (!typeUnit || typeUnit.kind !== "type" || !typeUnit.type.fn) {
          this.restore(savePos, saveSubs, saveWords);
          return null;
        }
        const built = this.buildInitializer(
          path,
          names,
          typeUnit.type.fn,
          allocating,
        );
        if (!built || !this.atEndOrSuffix()) {
          this.restore(savePos, saveSubs, saveWords);
          return null;
        }
        return built;
      }
    }

    this.restore(savePos, saveSubs, saveWords);
    return null;
  }

  private buildFunction(
    path: SwiftPath,
    member: string,
    labels: string[],
    generic: { counts: number[]; requirements: string[] } | null,
  ): string | null {
    const annotations = this.popAnnotations();
    const paramsUnit = this.stack.pop();
    const resultUnit = this.stack.pop();
    if (!paramsUnit || !resultUnit) return null;

    const result =
      resultUnit.kind === "empty"
        ? { text: "()", tuple: [] as SwiftType[] }
        : resultUnit.kind === "type"
          ? resultUnit.type
          : null;
    const params =
      paramsUnit.kind === "empty"
        ? { text: "()", tuple: [] as SwiftType[] }
        : paramsUnit.kind === "type"
          ? paramsUnit.type
          : null;
    if (!result || !params) return null;

    const flattened = flattenParams(params);
    const useLabels = labels.length > 0 && labels.length === flattened.length;
    const parts = flattened.map((param, index) =>
      useLabels ? `${labels[index] || "_"}: ${param.text}` : param.text,
    );
    const genericText = generic
      ? genericParameters(generic.counts, generic.requirements)
      : "";
    const suffix = annotations.length ? ` ${annotations.join(" ")}` : "";
    return `${path.typeText}.${member}${genericText}(${parts.join(", ")})${suffix} -> ${result.text}`;
  }

  private buildInitializer(
    path: SwiftPath,
    labels: string[],
    fn: { params: SwiftType; result: SwiftType; annotations: string[] },
    allocating: boolean,
  ): string {
    const flattened = flattenParams(fn.params);
    const useLabels = labels.length > 0 && labels.length === flattened.length;
    const parts = flattened.map((param, index) =>
      useLabels ? `${labels[index] || "_"}: ${param.text}` : param.text,
    );
    const name =
      allocating && path.kind === "C" ? "__allocating_init" : "init";
    const suffix = fn.annotations.length
      ? ` ${fn.annotations.join(" ")}`
      : "";
    return `${path.typeText}.${name}(${parts.join(", ")})${suffix} -> ${fn.result.text}`;
  }

  private popAnnotations(): string[] {
    const annotations: string[] = [];
    while (this.stack[this.stack.length - 1]?.kind === "annotation") {
      const unit = this.stack.pop() as { kind: "annotation"; text: string };
      annotations.unshift(unit.text);
    }
    return annotations;
  }

  private atEndOrSuffix(): boolean {
    return this.pos >= this.text.length || this.text[this.pos] === ".";
  }

  private restore(pos: number, subs: number, words: number): void {
    this.pos = pos;
    this.subs.length = subs;
    this.words.length = words;
  }

  // ---- type operators ---------------------------------------------------

  private parseTypeOps(stopAtNames = false): string | null {
    while (this.pos < this.text.length) {
      const start = this.pos;
      const ch = this.text[this.pos];
      if (ch === ".") return ".";
      if (ch === "F" || ch === "f" || ch === "v" || ch === "r" || ch === "l") {
        return ch;
      }
      switch (ch) {
        case "_":
          this.stack.push({ kind: "marker" });
          this.pos++;
          break;
        case "y":
          this.stack.push({ kind: "empty" });
          this.pos++;
          break;
        case "t":
          this.pos++;
          if (!this.popTuple()) return null;
          break;
        case "c":
          this.pos++;
          if (!this.popFunctionType()) return null;
          break;
        case "m":
          this.pos++;
          if (!this.wrapTop("metatype")) return null;
          break;
        case "z":
          this.pos++;
          if (!this.wrapTop("inout")) return null;
          break;
        case "h":
          this.pos++;
          if (!this.wrapTop("shared")) return null;
          break;
        case "S":
          if (!this.parseStandardType()) return null;
          break;
        case "p":
          this.pos++;
          if (!this.popProtocolList()) return null;
          break;
        case "A":
          if (!this.parseSubstitution()) return null;
          break;
        case "B":
          if (!this.parseBuiltinType()) return null;
          break;
        case "q":
        case "x":
          if (!this.parseGenericParamType()) return null;
          break;
        case "G":
          this.pos++;
          if (!this.popBoundGeneric()) return null;
          break;
        case "R":
          if (!this.parseRequirement()) return null;
          break;
        case "X":
          this.pos++;
          if (!this.parseSpecialType()) return null;
          break;
        case "K":
          this.pos++;
          this.stack.push({ kind: "annotation", text: "throws" });
          break;
        case "Y":
          if (!this.parseTypeAnnotation()) return null;
          break;
        case "s":
          this.stack.push({ kind: "name", text: "Swift" });
          this.pos++;
          break;
        default:
          if (isDigit(ch)) {
            if (!this.looksLikeNominalStart()) {
              if (stopAtNames) return "";
              const identifier = this.readIdentifier();
              if (!identifier) return null;
              this.stack.push({ kind: "name", text: identifier });
              break;
            }
            if (!this.parseNominalType()) return null;
          } else {
            return null;
          }
      }
      if (this.pos === start) return null;
    }
    return "";
  }

  private popTuple(): boolean {
    if (this.stack[this.stack.length - 1]?.kind === "empty") {
      this.stack.pop();
      this.pushType({ text: "()", tuple: [] });
      return true;
    }
    const elements: SwiftType[] = [];
    let first = false;
    do {
      if (this.stack[this.stack.length - 1]?.kind === "marker") {
        this.stack.pop();
        first = true;
      }
      let label: string | null = null;
      if (this.stack[this.stack.length - 1]?.kind === "name") {
        label = (this.stack.pop() as { kind: "name"; text: string }).text;
      }
      const unit = this.stack.pop();
      if (!unit || unit.kind !== "type") return false;
      elements.push(
        label
          ? { text: `${label}: ${unit.type.text}`, tuple: unit.type.tuple }
          : unit.type,
      );
    } while (!first);
    elements.reverse();
    this.pushType({ text: tupleText(elements), tuple: elements });
    return true;
  }

  private popFunctionType(): boolean {
    const annotations = this.popAnnotations();
    const params = this.stack.pop();
    const result = this.stack.pop();
    if (!params || !result) return false;
    const resultType =
      result.kind === "empty"
        ? { text: "()", tuple: [] as SwiftType[] }
        : result.kind === "type"
          ? result.type
          : null;
    const paramsType =
      params.kind === "empty"
        ? { text: "()", tuple: [] as SwiftType[] }
        : params.kind === "type"
          ? params.type
          : null;
    if (!resultType || !paramsType) return false;
    this.pushType({
      text: functionText(paramsType, resultType, annotations),
      fn: { params: paramsType, result: resultType, annotations },
    });
    return true;
  }

  private popBoundGeneric(): boolean {
    const args: SwiftType[] = [];
    let closed = false;
    while (this.stack.length) {
      const unit = this.stack.pop()!;
      if (unit.kind === "empty") {
        closed = true;
        break;
      }
      if (unit.kind === "marker") continue;
      if (unit.kind !== "type") return false;
      args.push(unit.type);
    }
    if (!closed) return false;
    args.reverse();
    const nominal = this.popTopType();
    if (!nominal) return false;
    const bound: SwiftType = {
      text: applyGeneric(nominal, args),
      standardKind: nominal.standardKind,
    };
    this.recordType(bound);
    this.pushType(bound);
    return true;
  }

  private popProtocolList(): boolean {
    if (this.stack[this.stack.length - 1]?.kind === "empty") {
      this.stack.pop();
      this.pushType({ text: "Any" });
      return true;
    }
    const protocols: string[] = [];
    let first = false;
    do {
      if (this.stack[this.stack.length - 1]?.kind === "marker") {
        this.stack.pop();
        first = true;
      }
      const protocol = this.popProtocol();
      if (!protocol) return false;
      protocols.push(protocol);
    } while (!first);
    protocols.reverse();
    this.pushType({ text: protocols.join(" & ") });
    return true;
  }

  private popProtocol(): string | null {
    const unit = this.stack.pop();
    if (!unit) return null;
    if (unit.kind === "type") return unit.type.text;
    if (unit.kind !== "name") return null;
    const context = this.stack.pop();
    if (!context) return null;
    if (context.kind === "name") return `${context.text}.${unit.text}`;
    if (context.kind === "type") return `${context.type.text}.${unit.text}`;
    return null;
  }

  private wrapTop(kind: "metatype" | "inout" | "shared"): boolean {
    const type = this.popTopType();
    if (!type) return false;
    const text =
      kind === "metatype"
        ? `${type.text}.Type`
        : kind === "inout"
          ? `inout ${type.text}`
          : `__shared ${type.text}`;
    this.pushType({ text });
    return true;
  }

  private parseSpecialType(): boolean {
    const next = this.text[this.pos];
    if (!next) return false;
    if (next === "o" || next === "u" || next === "w") {
      const type = this.popTopType();
      if (!type) return false;
      this.pos += 1;
      const text =
        next === "u"
          ? `@unowned(unsafe) ${type.text}`
          : next === "w"
            ? `@weak ${type.text}`
            : `@unowned ${type.text}`;
      this.pushType({ text });
      return true;
    }
    if (next === "m" || next === "M") {
      this.pos += 1;
      return this.wrapTop("metatype");
    }
    if (next === "p") {
      // Existential metatype: `ypXp` is `Any.Type`.
      const type = this.popTopType();
      if (!type) return false;
      this.pos += 1;
      this.pushType({ text: `${type.text}.Type` });
      return true;
    }
    if (next === "l") {
      // `Xl` is the AnyObject existential: it consumes the empty protocol
      // list (`y`) that precedes it.
      this.pos += 1;
      if (this.stack[this.stack.length - 1]?.kind === "empty") this.stack.pop();
      this.pushType({ text: "Swift.AnyObject" });
      return true;
    }
    if (next === "O" && this.text[this.pos + 1] === "o") {
      this.pos += 2;
      return this.popFunctionType();
    }
    if (FUNCTION_KINDS.has(next)) {
      this.pos += 1;
      return this.popFunctionType();
    }
    return false;
  }

  private parseTypeAnnotation(): boolean {
    const next = this.text[this.pos + 1];
    if (next === "a") {
      this.pos += 2;
      this.stack.push({ kind: "annotation", text: "async" });
      return true;
    }
    if (next === "b") {
      this.pos += 2;
      this.stack.push({ kind: "annotation", text: "@Sendable" });
      return true;
    }
    return false;
  }

  // ---- terminals --------------------------------------------------------

  private parseStandardType(): boolean {
    const next = this.text[this.pos + 1];
    if (!next) return false;
    if (next === "o") {
      this.pos += 2;
      this.stack.push({ kind: "name", text: "__C" });
      return true;
    }
    if (next === "C") {
      this.pos += 2;
      this.stack.push({ kind: "name", text: "ClangImporter" });
      return true;
    }
    if (next === "g") {
      this.pos += 2;
      const type = this.popTopType();
      if (!type) return false;
      const optional: SwiftType = {
        text: type.fn ? `(${type.text})?` : `${type.text}?`,
      };
      this.recordType(optional);
      this.pushType(optional);
      return true;
    }

    let cursor = this.pos + 1;
    let repeat = 1;
    if (isDigit(this.text[cursor])) {
      let digits = "";
      while (isDigit(this.text[cursor])) {
        digits += this.text[cursor];
        cursor++;
      }
      repeat = Math.min(Number(digits) || 1, MAX_REPEAT);
    }
    let secondLevel = false;
    if (
      this.text[cursor] === "c" &&
      SWIFT_STDLIB_2[this.text[cursor + 1]] !== undefined
    ) {
      secondLevel = true;
      cursor++;
    }
    const kind = this.text[cursor];
    const name = (secondLevel ? SWIFT_STDLIB_2 : SWIFT_STDLIB)[kind];
    if (!name) return false;
    this.pos = cursor + 1;

    const standardKind =
      kind === "a"
        ? ("array" as const)
        : kind === "D"
          ? ("dictionary" as const)
          : kind === "h"
            ? ("set" as const)
            : kind === "q"
              ? ("optional" as const)
              : undefined;
    for (let index = 0; index < repeat; index++) {
      this.pushType({ text: name, standardKind });
    }
    return true;
  }

  private parseSubstitution(): boolean {
    if (this.text[this.pos] !== "A") return false;
    this.pos += 1;
    let repeat = 1;
    let number = -1;
    while (true) {
      const ch = this.text[this.pos];
      if (ch === undefined) return false;
      if (isLowerLetter(ch)) {
        this.pos += 1;
        if (!this.pushSubstitution(ch.charCodeAt(0) - 97, repeat)) return false;
        repeat = 1;
        number = -1;
        continue;
      }
      if (isUpperLetter(ch)) {
        this.pos += 1;
        return this.pushSubstitution(ch.charCodeAt(0) - 65, repeat);
      }
      if (ch === "_") {
        this.pos += 1;
        const entry = this.subs[number + 27];
        if (!entry) return false;
        this.pushEntry(entry);
        return true;
      }
      if (ch >= "1" && ch <= "9") {
        let digits = "";
        while (isDigit(this.text[this.pos])) {
          digits += this.text[this.pos];
          this.pos++;
        }
        number = Number(digits);
        repeat = Math.min(number, MAX_REPEAT);
        continue;
      }
      return false;
    }
  }

  private pushSubstitution(index: number, repeat: number): boolean {
    const entry = this.subs[index];
    if (!entry) return false;
    for (let count = 0; count < Math.min(repeat, MAX_REPEAT); count++) {
      this.pushEntry(entry);
    }
    return true;
  }

  private pushEntry(entry: SubEntry): void {
    if (entry.kind === "name") {
      this.stack.push({ kind: "name", text: entry.text });
    } else {
      this.pushType(entry.type);
    }
  }

  private parseBuiltinType(): boolean {
    const start = this.pos;
    const rest = this.text.slice(this.pos);
    if (rest.startsWith("Bi") || rest.startsWith("Bf")) {
      const kind = rest[1] === "i" ? "Int" : "Float";
      this.pos += 2;
      let digits = "";
      while (isDigit(this.text[this.pos])) {
        digits += this.text[this.pos];
        this.pos++;
      }
      if (!digits || this.text[this.pos] !== "_") {
        this.pos = start;
        return false;
      }
      this.pos++;
      this.pushType({ text: `Builtin.${kind}${digits}` });
      return true;
    }
    if (rest.startsWith("BV")) {
      this.pos += 2;
      this.pushType({ text: "Builtin.FixedArray" });
      return true;
    }
    const pair = rest.slice(0, 2);
    const name = BUILTIN_TYPES[pair[1]];
    if (!name) return false;
    this.pos += 2;
    this.pushType({ text: name });
    return true;
  }

  private parseGenericParamType(): boolean {
    if (this.text[this.pos] === "x") {
      this.pos++;
      this.pushType({ text: genericParamName(0, 0) });
      return true;
    }
    if (this.text[this.pos] !== "q") return false;
    this.pos++;
    const index = this.readGenericParamIndex();
    if (!index) return false;
    this.pushType({ text: index.name });
    return true;
  }

  private readGenericParamIndex(): { name: string; depth: number; index: number } | null {
    if (this.text[this.pos] === "d") {
      this.pos++;
      const depth = this.readIndex() + 1;
      const index = this.readIndex();
      if (depth < 1 || index < 0) return null;
      return { name: genericParamName(depth, index), depth, index };
    }
    if (this.text[this.pos] === "z") {
      this.pos++;
      return { name: genericParamName(0, 0), depth: 0, index: 0 };
    }
    if (this.text[this.pos] === "s") {
      this.pos++;
      return { name: "Self", depth: 0, index: 0 };
    }
    const index = this.readIndex() + 1;
    if (index < 1) return null;
    return { name: genericParamName(0, index), depth: 0, index };
  }

  private readIndex(): number {
    if (this.text[this.pos] === "_") {
      this.pos++;
      return 0;
    }
    let digits = "";
    while (isDigit(this.text[this.pos])) {
      digits += this.text[this.pos];
      this.pos++;
    }
    if (!digits || this.text[this.pos] !== "_") return -1;
    this.pos++;
    return Number(digits) + 1;
  }

  // ---- nominal types ----------------------------------------------------

  private hasNominalMarker(): boolean {
    if (this.text.startsWith("XY", this.pos)) return true;
    return NOMINAL_MARKERS.has(this.text[this.pos]);
  }

  private readNominalMarker(): string {
    if (this.text.startsWith("XY", this.pos)) {
      this.pos += 2;
      return "XY";
    }
    const marker = this.text[this.pos];
    this.pos++;
    return marker;
  }

  private looksLikeNominalStart(): boolean {
    const first = this.decodeIdentifierAt(this.pos, false);
    if (!first) return false;
    if (
      this.text.startsWith("XY", first.next) ||
      NOMINAL_MARKERS.has(this.text[first.next])
    ) {
      return true;
    }
    if (isDigit(this.text[first.next])) {
      const second = this.decodeIdentifierAt(first.next, false);
      if (
        second &&
        (this.text.startsWith("XY", second.next) ||
          NOMINAL_MARKERS.has(this.text[second.next]))
      ) {
        return true;
      }
    }
    return false;
  }

  private parseNominalType(): boolean {
    if (!isDigit(this.text[this.pos])) return false;
    const first = this.readIdentifier();
    if (!first) return false;

    let context: string;
    let name: string;
    if (this.hasNominalMarker()) {
      const unit = this.stack.pop();
      if (!unit || (unit.kind !== "name" && unit.kind !== "type")) {
        return false;
      }
      context = unit.kind === "name" ? unit.text : unit.type.text;
      name = first;
    } else if (isDigit(this.text[this.pos])) {
      context = first;
      const second = this.readIdentifier();
      if (!second) return false;
      name = second;
    } else {
      return false;
    }

    let text = `${context}.${name}`;
    while (true) {
      if (!this.hasNominalMarker()) return false;
      this.readNominalMarker();
      const type: SwiftType = { text };
      this.recordType(type);

      if (isDigit(this.text[this.pos])) {
        const savePos = this.pos;
        const saveSubs = this.subs.length;
        const saveWords = this.words.length;
        const nested = this.readIdentifier();
        if (nested && this.hasNominalMarker()) {
          text = `${text}.${nested}`;
          continue;
        }
        this.pos = savePos;
        this.subs.length = saveSubs;
        this.words.length = saveWords;
      }
      this.pushType(type);
      return true;
    }
  }

  // ---- generics ---------------------------------------------------------

  private parseRequirement(): boolean {
    if (this.text[this.pos] !== "R") return false;
    const marker = this.text[this.pos + 1];

    if (marker === "s" || marker === "S") {
      const target = this.popTopType();
      if (!target) return false;
      this.pos += 2;
      const subject = this.readGenericParamIndex();
      if (!subject) return false;
      this.stack.push({
        kind: "requirement",
        text: `${subject.name} == ${target.text}`,
      });
      return true;
    }

    if (marker === "b" || marker === "B") {
      const target = this.popTopType();
      if (!target) return false;
      this.pos += 2;
      const subject = this.readGenericParamIndex();
      if (!subject) return false;
      this.stack.push({
        kind: "requirement",
        text: `${subject.name}: ${target.text}`,
      });
      return true;
    }

    if (marker === "l" || marker === "L") {
      const target = this.popTopType();
      if (!target) return false;
      this.pos += 2;
      const subject = this.readGenericParamIndex();
      if (!subject) return false;
      const layout = this.text[this.pos];
      this.pos++;
      const layoutName =
        layout === "C" || layout === "D" || layout === "N" || layout === "R"
          ? "AnyObject"
          : "Any";
      this.stack.push({
        kind: "requirement",
        text: `${subject.name}: ${layoutName}`,
      });
      return true;
    }

    const protocol = this.popTopType();
    if (!protocol) return false;
    this.pos += 1;
    const subject = this.readGenericParamIndex();
    if (!subject) return false;
    this.stack.push({
      kind: "requirement",
      text: `${subject.name}: ${protocol.text}`,
    });
    return true;
  }

  private parseGenericSignature(): {
    counts: number[];
    requirements: string[];
  } | null {
    const requirements: string[] = [];
    while (this.stack[this.stack.length - 1]?.kind === "requirement") {
      const unit = this.stack.pop() as { kind: "requirement"; text: string };
      requirements.push(unit.text);
    }
    requirements.reverse();

    if (this.text[this.pos] === "l") {
      this.pos++;
      return { counts: [1], requirements };
    }
    if (this.text[this.pos] !== "r") return null;
    this.pos++;

    const counts: number[] = [];
    let guard = 0;
    while (this.text[this.pos] !== "l") {
      if (this.text[this.pos] === undefined || guard++ > MAX_GENERIC_COUNT) {
        return null;
      }
      if (this.text[this.pos] === "z") {
        this.pos++;
        counts.push(0);
        continue;
      }
      const index = this.readIndex();
      if (index < 0) return null;
      counts.push(index + 1);
    }
    this.pos++;
    return { counts, requirements };
  }

  // ---- helpers ----------------------------------------------------------

  private readIdentifier(): string | null {
    const identifier = this.decodeIdentifierAt(this.pos, true);
    if (!identifier) return null;
    this.pos = identifier.next;
    this.subs.push({ kind: "name", text: identifier.value });
    return identifier.value;
  }

  private decodeIdentifierAt(
    start: number,
    recordWords: boolean,
  ): { value: string; next: number } | null {
    let cursor = start;
    if (!isDigit(this.text[cursor])) return null;
    let wordSubstitutions = false;
    if (this.text[cursor] === "0") {
      cursor++;
      if (this.text[cursor] === "0") return null;
      wordSubstitutions = true;
    }

    let value = "";
    while (true) {
      while (
        wordSubstitutions &&
        (isLowerLetter(this.text[cursor]) || isUpperLetter(this.text[cursor]))
      ) {
        const ch = this.text[cursor];
        cursor++;
        const lower = isLowerLetter(ch);
        const index = lower
          ? ch.charCodeAt(0) - 97
          : ch.charCodeAt(0) - 65;
        if (!lower) wordSubstitutions = false;
        const word = this.words[index];
        if (word === undefined) return null;
        value += word;
      }
      if (this.text[cursor] === "0") {
        cursor++;
        break;
      }
      let digits = "";
      while (isDigit(this.text[cursor])) {
        digits += this.text[cursor];
        cursor++;
      }
      const length = Number(digits);
      if (!digits || !Number.isFinite(length) || length <= 0) return null;
      if (cursor + length > this.text.length) return null;
      const chunk = this.text.slice(cursor, cursor + length);
      cursor += length;
      value += chunk;
      if (recordWords) this.recordWords(chunk);
      if (!wordSubstitutions) break;
    }
    return value ? { value, next: cursor } : null;
  }

  private recordWords(chunk: string): void {
    let wordStart = -1;
    for (let index = 0; index <= chunk.length; index++) {
      const ch = index < chunk.length ? chunk[index] : "\0";
      const previous = index > 0 ? chunk[index - 1] : "";
      if (wordStart >= 0 && isWordEnd(ch, previous)) {
        if (index - wordStart >= 2 && this.words.length < 26) {
          this.words.push(chunk.slice(wordStart, index));
        }
        wordStart = -1;
      }
      if (wordStart < 0 && isWordStart(ch)) wordStart = index;
    }
  }

  private recordType(type: SwiftType): void {
    this.subs.push({ kind: "type", type });
  }

  private pushType(type: SwiftType): void {
    this.stack.push({ kind: "type", type });
  }

  private popTopType(): SwiftType | null {
    const unit = this.stack.pop();
    if (!unit || unit.kind !== "type") return null;
    return unit.type;
  }
}

function demangleProtocolWitness(text: string): string | null {
  const marker = text.lastIndexOf("P");
  if (marker >= 0 && isDigit(text[marker + 1])) {
    const member = scanIdentifier(text, marker + 1);
    const type = parseTypePathSimple(text);
    if (member && type) {
      return `protocol witness for ${type}.${member.value}`;
    }
  }
  const type = parseTypePathSimple(text);
  return type ? `protocol witness for ${type}` : null;
}

function parseTypePathSimple(text: string): string | null {
  const first = scanIdentifier(text, 0);
  if (!first) return null;
  const path = [first.value === "s" ? "Swift" : first.value];
  let cursor = first.next;
  while (cursor < text.length && isDigit(text[cursor])) {
    const identifier = scanIdentifier(text, cursor);
    if (!identifier) break;
    const marker = text[identifier.next];
    if (
      marker === "V" ||
      marker === "C" ||
      marker === "O" ||
      marker === "P" ||
      marker === "a"
    ) {
      path.push(identifier.value);
      cursor = identifier.next + 1;
      continue;
    }
    break;
  }
  if (path.length < 2) return null;
  return path.join(".");
}

function demangleSwift5(text: string): string | null {
  if (text.endsWith("TW")) {
    const witness = demangleProtocolWitness(text.slice(0, -2));
    if (witness) return witness;
  }

  for (const thunk of THUNKS) {
    if (text.endsWith(thunk.suffix)) {
      const base = demangleSwift5(text.slice(0, -thunk.suffix.length));
      if (base) return `${thunk.prefix}${base}`;
    }
  }

  const parser = new SwiftDemangler(text);
  const path = parser.parsePath() ?? parser.parseTypeContext();
  if (!path) return null;
  if (!parser.remaining) return path.typeText;

  const entity = parser.parseEntity(path);
  if (entity) return entity;
  const fallback = parser.fallbackName;
  return fallback ? `${path.typeText}.${fallback}` : path.typeText;
}

export function demangleSwift(raw: string): string | null {
  let name = raw;
  if (name.startsWith("_$s") || name.startsWith("_$S")) name = name.slice(1);
  if (name.startsWith("$s") || name.startsWith("$S")) {
    return demangleSwift5(name.slice(2));
  }
  if (name.startsWith("_Tt")) return demangleOldSwift(name);
  return null;
}

function demangleOldSwift(raw: string): string | null {
  const match = /^_Tt([CVOP])(.*)$/.exec(raw);
  if (!match) return null;
  const first = scanIdentifier(match[2], 0);
  if (!first) return null;
  const path = [first.value === "s" ? "Swift" : first.value];
  let cursor = first.next;
  while (cursor < match[2].length) {
    const identifier = scanIdentifier(match[2], cursor);
    if (!identifier) break;
    path.push(identifier.value);
    cursor = identifier.next;
  }
  return path.join(".");
}

export function demangleObjCClass(raw: string): string {
  let value = raw.trim();
  if (!value) return "";
  if (value.startsWith("__Tt")) value = value.slice(1);
  if (value.startsWith("_Tt")) {
    return demangleOldSwift(value) ?? value.replace(/^_Tt[CVOP]/, "");
  }
  return value.replace(/^_/, "");
}

export function recoverObjCClassName(raw: string): string {
  return demangleObjCClass(raw.replace(/^_OBJC_CLASS_\$_/, ""));
}

export interface ObjectiveCResult {
  demangled: string;
  info: ObjectiveCName;
}

export function recoverObjectiveC(raw: string): ObjectiveCResult | null {
  const method = /^([+-])\[([^\s\]]+)\s+([^\]]+)\]$/.exec(raw);
  if (method) {
    const className = demangleObjCClass(method[2]);
    const selector = method[3];
    return {
      demangled: `${method[1]}[${className} ${selector}]`,
      info: {
        kind: "method",
        className,
        selector,
        classMethod: method[1] === "+",
      },
    };
  }

  const typed = /^_OBJC_(CLASS|METACLASS|PROTOCOL|EHTYPE)_\$(.+)$/.exec(raw);
  if (typed) {
    const rawName = typed[2];
    const className = demangleObjCClass(rawName);
    const kind =
      typed[1] === "PROTOCOL"
        ? "protocol"
        : typed[1] === "METACLASS"
          ? "metaclass"
          : "class";
    return {
      demangled:
        kind === "protocol"
          ? `protocol ${className}`
          : kind === "metaclass"
            ? `metaclass ${className}`
            : className,
      info: { kind, className },
    };
  }

  const ivar = /^_OBJC_IVAR_\$_(.+)\.([^.]+)$/.exec(raw);
  if (ivar) {
    const className = demangleObjCClass(ivar[1]);
    return {
      demangled: `${className}.${ivar[2]}`,
      info: { kind: "ivar", className, ivar: ivar[2] },
    };
  }

  const classString = /^__objc_class_name_(.+)$/.exec(raw);
  if (classString) {
    const className = demangleObjCClass(classString[1]);
    return { demangled: className, info: { kind: "class", className } };
  }

  return null;
}

export function demangleSymbol(raw: string): DemangledSymbol {
  const objectiveC = recoverObjectiveC(raw);
  if (objectiveC) {
    return {
      demangled: objectiveC.demangled,
      language: "objc",
      objectiveC: objectiveC.info,
    };
  }
  const swift = demangleSwift(raw);
  if (swift) return { demangled: swift, language: "swift" };
  if (raw.startsWith("_Z") || raw.startsWith("__Z")) return { language: "c++" };
  return { language: "unknown" };
}
