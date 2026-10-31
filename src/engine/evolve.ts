import type { Cloner, Genome, Rng } from "./types";
import { clamp } from "./util";

export type SearchMode = "hill" | "population";

export interface PopulationMember {
  genome: Genome;
  score: number;
}

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
  /** Absent on a hill climb. Population runs set this so a session can resume. */
  mode?: SearchMode;
  population?: PopulationMember[];
  populationSize?: number;
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

/** Uniform or blended crossover of two numeric genomes. Keys stay in parent order. */
export function crossoverGenomes(a: Genome, b: Genome, rng: Rng): Genome {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const child: Genome = {};
  for (const key of keys) {
    const left = a[key] ?? b[key] ?? 0;
    const right = b[key] ?? a[key] ?? 0;
    const roll = rng();
    if (roll < 0.4) child[key] = left;
    else if (roll < 0.8) child[key] = right;
    else child[key] = (left + right) / 2;
  }
  return child;
}

function tournament(members: PopulationMember[], rng: Rng): PopulationMember {
  const first = members[Math.floor(rng() * members.length)] ?? members[0];
  const second = members[Math.floor(rng() * members.length)] ?? first;
  return second.score > first.score ? second : first;
}

function meanScore(members: PopulationMember[]): number {
  if (!members.length) return 0;
  return members.reduce((sum, member) => sum + member.score, 0) / members.length;
}

function eliteChange(cloner: Cloner, before: Genome, after: Genome): string {
  const previous = cloner.describe(before);
  const next = cloner.describe(after);
  for (let i = 0; i < next.length; i++) {
    if (previous[i]?.value !== next[i]?.value) {
      return `${next[i].label.toLowerCase()} ${previous[i]?.value ?? "?"} → ${next[i].value}`;
    }
  }
  return "population held";
}

/**
 * Population search. The hill climb stays available through `advanceEvolution`.
 * Each step keeps the elite, fills the rest by crossover plus mutation, and
 * records the population mean as the chart's candidate line.
 */
export function startPopulation(
  cloner: Cloner,
  options?: { size?: number; seed?: Genome },
  rng: Rng = Math.random,
): EvolutionState {
  const size = clamp(Math.round(options?.size ?? 6), 2, 24);
  const seed = { ...(options?.seed ?? cloner.defaults) };
  const seedScore = cloner.evaluate(seed);
  const population: PopulationMember[] = [{ genome: { ...seed }, score: seedScore }];
  while (population.length < size) {
    const mutation = cloner.mutate(seed, rng);
    population.push({
      genome: mutation.genome,
      score: cloner.evaluate(mutation.genome),
    });
  }
  population.sort((a, b) => b.score - a.score);
  const elite = population[0];
  return {
    seed: { ...seed },
    genome: { ...elite.genome },
    baseline: seedScore,
    score: elite.score,
    attempts: 0,
    accepted: 0,
    mode: "population",
    populationSize: size,
    population,
    history: [
      {
        attempt: 0,
        score: meanScore(population),
        best: elite.score,
        accepted: true,
        change: "seed",
      },
    ],
  };
}

/** Fill a population around the current elite without erasing the score history. */
export function adoptPopulation(
  cloner: Cloner,
  state: EvolutionState,
  rng: Rng = Math.random,
): EvolutionState {
  if (state.mode === "population" && (state.population?.length ?? 0) > 1) return state;
  const size = clamp(Math.round(state.populationSize ?? 6), 2, 24);
  const population: PopulationMember[] = [{ genome: { ...state.genome }, score: state.score }];
  while (population.length < size) {
    const mutation = cloner.mutate(state.genome, rng);
    population.push({ genome: mutation.genome, score: cloner.evaluate(mutation.genome) });
  }
  population.sort((a, b) => b.score - a.score);
  const elite = population[0];
  const improved = elite.score > state.score;
  return {
    ...state,
    mode: "population",
    populationSize: size,
    population,
    genome: improved ? { ...elite.genome } : state.genome,
    score: improved ? elite.score : state.score,
  };
}

export function advancePopulation(
  cloner: Cloner,
  state: EvolutionState,
  rng: Rng,
): EvolutionState {
  const size = clamp(Math.round(state.populationSize ?? state.population?.length ?? 6), 2, 24);
  const retained: PopulationMember = { genome: { ...state.genome }, score: state.score };
  const pool = (state.population ?? [retained]).map((member) => ({
    genome: { ...member.genome },
    score: member.score,
  }));
  if (!pool.length) pool.push(retained);
  const next: PopulationMember[] = [retained];
  while (next.length < size) {
    const left = tournament(pool, rng);
    const right = tournament(pool, rng);
    const crossed = rng() < 0.7 ? crossoverGenomes(left.genome, right.genome, rng) : { ...left.genome };
    const mutation = cloner.mutate(crossed, rng);
    next.push({ genome: mutation.genome, score: cloner.evaluate(mutation.genome) });
  }
  next.sort((a, b) => b.score - a.score);
  const elite = next[0];
  const improved = elite.score > state.score;
  const attempts = state.attempts + 1;
  const score = improved ? elite.score : state.score;
  const genome = improved ? { ...elite.genome } : state.genome;
  return {
    seed: state.seed,
    genome,
    baseline: state.baseline,
    score,
    attempts,
    accepted: state.accepted + (improved ? 1 : 0),
    mode: "population",
    populationSize: size,
    population: next,
    history: [
      ...state.history,
      {
        attempt: attempts,
        score: meanScore(next),
        best: score,
        accepted: improved,
        change: eliteChange(cloner, state.genome, genome),
      },
    ],
  };
}
