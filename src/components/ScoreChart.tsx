import type { ScorePoint } from "../engine/evolve";

const WIDTH = 720;
const HEIGHT = 188;
const PAD_L = 36;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 26;

function scoreDomain(history: ScorePoint[]): { min: number; max: number } {
  let lo = 1;
  let hi = 0;
  for (const point of history) {
    lo = Math.min(lo, point.score, point.best);
    hi = Math.max(hi, point.score, point.best);
  }
  if (!history.length) return { min: 0, max: 1 };
  const pad = Math.max(0.025, (hi - lo) * 0.55);
  let min = Math.max(0, lo - pad);
  let max = Math.min(1, hi + pad);
  if (max - min < 0.12) {
    const mid = (Math.max(0, lo) + Math.min(1, hi)) / 2;
    min = Math.max(0, mid - 0.06);
    max = Math.min(1, mid + 0.06);
    if (min === 0) max = Math.min(1, 0.12);
    else if (max === 1) min = Math.max(0, 1 - 0.12);
  }
  return { min, max };
}

export function ScoreChart({ history }: { history: ScorePoint[] }) {
  const lastAttempt = Math.max(1, history[history.length - 1]?.attempt ?? 1);
  const innerW = WIDTH - PAD_L - PAD_R;
  const innerH = HEIGHT - PAD_T - PAD_B;
  const domain = scoreDomain(history);
  const span = domain.max - domain.min || 1;
  const x = (attempt: number) => PAD_L + (attempt / lastAttempt) * innerW;
  const y = (score: number) => PAD_T + (1 - (score - domain.min) / span) * innerH;
  const ticks = [domain.min, domain.min + span / 2, domain.max];
  const tickLabel = (value: number) =>
    (value * 100).toFixed(span >= 0.3 ? 0 : 1).replace(/\.0$/, "");
  const line = (pick: (point: ScorePoint) => number) =>
    history.map((point) => `${x(point.attempt).toFixed(1)},${y(pick(point)).toFixed(1)}`).join(" ");
  const latest = history[history.length - 1];
  const label = latest
    ? `Score over ${latest.attempt} attempts. Best ${Math.round(latest.best * 100)} percent.`
    : "Score over time";

  return (
    <svg
      className="score-chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line className="grid" x1={PAD_L} x2={WIDTH - PAD_R} y1={y(tick)} y2={y(tick)} />
          <text x={2} y={y(tick) + 3}>
            {tickLabel(tick)}
          </text>
        </g>
      ))}
      <polyline className="candidate" points={line((point) => point.score)} />
      <polyline className="best" points={line((point) => point.best)} />
      {history.map((point) =>
        point.accepted ? (
          <circle
            key={point.attempt}
            className="head"
            cx={x(point.attempt)}
            cy={y(point.best)}
            r={point.attempt === latest?.attempt ? 3.6 : 2.1}
          />
        ) : null,
      )}
    </svg>
  );
}
