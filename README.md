# MITOSIS

[![CI](https://github.com/jackjjack1/mitosis/actions/workflows/ci.yml/badge.svg)](https://github.com/jackjjack1/mitosis/actions/workflows/ci.yml)

Drop a file. Get usable features back. MITOSIS reads the artifact — image, text, binary, or a macOS app — and hands you the parts worth reusing as plain CSS, JSON, Markdown, and text files. Everything runs locally; nothing is uploaded.

## Run

```bash
npm install
npm run dev
```

Open the printed local URL. Drop a file on the window, or click the plate to browse.

```bash
npm run build
```

## Desktop app (macOS)

```bash
npm run desktop:build
```

This compiles the web app, inlines it into a single offline document, builds a native WebKit shell with its own icon, ad-hoc signs it, and installs **`MITOSIS.app`** to your Desktop. Open it with a double-click — no dev server or network connection is required. Drop a file or app bundle on the window, or use **File → Open Specimen… (⌘O)**. App bundles are read through their primary executable.

### Download a CI build

Every successful CI run publishes a **`MITOSIS-macos-bundle`** artifact for 7 days. It contains `MITOSIS-macos.zip` (the app) and `MITOSIS-macos.zip.sha256` (its checksum).

```bash
gh run download --repo jackjjack1/mitosis --name MITOSIS-macos-bundle
shasum -a 256 -c MITOSIS-macos.zip.sha256
unzip MITOSIS-macos.zip
open MITOSIS.app
```

The checksum confirms an intact download, not publisher identity: the app is ad-hoc signed and not notarized, so macOS may still warn on first launch.

## What comes out

| Artifact | Features | Files |
| --- | --- | --- |
| Image | palette as CSS variables with readable text tones, geometry and aspect ratio | `palette.css`, `palette.json`, `geometry.json` |
| Text / code | voice profile, ranked keywords, prompt-ready style brief | `voice.json`, `keywords.txt`, `vocabulary.txt`, `style-brief.md` |
| Binary | parsed headers and sections, printable strings, fingerprint | `structure.md`, `strings.txt`, `fingerprint.json` |
| macOS executable | recovered Swift/Objective-C API surface, dependencies, segments and sections, strings, full symbol table | `api.md`, `objective-c.md`, `dependencies.txt`, `structure.md`, `strings.txt`, `symbols.json` |

Every result also includes `artifact.json`, `features.json`, and a `README.md` describing what was extracted. **COPY** puts a single block on the clipboard; **DOWNLOAD FEATURES** saves the whole set as `<name>-features.zip`.

Swift symbols are rendered with full signatures — parameter labels and types, return type, generics and requirements, tuples, optionals, existentials, extensions, and `async`/`throws` — for example `MITOSIS.DropWebView.performDragOperation(ObjectiveC.NSDraggingInfo) -> Swift.Bool`. Objective-C classes, protocols, methods, ivars, and selectors are recovered alongside.

## Reusing the engine

**ENGINE KIT .ZIP** in the header downloads `mitosis-engine-kit.zip`: the real TypeScript sources for dissection, Mach-O reports with Swift/Objective-C name recovery, the image/text/binary cloners, exact-copy helpers, and the memory loop, plus a manifest, usage README, and integration example. The kit has no runtime dependencies; it expects browser APIs such as `File`, `Blob`, Canvas 2D, `crypto.subtle`, and `localStorage`.

## Honest limits

- This is static structural analysis, not decompilation. No external reverse-engineering engine is invoked; Ghidra and REA are design lineage, not runtime dependencies.
- Swift demangling covers common declarations, generics, protocol requirements, function types, and existentials, not the entire Swift grammar: closure and partial-apply wrappers, function-signature specializations, and file-local discriminators are reported under their base declaration. C++ names are identified but not demangled.
- Dissection reads a bounded sample (8 MB) and the fingerprint covers that sample, not necessarily the whole file. Deep Mach-O reports read up to 64 MB and cap at 20,000 symbols and 5,000 strings; bundles keep at most 4,000 strings.
- Extracted features describe what the file shows. Verify anything before building on it.

## Layout

```
src/engine/     dissection, Mach-O reports, feature extraction, clone engines, memory
src/features/   feature bundle, ZIP writer, engine-kit export
src/components/ drop zone, feature sheet
src/App.tsx     one flow: drop → features
src/samples.ts  built-in image, text, and binary specimens
desktop/        native macOS shell, Info.plist, icon generator
scripts/        desktop build, inlining, smoke probe and assertions, version check
```
