import { useEffect, useMemo, useRef, useState } from "react";
import { createCloner } from "../engine";
import type { EvolutionState } from "../engine/evolve";
import {
  adoptPopulation,
  advanceEvolution,
  advancePopulation,
  startEvolution,
  startPopulation,
} from "../engine/evolve";
import type { SearchMode } from "../engine/evolve";
import { downloadBytes, exportReconstruction } from "../engine/export";
import { CLONE_MIME, encodeCloneSession, sessionFilename } from "../engine/session";
import type { Artifact, CloneOutput, Genome } from "../engine/types";
import { delta, percent } from "../engine/util";
import { ScoreChart } from "./ScoreChart";

interface SpecimenBytes {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

const EXPORT_LABEL = {
  image: "PNG",
  text: "TXT",
  binary: "BIN",
  audio: "WAV",
  pdf: "PDF",
  sheet: "CSV",
} as const;

export function CloneLab({
  artifact,
  specimen,
  initial,
  memorySeed,
  memoryLabel,
  onEvolution,
  onRunning,
  onPause,
}: {
  artifact: Artifact;
  specimen: SpecimenBytes;
  initial: EvolutionState | null;
  memorySeed?: Genome | null;
  memoryLabel?: string | null;
  onEvolution: (state: EvolutionState) => void;
  onRunning: (running: boolean) => void;
  onPause?: (state: EvolutionState) => void;
}) {
  const cloner = useMemo(() => createCloner(artifact), [artifact]);
  const [state, setState] = useState<EvolutionState>(() => {
    if (initial) return initial.mode ? initial : { ...initial, mode: "hill" };
    return startPopulation(cloner, { size: 6, seed: memorySeed ?? undefined });
  });
  const [output, setOutput] = useState<CloneOutput>(() => cloner.materialize(state.genome));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seedLabel] = useState(memoryLabel ?? null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const onEvolutionRef = useRef(onEvolution);
  onEvolutionRef.current = onEvolution;
  const onPauseRef = useRef(onPause);
  onPauseRef.current = onPause;
  const onRunningRef = useRef(onRunning);
  onRunningRef.current = onRunning;
  const rememberedAttempts = useRef(initial?.attempts ?? 0);

  useEffect(() => {
    if (running) return;
    if (state.attempts <= rememberedAttempts.current) return;
    rememberedAttempts.current = state.attempts;
    onPauseRef.current?.(state);
  }, [running, state]);

  useEffect(() => {
    return () => {
      if (stateRef.current.attempts > rememberedAttempts.current) {
        rememberedAttempts.current = stateRef.current.attempts;
        onPauseRef.current?.(stateRef.current);
      }
    };
  }, []);

  useEffect(() => {
    onEvolutionRef.current(state);
  }, [state]);

  useEffect(() => {
    onRunningRef.current(running);
    return () => onRunningRef.current(false);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    let cancel = false;
    let timer = 0;
    const tick = () => {
      if (cancel) return;
      const current = stateRef.current;
      const next =
        current.mode === "hill"
          ? advanceEvolution(cloner, current, Math.random)
          : advancePopulation(cloner, current, Math.random);
      stateRef.current = next;
      setState(next);
      if (next.genome !== current.genome) {
        try {
          setOutput(cloner.materialize(next.genome));
        } catch (caught) {
          cancel = true;
          setRunning(false);
          setError(caught instanceof Error ? caught.message : "Could not draw the clone");
          return;
        }
      }
      timer = window.setTimeout(tick, 48);
    };
    timer = window.setTimeout(tick, 48);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [running, cloner]);

  function commit(next: EvolutionState): void {
    const current = stateRef.current;
    stateRef.current = next;
    setState(next);
    if (next.genome !== current.genome) {
      try {
        setOutput(cloner.materialize(next.genome));
        setError(null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not draw the clone");
      }
    }
  }

  function stepOnce(): void {
    const current = stateRef.current;
    commit(
      current.mode === "hill"
        ? advanceEvolution(cloner, current, Math.random)
        : advancePopulation(cloner, current, Math.random),
    );
  }

  function chooseMode(next: SearchMode): void {
    const current = stateRef.current;
    if (next === "population") {
      commit(adoptPopulation(cloner, { ...current, mode: "population" }, Math.random));
      return;
    }
    const hill = startEvolution(cloner, current.genome);
    commit({
      ...current,
      mode: "hill",
      seed: current.seed,
      genome: current.genome,
      baseline: current.baseline,
      score: current.score,
      population: undefined,
      populationSize: undefined,
      history: current.history.length ? current.history : hill.history,
    });
  }

  function exportClone(): void {
    try {
      const file = exportReconstruction(artifact.kind, artifact.name, output);
      downloadBytes(file.bytes, file.filename, file.mime);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not export the clone");
    }
  }

  function saveSession(): void {
    const bytes = encodeCloneSession({
      version: 1,
      savedAt: Date.now(),
      specimen,
      evolution: stateRef.current,
    });
    downloadBytes(bytes, sessionFilename(specimen.name), CLONE_MIME);
  }

  const latest = state.history[state.history.length - 1];
  const improved = Boolean(latest && latest.attempt > 0 && latest.accepted);
  const population = state.mode !== "hill";
  const rows = cloner.describe(state.genome);
  const rowLabels = new Set(rows.map((row) => row.label));
  const facts = output.facts.filter((fact) => !rowLabels.has(fact.label));

  return (
    <section className="lab">
      <header className="sheet-head">
        <div className="sheet-copy">
          <p className="eyebrow">EVOLVE / {artifact.format}</p>
          <h2 title={artifact.name}>{artifact.name}</h2>
          {seedLabel ? <p className="seed-note">SEEDED FROM {seedLabel}</p> : null}
          <p className="lede">
            The original stays on the left. The reconstruction on the right updates
            each time a generation scores higher. Nothing is uploaded.
          </p>
        </div>
        <div className="sheet-actions">
          <div className="view-switch search-switch" role="group" aria-label="Search">
            <button
              type="button"
              aria-pressed={population}
              onClick={() => chooseMode("population")}
              disabled={running}
            >
              POPULATION
            </button>
            <button
              type="button"
              aria-pressed={!population}
              onClick={() => chooseMode("hill")}
              disabled={running}
            >
              HILL
            </button>
          </div>
          <button
            type="button"
            className="primary sheet-download"
            aria-pressed={running}
            onClick={() => setRunning((value) => !value)}
          >
            {running ? "PAUSE" : state.attempts ? "RESUME" : "RUN"}
          </button>
          <button type="button" className="sheet-again" onClick={stepOnce} disabled={running}>
            STEP
          </button>
        </div>
      </header>

      <div className="compare">
        <figure>
          <figcaption>
            <span>ORIGINAL</span>
            <b>SEED {percent(state.baseline, 1)}</b>
          </figcaption>
          <div className={`frame ${frameClass(artifact.kind)}`}>
            <SpecimenView artifact={artifact} />
          </div>
        </figure>
        <figure className={running || improved ? "is-live" : ""}>
          <figcaption>
            <span>
              CLONE · {population ? "GEN" : "STEP"} {state.attempts}
            </span>
            <b>
              {percent(state.score, 1)} {delta(state.score - state.baseline)}
            </b>
          </figcaption>
          <div className={`frame ${frameClass(artifact.kind)}`}>
            <CloneView artifact={artifact} output={output} />
          </div>
        </figure>
      </div>

      <div className="lab-lower">
        <div className="chart-block">
          <div className="chart-legend">
            <span>
              <i className="swatch best" /> {population ? "ELITE" : "BEST"}
            </span>
            <span>
              <i className="swatch candidate" /> {population ? "MEAN" : "CANDIDATE"}
            </span>
            <span>
              {state.accepted} ACCEPTED / {state.attempts}{" "}
              {population ? "GENERATIONS" : "ATTEMPTS"}
              {population ? ` · POP ${state.populationSize ?? state.population?.length ?? 6}` : ""}
            </span>
          </div>
          <ScoreChart history={state.history} />
          <p className="evolve-status" aria-live="polite">
            {running ? "EVOLVING" : "HOLDING"}
            {" · "}
            {latest?.change ?? "seed"}
          </p>
        </div>
        <aside className="lab-side">
          <div className="genome-rows">
            {rows.map((row) => (
              <div key={row.key}>
                <span>{row.label}</span>
                <b>{row.value}</b>
              </div>
            ))}
            {facts.map((fact) => (
              <div key={fact.label}>
                <span>{fact.label}</span>
                <b>{fact.value}</b>
              </div>
            ))}
          </div>
          {state.attempts > 0 && !running && (
            <p className="evolve-note">
              {cloner.reflect(state.seed, state.genome, state.baseline, state.score)}
            </p>
          )}
          <div className="sheet-actions lab-export">
            <button type="button" className="primary sheet-download" onClick={exportClone}>
              EXPORT {EXPORT_LABEL[artifact.kind]}
            </button>
            <button type="button" className="sheet-again" onClick={saveSession}>
              SAVE .CLONE
            </button>
          </div>
          {error && <p className="error-message">{error}</p>}
        </aside>
      </div>
    </section>
  );
}

function frameClass(kind: Artifact["kind"]): string {
  if (kind === "binary" || kind === "audio" || kind === "sheet") return "binary";
  return "";
}

function SpecimenView({ artifact }: { artifact: Artifact }) {
  if (artifact.kind === "image" && artifact.previewUrl) {
    return <img src={artifact.previewUrl} alt={`Original ${artifact.name}`} />;
  }
  if (artifact.kind === "text") {
    return <pre>{artifact.text?.sample || "No text sample."}</pre>;
  }
  if (artifact.kind === "pdf") {
    return <pre>{artifact.pdf?.text || "No extractable page text."}</pre>;
  }
  if (artifact.kind === "audio" && artifact.audio) {
    return <AudioLook waveform={artifact.audio.waveform} spectrum={artifact.audio.spectrum} />;
  }
  if (artifact.kind === "sheet" && artifact.sheet) {
    return <TableLook headers={artifact.sheet.headers} rows={artifact.sheet.rows} />;
  }
  return (
    <BinaryLook
      bytes={artifact.binary?.sample}
      entropy={artifact.binary?.entropyBlocks ?? []}
    />
  );
}

function CloneView({ artifact, output }: { artifact: Artifact; output: CloneOutput }) {
  if (artifact.kind === "image" && output.dataUrl) {
    return <img src={output.dataUrl} alt={`Reconstructed ${artifact.name}`} />;
  }
  if (artifact.kind === "text" || artifact.kind === "pdf") {
    return <pre>{output.text || ""}</pre>;
  }
  if (artifact.kind === "audio" && output.audioProfile) {
    return (
      <AudioLook
        waveform={output.audioProfile.waveform}
        spectrum={output.audioProfile.spectrum}
      />
    );
  }
  if (artifact.kind === "sheet" && output.table) {
    return <TableLook headers={output.table.headers} rows={output.table.rows} />;
  }
  return <BinaryLook bytes={output.bytes} entropy={output.binaryProfile?.entropy ?? []} />;
}

function AudioLook({ waveform, spectrum }: { waveform: number[]; spectrum: number[] }) {
  return (
    <div className="wave-stack">
      <div className="entropy" aria-hidden="true">
        {waveform.map((value, index) => (
          <span key={index} style={{ height: `${Math.max(6, value * 100)}%` }} />
        ))}
      </div>
      <div className="entropy spectrum" aria-hidden="true">
        {spectrum.map((value, index) => (
          <span key={index} style={{ height: `${Math.max(6, value * 100)}%` }} />
        ))}
      </div>
    </div>
  );
}

function TableLook({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const shown = headers.slice(0, 6);
  return (
    <table className="data-table">
      <thead>
        <tr>
          {shown.map((header) => (
            <th key={header}>{header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 8).map((row, index) => (
          <tr key={index}>
            {shown.map((header, cell) => (
              <td key={header}>{row[cell] ?? ""}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BinaryLook({ bytes, entropy }: { bytes?: Uint8Array; entropy: number[] }) {
  const sample = bytes ?? new Uint8Array();
  const bars = entropy.slice(0, 64);
  const hex = [...sample.subarray(0, 48)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
  return (
    <>
      <div className="entropy" aria-hidden="true">
        {bars.length ? (
          bars.map((value, index) => (
            <span key={index} style={{ height: `${Math.max(6, (value / 8) * 100)}%` }} />
          ))
        ) : (
          <span style={{ height: "8%" }} />
        )}
      </div>
      <p className="hexdump">{hex || "—"}</p>
    </>
  );
}
