import type { Cloner, Genome, Rng } from "./types";

/** One plotted point on the score-over-time chart. */
export interface ScorePoint {
  attempt: number;
  /** Candidate score at this attempt. Attempt 0 is the seed. */
  score: number;
  /** Best score retained after this attempt. */
  best: number;
  accepted: boolean;
  change: string;
}

/**
 * A single-genome hill climb. Later stages can replace `advanceEvolution`
 * with a population step; `history` stays the chart's source of truth.
 * Pass `seed` from `recallMemories` when a run should start from memory.
 */
export interface EvolutionState {
  seed: Genome;
  genome: Genome;
  baseline: number;
  score: number;
  attempts: number;
  accepted: number;
  history: ScorePoint[];
}

export function startEvolution(cloner: Cloner, seed?: Genome): EvolutionState {
  const genome = { ...(seed ?? cloner.defaults) };
  const score = cloner.evaluate(genome);
  return {
    seed: { ...genome },
    genome,
    baseline: score,
    score,
    attempts: 0,
    accepted: 0,
    history: [{ attempt: 0, score, best: score, accepted: true, change: "seed" }],
  };
}

/** One mutation. A candidate replaces the parent only when its score is strictly higher. */
export function advanceEvolution(
  cloner: Cloner,
  state: EvolutionState,
  rng: Rng,
): EvolutionState {
  const mutation = cloner.mutate(state.genome, rng);
  const candidate = cloner.evaluate(mutation.genome);
  const improved = candidate > state.score;
  const attempts = state.attempts + 1;
  const score = improved ? candidate : state.score;
  return {
    seed: state.seed,
    genome: improved ? mutation.genome : state.genome,
    baseline: state.baseline,
    score,
    attempts,
    accepted: state.accepted + (improved ? 1 : 0),
    history: [
      ...state.history,
      {
        attempt: attempts,
        score: candidate,
        best: score,
        accepted: improved,
        change: mutation.changed,
      },
    ],
  };
}
