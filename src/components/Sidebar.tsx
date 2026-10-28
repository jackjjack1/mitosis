import type { Kind, MemoryEntry, Mind } from "../engine/types";
import { percent } from "../engine/util";
import type { HistoryPoint, RunState } from "../model";

const KINDS: Kind[] = ["image", "text", "binary"];

function ageLabel(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Spark({
  points,
  baseline,
}: {
  points: HistoryPoint[];
  baseline: number;
}) {
  const width = 280;
  const height = 54;
  const pad = 3;
  const scores = points.map((point) => point.score);
  const low = Math.min(baseline, ...scores) - 0.015;
  const high = Math.max(baseline, ...scores, low + 0.04) + 0.005;
  const x = (index: number) =>
    pad + (index / Math.max(1, points.length - 1)) * (width - pad * 2);
  const y = (value: number) =>
    height - pad - ((value - low) / Math.max(0.0001, high - low)) * (height - pad * 2);
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(point.score).toFixed(1)}`)
    .join(" ");
  const area = points.length
    ? `${path} L ${x(points.length - 1).toFixed(1)} ${height - pad} L ${x(0).toFixed(
        1,
      )} ${height - pad} Z`
    : "";
  const last = points[points.length - 1];
  return (
    <div className="spark-wrap">
      <svg
        className="spark"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c6ff4a" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#c6ff4a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line
          className="spark-baseline"
          x1="0"
          x2={width}
          y1={y(baseline)}
          y2={y(baseline)}
        />
        {area && <path d={area} fill="url(#spark-fill)" />}
        {path && <path d={path} className="spark-line" />}
        {last && (
          <circle
            cx={x(points.length - 1)}
            cy={y(last.score)}
            r="2.2"
            fill="#c6ff4a"
          />
        )}
      </svg>
      <div className="spark-foot">
        <span>GEN 0</span>
        <span>BASE {percent(baseline, 1)}</span>
        <span>GEN {last?.n ?? 0}</span>
      </div>
    </div>
  );
}

function MemoryRow({
  entry,
  recalled = false,
  active = false,
}: {
  entry: MemoryEntry;
  recalled?: boolean;
  active?: boolean;
}) {
  return (
    <div className={`memory-row ${active ? "active" : ""}`}>
      <span className={`memory-kind k-${entry.kind}`}>
        {entry.kind.slice(0, 1).toUpperCase()}
      </span>
      <div className="memory-copy">
        <b title={entry.name}>{entry.name}</b>
        <span>
          {entry.format} · {entry.attempts} trials · {ageLabel(entry.at)}
        </span>
      </div>
      <span className="memory-score">{percent(entry.score, 1)}</span>
      {recalled && <i className="recall-mark" title="Recalled for this specimen" />}
    </div>
  );
}

export function Sidebar({
  mind,
  session,
  auto,
  onAuto,
  onEvolve,
}: {
  mind: Mind;
  session: RunState | null;
  auto: boolean;
  onAuto: (value: boolean) => void;
  onEvolve: () => void;
}) {
  const evolving = session?.status === "evolving";
  const live =
    evolving || (!!session && auto && session.status === "done");
  const memoryGain = session
    ? Math.max(0, session.seedScore - session.blankScore)
    : 0;
  const recalledIds = new Set(session?.recalled.map((entry) => entry.id) ?? []);
  const latest = mind.memories
    .filter(
      (entry) =>
        !recalledIds.has(entry.id) || entry.id === session?.memoryId,
    )
    .slice(0, 4);
  const hasBest = KINDS.some((kind) => mind.best[kind]);

  return (
    <aside className="rail">
      <section className="card score-card">
        <div className="card-head">
          <span>SELECTION LOOP</span>
          <span className={`status-chip ${live ? "on" : ""}`}>
            <i />
            {live ? "MUTATING" : session ? "PAUSED" : "IDLE"}
          </span>
        </div>

        {session ? (
          <>
            <div className="score-line">
              <div className="big-score">{percent(session.best, 2)}</div>
              <div className="delta-stack">
                <span className="delta-good">
                  ▲ {((session.best - session.baseline) * 100).toFixed(1)} pts
                </span>
                <span>from first attempt</span>
              </div>
            </div>
            <div className="score-bar">
              <i style={{ width: `${session.best * 100}%` }} />
              <span
                className="baseline-mark"
                style={{ left: `${session.baseline * 100}%` }}
                title={`First attempt ${percent(session.baseline)}`}
              />
            </div>
            <div className="score-meta">
              <span>BASE {percent(session.baseline, 1)}</span>
              <span>{session.attempts} TRIALS</span>
              <span>{session.accepted} KEPT</span>
            </div>

            <Spark points={session.history} baseline={session.baseline} />

            <div className="actions">
              <button
                type="button"
                className="primary"
                onClick={onEvolve}
                disabled={evolving}
              >
                {evolving ? "SELECTING…" : "EVOLVE"}
                <span>{evolving ? "" : "+40"}</span>
              </button>
              <button
                type="button"
                className={`auto-toggle ${auto ? "on" : ""}`}
                aria-pressed={auto}
                onClick={() => onAuto(!auto)}
                disabled={evolving}
                title="Let the lab keep mutating while this page is visible"
              >
                <i />
                AUTO
              </button>
            </div>

            <div className="seed-line">
              <span className="seed-badge">
                {session.recalled.length
                  ? `${session.recalled.length} RECALLED`
                  : "COLD START"}
              </span>
              <span>
                {memoryGain > 0.0005
                  ? `memory lift +${(memoryGain * 100).toFixed(1)} pts`
                  : "built-in genome"}
              </span>
            </div>

            <div className="last-change">
              <span>LAST KEPT</span>
              <b>{session.lastChange ?? "none yet"}</b>
            </div>
          </>
        ) : (
          <>
            <div className="idle-score">
              AWAITING
              <br />
              SPECIMEN
            </div>
            <p className="card-copy">
              Drop a file to synthesize the first candidate. The loop keeps only the
              mutations that improve the match.
            </p>
            {hasBest && (
              <div className="best-list">
                <span className="micro-label">BEST KNOWN GENOMES</span>
                {KINDS.map((kind) => {
                  const best = mind.best[kind];
                  if (!best) return null;
                  return (
                    <div className="best-row" key={kind}>
                      <span className={`kind-dot k-${kind}`} />
                      <span>{kind}</span>
                      <b>{percent(best.score, 1)}</b>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <span>ACTIVE GENOME</span>
          {session && <span className="gen-counter">GEN {session.attempts}</span>}
        </div>
        {session ? (
          <>
            <div className="gene-list">
              {session.cloner.describe(session.genome).map((row) => {
                const span = Math.max(0.0001, row.max - row.min);
                const fill = Math.min(
                  100,
                  Math.max(3, ((row.raw - row.min) / span) * 100),
                );
                return (
                  <div className="gene-row" key={row.key}>
                    <div className="gene-top">
                      <span>{row.label}</span>
                      <b>{row.value}</b>
                    </div>
                    <div className="gene-track">
                      <i style={{ width: `${fill}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="genome-foot">
              <span>SELECTION PRESSURE</span>
              <b>
                {session.attempts === 0
                  ? "warming up"
                  : `${Math.round((session.accepted / session.attempts) * 100)}% of trials kept`}
              </b>
            </div>
          </>
        ) : (
          <p className="card-copy">
            No active genome. The built-in defaults wait for a specimen.
          </p>
        )}
      </section>

      <section className="card memory-card">
        <div className="card-head">
          <span>MEMORY BANK</span>
          <span className="gen-counter">{mind.memories.length} RETAINED</span>
        </div>

        {session && session.recalled.length > 0 && (
          <>
            <span className="micro-label">RECALLED FOR THIS SPECIMEN</span>
            <div className="memory-list">
              {session.recalled.map((entry) => (
                <MemoryRow entry={entry} recalled key={entry.id} />
              ))}
            </div>
          </>
        )}

        <span className="micro-label">LATEST RETAINED</span>
        {latest.length > 0 ? (
          <div className="memory-list">
            {latest.map((entry) => (
              <MemoryRow
                entry={entry}
                active={entry.id === session?.memoryId}
                key={entry.id}
              />
            ))}
          </div>
        ) : (
          <p className="card-copy">
            {mind.memories.length
              ? "Every retained run is already recalled for this specimen."
              : "Nothing retained yet. The first run writes the first instruction."}
          </p>
        )}

        {session?.status === "done" && session.reflection && (
          <div className="reflection">
            <span>REFLECTION</span>
            <p>{session.reflection}</p>
          </div>
        )}

        <p className="memory-foot">RETAIN · RECALL · REFLECT</p>
      </section>

      <p className="fineprint">
        Runs entirely in this browser. Dissection follows the evidence-first
        workflows of REA and Ghidra; the memory loop is in the spirit of Hindsight.
        No external RE engine is invoked. Clones are reconstructions, not
        byte-identical copies.
      </p>
    </aside>
  );
}
