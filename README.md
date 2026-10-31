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

**EVOLVE** hill-climbs a reconstruction of the same file and shows it improve. The original and the current best sit side by side, and a chart plots every candidate against the retained score. **EXPORT PNG / TXT / BIN** downloads that reconstruction. **SAVE .CLONE** writes the run so it can be dropped back in later.

| Export | File |
| --- | --- |
| Image reconstruction | `<name>-clone.png` |
| Text reconstruction | `<name>-clone.txt` |
| Binary reconstruction | `<name>-clone.bin` |
| Audio reconstruction | `<name>-clone.wav` |
| PDF reconstruction | `<name>-clone.pdf` |
| Spreadsheet reconstruction | `<name>-clone.csv` |
| Evolution session | `<name>.clone` |

WAV and MP3 are read as audio. PCM WAV is parsed directly. MP3 and other compressed audio use Web Audio `decodeAudioData` when the browser can decode them. PDF text is taken from page operators, including FlateDecode streams. CSV, TSV, and xlsx sheets become a table. The evolve view draws a waveform and spectrum, the extracted page text, or the table beside its reconstruction.

**POPULATION** searches several genomes at once: each generation keeps the elite, crosses two selected parents, and mutates the child. The chart's upper line is the elite and the lower line is the population mean. **HILL** is the original one-genome climb. A `.clone` session records the mode and, for a population run, the current members. Version 1 readers that do not know those fields still open the elite genome.

### `.clone` sessions

A `.clone` file is the evolution session, not the reconstruction. The Mac app registers it as `io.freebuff.mitosis.clone` (`application/x-mitosis-clone`). Version 1 is little-endian:

| Offset | Field |
| --- | --- |
| 0 | 8-byte magic `MTSCLONE` |
| 8 | `uint16` format version (`1`) |
| 10 | `uint16` flags (`0`) |
| 12 | `uint32` UTF-8 JSON header length |
| 16 | JSON header |
| 16+N | original specimen bytes |

The header holds the format id, version, timestamp, specimen name, MIME type, and size, plus the seed genome, current genome, baseline, score, attempt counts, and score history. The specimen bytes are the payload. `specimen.size` must match that payload. Readers ignore unknown JSON keys. A different version, or any flags value other than `0`, means the payload layout changed and is rejected.

Opening a `.clone` file dissects the embedded specimen and restores the chart, so **RESUME** continues the same run.

Swift symbols are rendered with full signatures — parameter labels and types, return type, generics and requirements, tuples, optionals, existentials, extensions, and `async`/`throws` — for example `MITOSIS.DropWebView.performDragOperation(ObjectiveC.NSDraggingInfo) -> Swift.Bool`. Objective-C classes, protocols, methods, ivars, and selectors are recovered alongside.

## Reusing the engine

**ENGINE KIT .ZIP** in the header downloads `mitosis-engine-kit.zip`: the real TypeScript sources for dissection, Mach-O reports with Swift/Objective-C name recovery, the image/text/binary cloners, exact-copy helpers, and the memory loop, plus a manifest, usage README, and integration example. The kit has no runtime dependencies; it expects browser APIs such as `File`, `Blob`, Canvas 2D, `crypto.subtle`, and `localStorage`.

## Releasing

```bash
npm run release:prepare -- patch --commit --push   # cut v0.1.2 and publish it
```

That one command takes the version from `patch`, `minor`, `major`, or an explicit `X.Y.Z`, writes it everywhere it appears — `package.json`, both lockfile fields, and `CFBundleShortVersionString` plus the incremented `CFBundleVersion` in `desktop/Info.plist` — proves the files agree with the same check CI runs, then commits them, tags `v<version>`, and pushes both. The tag push builds the app, smoke-tests it, and publishes the release with its checksum.

Stop earlier by leaving off the later flags:

```bash
npm run release:prepare -- minor             # rewrite the files only
npm run release:prepare -- 0.2.0 --commit    # commit and tag, push later
```

`--commit` refuses to run on a dirty working tree so the bump stays a commit of its own, refuses a detached HEAD, and refuses a version that is already current or whose tag exists. The release workflow re-checks that the tag matches the files before it builds, so a mistagged release stops early instead of publishing an app that reports a different version.

## Where stage 3 fits

Stage 2 adds audio, PDF, and spreadsheet cloners, plus a population search that sits beside the hill climb. The session is still one embedded specimen.

Stage 3 is memory seeding, sync, and batch mode. It needs:

- **Seeding from past runs.** `recallMemories` already ranks saved genomes. The lab should offer those as the `seed` argument to `startEvolution` and `startPopulation`, then call `recordRun` when a run pauses. No format change.
- **File and cloud sync.** The `.clone` bytes are the sync payload. A copy that points at an external specimen, instead of embedding it, needs a non-zero flags word and a new version. Version 1 readers reject that on purpose. Cloud sync is a transport for the same file, not a second format.
- **Batch and folders.** One `.clone` per specimen. A folder run is a queue of files plus a directory of sessions. The UI needs a multi-file picker and a list of runs. `advancePopulation` and `advanceEvolution` stay the per-file step.

Later still: an AI note can be an extra header key such as `note`, which version 1 readers ignore. A CLI calls `encodeCloneSession`, `decodeCloneSession`, and `exportReconstruction`. Signing stays in the release workflow.

## Honest limits

- This is static structural analysis, not decompilation. No external reverse-engineering engine is invoked; Ghidra and REA are design lineage, not runtime dependencies.
- Swift demangling covers common declarations, generics, protocol requirements, function types, and existentials, not the entire Swift grammar: closure and partial-apply wrappers, function-signature specializations, and file-local discriminators are reported under their base declaration. C++ names are identified but not demangled.
- Dissection reads a bounded sample (8 MB) and the fingerprint covers that sample, not necessarily the whole file. Deep Mach-O reports read up to 64 MB and cap at 20,000 symbols and 5,000 strings; bundles keep at most 4,000 strings.
- Extracted features describe what the file shows. Verify anything before building on it.
- Exported PNG, text, and binary files are statistical reconstructions. **SAVE .CLONE** stores the run; **File → Duplicate Original** and `saveExact` copy the source bytes.

## Layout

```
src/engine/     dissection, Mach-O reports, feature extraction, clone engines, evolution, .clone sessions, memory
src/features/   feature bundle, ZIP writer, engine-kit export
src/components/ drop zone, feature sheet, evolution lab, score chart
src/App.tsx     drop → features, or evolve and export
src/samples.ts  built-in image, text, binary, audio, PDF, and spreadsheet specimens
desktop/        native macOS shell, Info.plist, icon generator
scripts/        desktop build, inlining, smoke probe and assertions, version check and release prep
```
