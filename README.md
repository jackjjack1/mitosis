# MITOSIS

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

This compiles the web app, inlines it into a single offline document, builds a native WebKit shell with its own icon, ad-hoc signs it, and installs **`MITOSIS.app`** to your Desktop. Open it with a double-click — no dev server or network connection is required. The cloning memory is stored in the app's WebKit profile and is separate from the browser version.

The wrapper lives in `desktop/` (Swift + `Info.plist` + icon generator). `scripts/build-desktop.sh` assembles and signs the bundle; `scripts/inline-build.mjs` does the single-file inlining required for file loading. The app is ad-hoc signed for local use, not notarized for distribution.

## What it clones

| Class | Dissection | Reconstruction | Score |
| --- | --- | --- | --- |
| Image | dimensions, alpha, dominant colors, byte entropy | median-cut palette, resolution scaling, smoothing, gamma | pixel match (incl. alpha) |
| Text / code | lines, words, vocabulary, tokens | Markov style replica over whitespace, words, and punctuation | trigram overlap, token distribution, novelty, length |
| Binary | magic, SHA-256 fingerprint, entropy blocks, printable strings, ELF/PE headers and section tables | byte-level context model, global histogram blend, copied header prefix | histogram mass, entropy shape, shared 4-grams |

Every generation is a real candidate: the engine mutates a strategy genome (e.g. palette size, context order, entropy blend), rebuilds the clone, and keeps the mutation only if the measured score improves.

## The learning loop

- **DISSECT** — evidence-first analysis, inspired by the workflows of [REA](https://github.com/morluto/rea) and [Ghidra](https://github.com/NationalSecurityAgency/ghidra).
- **RECALL** — prior runs for the same artifact class are compared; candidate genomes are scored against the current file, and the strongest becomes the starting point. This is a local retain/recall/reflect loop in the spirit of [Hindsight](https://github.com/vectorize-io/hindsight).
- **EVOLVE** — hill-climbing selection with occasional larger jumps. `AUTO` keeps exploring while the page is visible. `EVOLVE +40` runs another batch.
- **REFLECT** — every artifact creates a memory entry (localStorage) with its winning genome, score, baseline, and accepted-mutation count. Best-known genomes are shown in the rail and reused next time.

Use **RESET MIND** to clear local memory and the current run.

## Honest limits

- A clone is a reconstruction, not a byte-identical copy. Text clones preserve texture and cadence, not wording; binary clones preserve statistics and headers, not executable behavior.
- No external reverse-engineering engine is invoked. Ghidra/REA are design lineage, not runtime dependencies; section parsing covers basic ELF and PE headers only.
- Analysis is capped (8 MB read, 720 px image scoring sample, 16K text chars, 96 KB binary sample) to keep the loop interactive.
- Memory lives only in this browser profile.

## Layout

```
src/engine/     dissection, clone engines, scoring, memory
src/components/ stage, preview, sidebar, header, empty state
src/App.tsx     ingestion, evolution orchestration, persistence
src/samples.ts  built-in image, text, and binary specimens
desktop/        native macOS shell, Info.plist, icon generator
scripts/        desktop build, inlining, WebKit smoke probe
```
