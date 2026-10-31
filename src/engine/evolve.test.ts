import { describe, expect, it } from "vitest";
import { createTextCloner } from "./text";
import { advanceEvolution, startEvolution } from "./evolve";
import type { Cloner } from "./types";
import type { Artifact } from "./types";

function scripted(scores: number[]): Cloner {
  let index = 0;
  return {
    kind: "text",
    defaults: { n: 1 },
    evaluate: (genome) => genome.n,
    materialize: (genome) => ({ score: genome.n, text: String(genome.n), facts: [] }),
    mutate: (genome) => {
      const next = scores[index++] ?? genome.n;
      return { genome: { n: next }, changed: `n ${genome.n} → ${next}` };
    },
    describe: () => [],
    reflect: (seed, best, baseline, score) =>
      `seed ${seed.n} best ${best.n} ${baseline} ${score}`,
  };
}

describe("evolution stepper", () => {
  it("starts from the cloner defaults and records the seed score", () => {
    const state = startEvolution(scripted([]));
    expect(state.genome).toEqual({ n: 1 });
    expect(state.seed).toEqual({ n: 1 });
    expect(state.baseline).toBe(1);
    expect(state.score).toBe(1);
    expect(state.attempts).toBe(0);
    expect(state.accepted).toBe(0);
    expect(state.history).toEqual([
      { attempt: 0, score: 1, best: 1, accepted: true, change: "seed" },
    ]);
  });

  it("can start from a supplied genome without changing the defaults", () => {
    const state = startEvolution(scripted([]), { n: 4 });
    expect(state.genome).toEqual({ n: 4 });
    expect(state.baseline).toBe(4);
    expect(state.seed).toEqual({ n: 4 });
  });

  it("keeps a better genome and rejects a worse or equal one", () => {
    const cloner = scripted([0.4, 1, 3]);
    let state = startEvolution(cloner);

    state = advanceEvolution(cloner, state, () => 0);
    expect(state.score).toBe(1);
    expect(state.genome).toEqual({ n: 1 });
    expect(state.accepted).toBe(0);
    expect(state.history[1]).toMatchObject({
      attempt: 1,
      score: 0.4,
      best: 1,
      accepted: false,
      change: "n 1 → 0.4",
    });

    state = advanceEvolution(cloner, state, () => 0);
    expect(state.score).toBe(1);
    expect(state.accepted).toBe(0);
    expect(state.history[2].accepted).toBe(false);

    state = advanceEvolution(cloner, state, () => 0);
    expect(state.score).toBe(3);
    expect(state.genome).toEqual({ n: 3 });
    expect(state.accepted).toBe(1);
    expect(state.attempts).toBe(3);
    expect(state.baseline).toBe(1);
    expect(state.seed).toEqual({ n: 1 });
    expect(state.history.map((point) => point.best)).toEqual([1, 1, 1, 3]);
  });

  it("hill-climbs a real text cloner without lowering the best score", () => {
    const sample = "the cell divides the cell remembers the cell divides again and again";
    const artifact: Artifact = {
      name: "cell.txt",
      size: sample.length,
      mime: "text/plain",
      kind: "text",
      format: "TEXT",
      magic: "—",
      hash: "cell",
      entropy: 3,
      notes: [],
      text: { sample, lines: 1, words: 12, uniques: 8 },
    };
    const cloner = createTextCloner(artifact);
    let state = startEvolution(cloner);
    const rng = () => 0.2;
    for (let i = 0; i < 12; i++) state = advanceEvolution(cloner, state, rng);

    expect(state.attempts).toBe(12);
    expect(state.history).toHaveLength(13);
    expect(state.score).toBeGreaterThanOrEqual(state.baseline);
    const best = state.history.map((point) => point.best);
    for (let i = 1; i < best.length; i++) expect(best[i]).toBeGreaterThanOrEqual(best[i - 1]);
    expect(state.accepted).toBe(state.history.filter((point) => point.accepted && point.attempt > 0).length);
    expect(cloner.reflect(state.seed, state.genome, state.baseline, state.score).length).toBeGreaterThan(0);
  });
});
