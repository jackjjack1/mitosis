import { useEffect, useRef, useState } from "react";
import { BatchQueue } from "./components/BatchQueue";
import { CloneLab } from "./components/CloneLab";
import { DropZone } from "./components/DropZone";
import { FeatureSheet } from "./components/FeatureSheet";
import { dissectFile } from "./engine/dissect";
import type { EvolutionState } from "./engine/evolve";
import { readExact } from "./engine/exact";
import { downloadBytes } from "./engine/export";
import { extractFeatures } from "./engine/features";
import type { FeatureSet } from "./engine/features";
import { analyzeMachO, isMachOArtifact } from "./engine/macho";
import type { MachOAnalysis } from "./engine/macho";
import {
  MIND_MIME,
  applyMindImport,
  decodeMindFile,
  encodeMindFile,
  freshSyncId,
  isMindFile,
  loadMind,
  loadSync,
  rememberRun,
  saveMind,
  saveSync,
  seedFromMemory,
} from "./engine/memory";
import type { MindSync } from "./engine/memory";
import { CloneFormatError, decodeCloneSession, isCloneSession } from "./engine/session";
import type { Artifact, Mind } from "./engine/types";
import { downloadEngineKit } from "./features/engineKit";
import {
  audioSpecimen,
  binarySpecimen,
  imageSpecimen,
  pdfSpecimen,
  sheetSpecimen,
  textSpecimen,
} from "./samples";

type ResultView = "features" | "evolve";

interface Extraction {
  artifact: Artifact;
  analysis: MachOAnalysis | null;
  set: FeatureSet;
  specimen: { name: string; mime: string; bytes: Uint8Array };
  evolution: EvolutionState | null;
  view: ResultView;
  loadId: number;
}

interface WebkitEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file: (success: (file: File) => void, failure?: () => void) => void;
  createReader: () => { readEntries: (success: (entries: WebkitEntry[]) => void) => void };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown reading error";
}

async function fileLooksLikeClone(file: File): Promise<boolean> {
  if (file.name.toLowerCase().endsWith(".clone")) return true;
  if (file.size < 8) return false;
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return isCloneSession(head);
}

async function fileLooksLikeMind(file: File): Promise<boolean> {
  if (file.name.toLowerCase().endsWith(".mind")) return true;
  if (file.size < 8) return false;
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return isMindFile(head);
}

async function readEntry(entry: WebkitEntry): Promise<File[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, () => reject(new Error("unreadable"))));
    if (!file.size || file.name.startsWith(".")) return [];
    return [file];
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const children: WebkitEntry[] = [];
  for (;;) {
    const chunk = await new Promise<WebkitEntry[]>((resolve) => reader.readEntries(resolve));
    if (!chunk.length) break;
    children.push(...chunk);
  }
  const nested = await Promise.all(children.map((child) => readEntry(child)));
  return nested.flat();
}

async function filesFromDrop(transfer: DataTransfer): Promise<File[]> {
  const items = [...transfer.items];
  const collected: File[] = [];
  let usedEntries = false;
  for (const item of items) {
    const entry = (
      item as unknown as { webkitGetAsEntry?: () => WebkitEntry | null }
    ).webkitGetAsEntry?.();
    if (!entry) continue;
    usedEntries = true;
    collected.push(...(await readEntry(entry)));
  }
  if (usedEntries) return collected;
  return [...transfer.files].filter((file) => file.size > 0 && !file.name.startsWith("."));
}

