# MITOSIS

[![CI](https://github.com/jackjjack1/mitosis/actions/workflows/ci.yml/badge.svg)](https://github.com/jackjjack1/mitosis/actions/workflows/ci.yml)

A local, self-improving artifact cloning lab. Drop a file; it dissects the surface, synthesizes a reconstruction, scores the match, and mutates its own cloning genome until the copy improves. Successful mutations are retained in browser memory and seed the next artifact of the same class.

## Run

```bash
npm install
npm run dev
```

Open the printed local URL. Everything runs in the browser; no file is uploaded anywhere.

```bash
npm run build
```

## Desktop app (macOS)

```bash
npm run desktop:build
```

This compiles the web app, inlines it into a single offline document, builds a native WebKit shell with its own icon, ad-hoc signs it, and installs **`MITOSIS.app`** to your Desktop. Open it with a double-click — no dev server or network connection is required. Add a specimen by dropping a file or app bundle on the window, choosing **File → Open Specimen… (⌘O)**, or clicking the drop plate. App bundles are analyzed through their primary executable; plain folders need to be compressed to a ZIP first. The cloning memory is stored in the app's WebKit profile and is separate from the browser version.

The wrapper lives in `desktop/` (Swift + `Info.plist` + icon generator). `scripts/build-desktop.sh` assembles and signs the bundle; `scripts/inline-build.mjs` does the single-file inlining required for file loading. The app is ad-hoc signed for local use, not notarized for distribution.

### Download a CI build

Every successful CI run publishes a **`MITOSIS-macos-bundle`** artifact for 7 days. It contains `MITOSIS-macos.zip` (the app) and `MITOSIS-macos.zip.sha256` (its checksum).

Open the latest successful run from the CI badge and download the bundle from **Artifacts**, or use `gh`:

```bash
gh run download --repo jackjjack1/mitosis --name MITOSIS-macos-bundle
shasum -a 256 -c MITOSIS-macos.zip.sha256
unzip MITOSIS-macos.zip
open MITOSIS.app
```

The downloaded artifact is `MITOSIS-macos-bundle.zip`; `gh run download` extracts it for you. The checksum inside covers the inner `MITOSIS-macos.zip`. To pin a specific run, pass its ID before `--name`. A passing checksum confirms an intact download, not publisher identity: the app is ad-hoc signed and not notarized, so macOS may still warn on first launch.

## What it clones

| Class | Dissection | Reconstruction | Score |
| --- | --- | --- | --- |
| Image | dimensions, alpha, dominant colors, byte entropy | median-cut palette, resolution scaling, smoothing, gamma | pixel match (incl. alpha) |
| Text / code | lines, words, vocabulary, tokens | Markov style replica over whitespace, words, and punctuation | trigram overlap, token distribution, novelty, length |
| Binary | magic, 64-hex SHA-256 of the analyzed head, entropy blocks, printable strings, ELF/PE/Mach-O headers and section tables | byte-level context model, global histogram blend, copied header prefix | histogram mass, entropy shape, shared 4-grams |

Every generation is a real candidate: the engine mutates a strategy genome (e.g. palette size, context order, entropy blend), rebuilds the clone, and keeps the mutation only if the measured score improves.

### True clone

**TRUE CLONE** saves the exact original instead of the reconstruction. In the desktop app, an app bundle is copied as a whole bundle with its structure and metadata, not reduced to its executable. The same action is available as **File → Duplicate Original… (⌘D)**, including for folders and files above the 32 MB dissection limit.

### Deep Mach-O analysis

Dropping a macOS `.app` analyzes its primary executable. The **DEEP ANALYSIS** panel adds a Ghidra-style static report: universal/thin architectures, load-command metadata, segments, section-level entropy and sizes, `LC_SYMTAB` symbols, linked libraries, rpaths, code-signature/function-start metadata, and section-scoped printable strings. Symbols are reported with both the raw name and a recovered readable name: Swift mangled names are decoded on a best-effort basis, and Objective-C classes, protocols, methods, ivars, and selectors are collected from symbols and `__objc_*` metadata strings. Swift functions, methods, initializers, and accessors are rendered with their full signature — parameter labels and types, return type, generic parameters and requirements, function types, tuples with element labels, optionals, `inout`/`__shared` conventions, protocol existentials, and `async`/`throws` — for example `MITOSIS.DropWebView.performDragOperation(ObjectiveC.NSDraggingInfo) -> Swift.Bool`. It can export the complete evidence as **JSON**, or a readable **Markdown** report with an Objective-C section and a demangled symbol table.

This is a local static parser, not a bundled Ghidra runtime. It does not decompile code or reconstruct source; it gives you the structural evidence a reverse-engineering session starts from.

### Reusing the engine

**SAVE ENGINE KIT** in the Feature Export card downloads `mitosis-engine-kit.zip`. It contains the real TypeScript sources for dissection, the image/text/binary cloners, Mach-O symbol reports with Swift/Objective-C name recovery, exact-copy helpers, and the memory loop, plus a manifest, usage README, and integration example. The kit has no runtime dependencies; it expects browser APIs such as `File`, `Blob`, Canvas 2D, `crypto.subtle`, and `localStorage`. Binary dissection includes ELF, PE, and thin/fat Mach-O headers and section tables. The hash is the full 32-byte digest of the bytes actually analyzed. `saveExact` downloads an original file byte-for-byte; directories and app bundles still need the native copy path.

## The learning loop

- **DISSECT** — evidence-first analysis, inspired by the workflows of [REA](https://github.com/morluto/rea) and [Ghidra](https://github.com/NationalSecurityAgency/ghidra).
- **RECALL** — prior runs for the same artifact class are compared; candidate genomes are scored against the current file, and the strongest becomes the starting point. This is a local retain/recall/reflect loop in the spirit of [Hindsight](https://github.com/vectorize-io/hindsight).
- **EVOLVE** — hill-climbing selection with occasional larger jumps. `AUTO` keeps exploring while the page is visible. `EVOLVE +40` runs another batch.
- **REFLECT** — every artifact creates a memory entry (localStorage) with its winning genome, score, baseline, and accepted-mutation count. Best-known genomes are shown in the rail and reused next time.

Use **RESET MIND** to clear local memory and the current run.

## Honest limits

- **DOWNLOAD CLONE** is a reconstruction, not a byte-identical copy. Text clones preserve texture and cadence, not wording; binary clones preserve statistics and headers, not executable behavior.
- **TRUE CLONE** duplicates the original file or app bundle exactly; it is separate from the lab's statistical output.
- Binary reconstructions download with a `.clone` extension and a `MITOSIS Clone` document type because macOS treats `.bin` as a MacBinary archive. They are not runnable executables or valid archives.
- No external reverse-engineering engine is invoked. Ghidra/REA are design lineage, not runtime dependencies. The Mach-O analyzer parses headers, segments, sections, `LC_SYMTAB`, libraries, and strings; it does not disassemble, decompile, recover source, or reconstruct a control-flow graph. Swift demangling covers properties, methods, initializers, full parameter/return signatures, generics, protocol requirements, function types, existentials, and common thunk/witness forms, not the entire Swift grammar: compiler-generated partial-apply and closure wrappers, function-signature specialization suffixes, and file-local discriminators are reported under their base declaration; C++ names are identified but not demangled. ELF/PE dissection remains limited to basic headers and section tables.
- The statistical loop is capped (8 MB read, 720 px image scoring sample, 16K text chars, 96 KB binary sample) to keep it interactive. The 64-character SHA-256 covers the first 8 MB, not necessarily the whole file; `saveExact` is the full-file path. Deep Mach-O reports read up to 64 MB and cap at 20,000 symbols and 5,000 strings; Markdown shows at most 2,500 symbols, 1,500 strings, and 250 Objective-C names per category while JSON keeps the full set.
- Memory lives only in this browser profile.

## Layout

```
src/engine/     dissection, clone engines, Mach-O reports, scoring, memory
src/features/   reusable engine-kit export
src/components/ stage, preview, analysis, sidebar, header, empty state
src/App.tsx     ingestion, evolution orchestration, persistence
src/samples.ts  built-in image, text, and binary specimens
desktop/        native macOS shell, Info.plist, icon generator
scripts/        desktop build, inlining, WebKit smoke probe
```
