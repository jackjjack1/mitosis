import { useEffect, useRef, useState } from "react";
import { dissectFile } from "./engine/dissect";
import { extractFeatures } from "./engine/features";
import type { FeatureSet } from "./engine/features";
import { analyzeMachO, isMachOArtifact } from "./engine/macho";
import type { MachOAnalysis } from "./engine/macho";
import type { Artifact } from "./engine/types";
import { downloadEngineKit } from "./features/engineKit";
import { DropZone } from "./components/DropZone";
import { FeatureSheet } from "./components/FeatureSheet";
import { binarySpecimen, imageSpecimen, textSpecimen } from "./samples";

interface Extraction {
  artifact: Artifact;
  analysis: MachOAnalysis | null;
  set: FeatureSet;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown reading error";
}

export default function App() {
  const [result, setResult] = useState<Extraction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const tokenRef = useRef(0);
  const previewRef = useRef<string | undefined>(undefined);
  const ingestRef = useRef<(file: File) => void>(() => undefined);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  async function ingest(file: File): Promise<void> {
    if (!file.size) {
      setError("Empty file — there is nothing to read.");
      return;
    }
    const token = ++tokenRef.current;
    setError(null);
    setLoading(true);
    setResult(null);

    try {
      const artifact = await dissectFile(file);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      previewRef.current = artifact.previewUrl;

      let analysis: MachOAnalysis | null = null;
      if (artifact.kind === "binary" && isMachOArtifact(artifact.format)) {
        analysis = await analyzeMachO(file);
      }
      if (token !== tokenRef.current) return;

      setResult({ artifact, analysis, set: extractFeatures(artifact, analysis) });
      setLoading(false);
    } catch (caught) {
      if (token !== tokenRef.current) return;
      setLoading(false);
      setResult(null);
      setError(`Could not read that file — ${errorText(caught)}`);
    }
  }

  ingestRef.current = (file) => {
    void ingest(file);
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
      const file = event.dataTransfer?.files?.[0];
      if (file) ingestRef.current(file);
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

  async function handleSample(kind: "image" | "text" | "binary"): Promise<void> {
    try {
      setError(null);
      const file =
        kind === "image"
          ? await imageSpecimen()
          : kind === "text"
            ? textSpecimen()
            : binarySpecimen();
      await ingest(file);
    } catch (caught) {
      setError(`Could not build the sample — ${errorText(caught)}`);
    }
  }

  return (
    <div className="app">
      <div className="backdrop" aria-hidden="true" />

      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </div>
          <div className="brand-text">
            <h1>MITOSIS</h1>
            <p>drop a file · take the parts</p>
          </div>
        </div>

        <div className="topbar-right">
          <div className="lab-status">
            <i className="pulse-dot" />
            LOCAL · NO UPLOAD
          </div>
          <button
            type="button"
            className="reset-mind"
            onClick={downloadEngineKit}
            title="Download the MITOSIS dissection engine as TypeScript"
          >
            ENGINE KIT .ZIP
          </button>
        </div>
      </header>

      <main className="simple-shell">
        {result ? (
          <FeatureSheet
            artifact={result.artifact}
            set={result.set}
            onBrowse={() => fileInput.current?.click()}
          />
        ) : (
          <DropZone
            loading={loading}
            error={error}
            dragging={dragging}
            onBrowse={() => fileInput.current?.click()}
            onSample={(kind) => {
              void handleSample(kind);
            }}
          />
        )}
      </main>

      <input
        ref={fileInput}
        className="file-input"
        type="file"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void ingest(file);
        }}
      />

      {dragging && result && (
        <div className="drag-overlay">
          <div>
            <span>RELEASE TO REPLACE</span>
            <small>the current feature sheet is replaced</small>
          </div>
        </div>
      )}
    </div>
  );
}