export default function App() {
  const [result, setResult] = useState<Extraction | null>(null);
  const [batch, setBatch] = useState<File[] | null>(null);
  const [mind, setMind] = useState<Mind>(() => loadMind());
  const [sync, setSync] = useState<MindSync>(() => loadSync());
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [evolving, setEvolving] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const tokenRef = useRef(0);
  const previewRef = useRef<string | undefined>(undefined);
  const acceptRef = useRef<(files: File[]) => void>(() => undefined);
  const mindRef = useRef(mind);
  const syncRef = useRef(sync);
  mindRef.current = mind;
  syncRef.current = sync;

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  useEffect(() => {
    const node = folderInput.current;
    if (node) node.setAttribute("webkitdirectory", "");
  }, []);

  function storeMind(next: Mind, nextSync = syncRef.current): void {
    mindRef.current = next;
    syncRef.current = nextSync;
    setMind(next);
    setSync(nextSync);
    saveMind(next);
    saveSync(nextSync);
  }

  async function importMindFile(file: File): Promise<void> {
    const document = decodeMindFile(new Uint8Array(await file.arrayBuffer()));
    const applied = applyMindImport(mindRef.current, syncRef.current, document);
    storeMind(applied.mind, applied.sync);
    setNotice(`Memory imported · ${applied.mind.memories.length} saved runs · revision ${applied.sync.revision}`);
  }

  function exportMind(): void {
    const id = syncRef.current.id || freshSyncId();
    const next = { id, revision: syncRef.current.revision + 1 };
    downloadBytes(encodeMindFile(mindRef.current, next), "mitosis-mind.mind", MIND_MIME);
    storeMind(mindRef.current, next);
  }

  async function loadSpecimen(
    file: File,
    evolution: EvolutionState | null,
    token: number,
  ): Promise<void> {
    const specimenBytes = new Uint8Array(await readExact(file));
    const artifact = await dissectFile(file);
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = artifact.previewUrl;

    let analysis: MachOAnalysis | null = null;
    if (artifact.kind === "binary" && isMachOArtifact(artifact.format)) {
      analysis = await analyzeMachO(file);
    }
    if (token !== tokenRef.current) return;

    setBatch(null);
    setResult({
      artifact,
      analysis,
      set: extractFeatures(artifact, analysis),
      specimen: {
        name: file.name,
        mime: file.type || "application/octet-stream",
        bytes: specimenBytes,
      },
      evolution,
      view: evolution ? "evolve" : "features",
      loadId: token,
    });
    setLoading(false);
  }

  async function ingest(file: File): Promise<void> {
    if (!file.size) {
      setError("Empty file — there is nothing to read.");
      return;
    }
    const token = ++tokenRef.current;
    setError(null);
    setNotice(null);
    setLoading(true);
    setEvolving(false);
    setResult(null);

    try {
      if (await fileLooksLikeMind(file)) {
        if (token !== tokenRef.current) return;
        await importMindFile(file);
        setLoading(false);
        return;
      }
      if (await fileLooksLikeClone(file)) {
        if (token !== tokenRef.current) return;
        let session;
        try {
          session = decodeCloneSession(new Uint8Array(await file.arrayBuffer()));
        } catch (caught) {
          if (caught instanceof CloneFormatError) throw caught;
          throw new CloneFormatError("Could not read that .clone session");
        }
        if (!session.specimen.bytes.length) {
          throw new CloneFormatError("The session specimen is empty");
        }
        if (token !== tokenRef.current) return;
        const specimenCopy = new ArrayBuffer(session.specimen.bytes.byteLength);
        new Uint8Array(specimenCopy).set(session.specimen.bytes);
        const specimenFile = new File([specimenCopy], session.specimen.name, {
          type: session.specimen.mime || "application/octet-stream",
        });
        await loadSpecimen(specimenFile, session.evolution, token);
        return;
      }
      await loadSpecimen(file, null, token);
    } catch (caught) {
      if (token !== tokenRef.current) return;
      setLoading(false);
      setResult(null);
      setError(`Could not read that file — ${errorText(caught)}`);
    }
  }

  async function acceptFiles(files: File[]): Promise<void> {
    const usable = files.filter((file) => file.size > 0 && !file.name.startsWith("."));
    if (!usable.length) {
      setError("Empty file — there is nothing to read.");
      return;
    }
    const minds: File[] = [];
    const rest: File[] = [];
    for (const file of usable) {
      if (await fileLooksLikeMind(file)) minds.push(file);
      else rest.push(file);
    }
    setError(null);
    for (const file of minds) {
      try {
        await importMindFile(file);
      } catch (caught) {
        setError(`Could not import memory — ${errorText(caught)}`);
      }
    }
    if (rest.length > 1) {
      setResult(null);
      setBatch(rest.slice(0, 24));
      setNotice(rest.length > 24 ? "Batch keeps the first 24 files." : null);
      return;
    }
    if (rest.length === 1) await ingest(rest[0]);
  }

  acceptRef.current = (files) => {
    void acceptFiles(files);
  };

  useEffect(() => {
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!event.dataTransfer) return;
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const transfer = event.dataTransfer;
      if (!transfer) return;
      void filesFromDrop(transfer).then((files) => {
        if (files.length) acceptRef.current(files);
      });
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  async function handleSample(
    kind: "image" | "text" | "binary" | "audio" | "pdf" | "sheet",
  ): Promise<void> {
    try {
      setError(null);
      const file =
        kind === "image"
          ? await imageSpecimen()
          : kind === "text"
            ? textSpecimen()
            : kind === "audio"
              ? audioSpecimen()
              : kind === "pdf"
                ? pdfSpecimen()
                : kind === "sheet"
                  ? sheetSpecimen()
                  : binarySpecimen();
      await ingest(file);
    } catch (caught) {
      setError(`Could not build the sample — ${errorText(caught)}`);
    }
  }

  function setView(view: ResultView): void {
    setResult((current) => (current ? { ...current, view } : current));
  }

  const recalled = result && !result.evolution ? seedFromMemory(mind, result.artifact) : null;

  function showLab(): void {
    setNotice(null);
    setBatch(null);
    setResult(null);
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </div>
          <div className="brand-text">
            <h1>MITOSIS</h1>
            <p>local lab</p>
          </div>
        </div>

        <nav className="side-nav" aria-label="Lab">
          <button type="button" className={!result && !batch ? "is-active" : ""} onClick={showLab}>
            Lab
          </button>
          <button
            type="button"
            className={result && !batch && result.view === "features" ? "is-active" : ""}
            disabled={!result}
            onClick={() => {
              setBatch(null);
              setView("features");
            }}
          >
            Features
          </button>
          <button
            type="button"
            className={result && !batch && result.view === "evolve" ? "is-active" : ""}
            disabled={!result}
            onClick={() => {
              setBatch(null);
              setView("evolve");
            }}
          >
            Evolve
          </button>
          <button
            type="button"
            className={batch ? "is-active" : ""}
            disabled={!batch}
            onClick={() => setBatch(batch)}
          >
            Batch
          </button>
        </nav>

        <div className="side-foot">
          <div className={`lab-status ${evolving ? "is-live" : ""}`}>
            <i className="pulse-dot" />
            {evolving ? "Evolving" : `${mind.memories.length} memories · rev ${sync.revision}`}
          </div>
          <button type="button" className="reset-mind" onClick={exportMind}>
            Export mind
          </button>
          <button type="button" className="reset-mind" onClick={() => fileInput.current?.click()}>
            Import
          </button>
          <button type="button" className="reset-mind" onClick={downloadEngineKit}>
            Engine kit
          </button>
        </div>
      </aside>

      <main className="simple-shell">
        {notice && !batch && <p className="seed-note">{notice}</p>}
        {batch ? (
          <BatchQueue
            files={batch}
            mind={mind}
            onMind={(next) => storeMind(next)}
            onClose={() => setBatch(null)}
          />
        ) : result ? (
          <>
            {result.view === "features" ? (
              <FeatureSheet
                artifact={result.artifact}
                set={result.set}
                onBrowse={() => fileInput.current?.click()}
              />
            ) : (
              <CloneLab
                key={result.loadId}
                artifact={result.artifact}
                specimen={result.specimen}
                initial={result.evolution}
                memorySeed={recalled?.genome ?? null}
                memoryLabel={recalled ? `${recalled.source.name} · ${Math.round(recalled.source.score * 100)}%` : null}
                onEvolution={(evolution) => {
                  setResult((current) =>
                    current && current.loadId === result.loadId
                      ? { ...current, evolution }
                      : current,
                  );
                }}
                onRunning={setEvolving}
                onPause={(evolution) => {
                  const artifact = result.artifact;
                  const next = rememberRun(mindRef.current, {
                    artifact,
                    genome: evolution.genome,
                    baseline: evolution.baseline,
                    score: evolution.score,
                    accepted: evolution.accepted,
                    attempts: evolution.attempts,
                  });
                  storeMind(next);
                  setNotice(`Remembered ${artifact.name} · ${Math.round(evolution.score * 100)}%`);
                }}
              />
            )}
          </>
        ) : (
          <DropZone
            loading={loading}
            error={error}
            dragging={dragging}
            onBrowse={() => fileInput.current?.click()}
            onSample={(kind) => {
              void handleSample(kind);
            }}
            onBatch={() => {
              setError(null);
              setBatch([textSpecimen(), sheetSpecimen(), pdfSpecimen()]);
            }}
            onFolder={() => folderInput.current?.click()}
          />
        )}
      </main>

      <input
        ref={fileInput}
        className="file-input"
        type="file"
        multiple
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length) void acceptFiles(files);
        }}
      />
      <input
        ref={folderInput}
        className="file-input"
        type="file"
        multiple
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length) void acceptFiles(files);
        }}
      />

      {dragging && (result || batch) && (
        <div className="drag-overlay">
          <div>
            <span>RELEASE TO QUEUE</span>
            <small>several files become a batch</small>
          </div>
        </div>
      )}
    </div>
  );
}
