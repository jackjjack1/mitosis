import { useEffect, useRef, useState } from "react";
import { createCloner, genomeSignature } from "./engine";
import { dissectFile } from "./engine/dissect";
import {
  clearMind,
  emptyMind,
  loadMind,
  recallMemories,
  recordRun,
  saveMind,
  updateRun,
} from "./engine/memory";
import type { Artifact, Genome, Mind } from "./engine/types";
import { mulberry32, nextFrame, seedFromString } from "./engine/util";
import type { RunState } from "./model";
import { EmptyState } from "./components/EmptyState";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { Stage } from "./components/Stage";
import { binarySpecimen, imageSpecimen, textSpecimen } from "./samples";

const INITIAL_GENERATIONS = 32;
const MANUAL_GENERATIONS = 40;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unknown dissection failure";
}

export default function App() {
  const [mind, setMind] = useState<Mind>(loadMind);
  const [session, setSession] = useState<RunState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [auto, setAuto] = useState(true);

  const fileInput = useRef<HTMLInputElement>(null);
  const runToken = useRef(0);
  const activeRef = useRef(false);
  const sessionRef = useRef<RunState | null>(null);
  const mindRef = useRef(mind);
  const ingestRef = useRef<(file: File) => void>(() => undefined);
  const autoRngRef = useRef<(() => number) | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    mindRef.current = mind;
    saveMind(mind);
  }, [mind]);

  useEffect(() => {
    const url = session?.artifact.previewUrl;
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [session?.artifact.previewUrl]);

  async function evolve(
    start: RunState,
    count: number,
    initial: boolean,
  ): Promise<void> {
    const token = ++runToken.current;
    activeRef.current = true;
    let current: RunState = { ...start, status: "evolving" };
    setSession(current);
    sessionRef.current = current;

    let genome = start.genome;
    let best = start.best;
    let accepted = start.accepted;
    let attempts = start.attempts;
    let lastChange = start.lastChange;
    let output = start.output;
    let history = start.history;

    try {
      const rng = mulberry32(
        seedFromString(start.artifact.hash, Math.floor(Date.now() % 100_000)),
      );
      for (let i = 0; i < count; i++) {
        if (runToken.current !== token) return;
        const mutation = start.cloner.mutate(genome, rng);
        const score = start.cloner.evaluate(mutation.genome);
        attempts++;
        const improved = score > best + 0.00005;
        if (improved) {
          genome = mutation.genome;
          best = score;
          accepted++;
          lastChange = mutation.changed;
          if (attempts % 7 === 0) {
            output = start.cloner.materialize(genome);
          }
        }
        history = [...history, { n: attempts, score: best }].slice(-280);
        current = {
          ...start,
          genome,
          best,
          accepted,
          attempts,
          history,
          lastChange,
          output,
          status: "evolving",
        };
        setSession(current);
        sessionRef.current = current;
        await nextFrame();
      }

      output = start.cloner.materialize(genome);
      const reflection = start.cloner.reflect(
        start.seed,
        genome,
        start.baseline,
        best,
      );
      current = {
        ...current,
        output,
        reflection,
        status: "done",
        history,
      };
      setSession(current);
      sessionRef.current = current;

      if (initial) {
        setMind((currentMind) =>
          recordRun(currentMind, {
            artifact: start.artifact,
            genome,
            baseline: start.baseline,
            score: best,
            accepted,
            attempts,
          }),
        );
      } else {
        setMind((currentMind) =>
          updateRun(currentMind, start.memoryId, {
            genome,
            score: best,
            baseline: start.baseline,
            accepted,
            attempts,
            kind: start.artifact.kind,
            name: start.artifact.name,
          }),
        );
      }
    } finally {
      if (runToken.current === token) activeRef.current = false;
    }
  }

  async function ingest(file: File): Promise<void> {
    if (!file.size) {
      setError("Empty file — there is no surface to clone.");
      return;
    }
    runToken.current++;
    setError(null);
    setLoading(true);
    setSession(null);
    sessionRef.current = null;
    autoRngRef.current = null;

    let artifact: Artifact | null = null;
    try {
      artifact = await dissectFile(file);
      const cloner = createCloner(artifact);
      const recalled = recallMemories(mindRef.current, artifact);
      const candidates: Genome[] = [cloner.defaults];
      const bestKnown = mindRef.current.best[artifact.kind];
      if (bestKnown) candidates.push(bestKnown.genome);
      for (const memory of recalled) candidates.push(memory.genome);

      const blankScore = cloner.evaluate(cloner.defaults);
      let seed = cloner.defaults;
      let seedScore = blankScore;
      const seen = new Set<string>();
      for (const candidate of candidates) {
        const signature = genomeSignature(candidate);
        if (seen.has(signature)) continue;
        seen.add(signature);
        const score = cloner.evaluate(candidate);
        if (score > seedScore + 0.00005) {
          seedScore = score;
          seed = candidate;
        }
      }

      const output = cloner.materialize(seed);
      const next: RunState = {
        artifact,
        cloner,
        recalled,
        seed,
        seedScore,
        blankScore,
        genome: seed,
        baseline: seedScore,
        best: seedScore,
        history: [{ n: 0, score: seedScore }],
        attempts: 0,
        accepted: 0,
        lastChange: null,
        status: "ready",
        output,
        memoryId: `${artifact.kind}:${artifact.hash}`,
        reflection: "",
      };
      setSession(next);
      sessionRef.current = next;
      setLoading(false);
      await evolve(next, INITIAL_GENERATIONS, true);
    } catch (caught) {
      if (artifact?.previewUrl) URL.revokeObjectURL(artifact.previewUrl);
      setLoading(false);
      setSession(null);
      sessionRef.current = null;
      setError(`Dissection failed — ${errorText(caught)}`);
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

  useEffect(() => {
    if (!auto || !session || session.status !== "done") return;
    const timer = window.setInterval(() => {
      const run = sessionRef.current;
      if (!run || run.status !== "done" || activeRef.current || document.hidden) {
        return;
      }
      activeRef.current = true;
      try {
        const rng =
          autoRngRef.current ??
          mulberry32(
            seedFromString(run.artifact.hash, Math.floor(Date.now() % 100_000)),
          );
        autoRngRef.current = rng;
        const mutation = run.cloner.mutate(run.genome, rng);
        const score = run.cloner.evaluate(mutation.genome);
        const improved = score > run.best + 0.00005;
        const genome = improved ? mutation.genome : run.genome;
        const best = improved ? score : run.best;
        const attempts = run.attempts + 1;
        const accepted = run.accepted + (improved ? 1 : 0);
        const next: RunState = {
          ...run,
          genome,
          best,
          attempts,
          accepted,
          lastChange: improved ? mutation.changed : run.lastChange,
          history: [...run.history, { n: attempts, score: best }].slice(-280),
          output: improved ? run.cloner.materialize(genome) : run.output,
        };
        setSession(next);
        sessionRef.current = next;
        setMind((currentMind) =>
          updateRun(currentMind, run.memoryId, {
            genome,
            score: best,
            baseline: run.baseline,
            accepted,
            attempts,
            kind: run.artifact.kind,
            name: run.artifact.name,
          }),
        );
      } finally {
        activeRef.current = false;
      }
    }, 950);
    return () => window.clearInterval(timer);
  }, [auto, session?.status, session?.memoryId]);

  function handleEvolve(): void {
    const run = sessionRef.current;
    if (!run || run.status !== "done" || activeRef.current) return;
    void evolve(run, MANUAL_GENERATIONS, false);
  }

  function handleReset(): void {
    runToken.current++;
    activeRef.current = false;
    setSession(null);
    sessionRef.current = null;
    setMind(emptyMind());
    clearMind();
    setError(null);
    setLoading(false);
    setAuto(true);
  }

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
      setError(`Could not build specimen — ${errorText(caught)}`);
    }
  }

  const live =
    loading ||
    session?.status === "evolving" ||
    (!!session && auto && session.status === "done");

  return (
    <div className="app">
      <div className="backdrop" aria-hidden="true" />
      <Header mind={mind} live={live} onReset={handleReset} />

      <main className="shell">
        <div className="workspace">
          {session ? (
            <Stage
              run={session}
              onBrowse={() => fileInput.current?.click()}
            />
          ) : (
            <EmptyState
              loading={loading}
              error={error}
              dragging={dragging}
              onBrowse={() => fileInput.current?.click()}
              onSample={(kind) => {
                void handleSample(kind);
              }}
            />
          )}
        </div>

        <Sidebar
          mind={mind}
          session={session}
          auto={auto}
          onAuto={setAuto}
          onEvolve={handleEvolve}
        />
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

      {dragging && session && (
        <div className="drag-overlay">
          <div>
            <span>RELEASE TO REPLACE SPECIMEN</span>
            <small>the current run stays in memory</small>
          </div>
        </div>
      )}
    </div>
  );
}
