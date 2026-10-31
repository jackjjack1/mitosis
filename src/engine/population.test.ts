import { describe, expect, it } from "vitest";
import { createTextCloner } from "./text";
import {
  advanceEvolution,
  advancePopulation,
  crossoverGenomes,
  startEvolution,
  startPopulation,
} from "./evolve";
import { decodeCloneSession, encodeCloneSession } from "./session";
import type { Artifact, Cloner, Rng } from "./types";

function scripted(): Cloner {
  return {
    kind: "text",
    defaults: { n: 1, k: 0 },
    evaluate: (genome) => genome.n,
    materialize: (genome) => ({ score: genome.n, text: String(genome.n), facts: [] }),
    mutate: (genome, rng) => {
      const delta = rng() < 0.75 ? 1 : -0.25;
      return {
        genome: { n: genome.n + delta, k: genome.k },
        changed: `n ${genome.n} → ${genome.n + delta}`,
      };
    },
    describe: (genome) => [
      { key: "n", label: "N", value: String(genome.n), raw: genome.n, min: 0, max: 20 },
    ],
    reflect: () => "population reflected",
  };
}

function sequence(values: number[]): Rng {
  let index = 0;
  return () => values[index++] ?? 0.1;
}

describe("population search", () => {
  it("blends numeric genes and keeps the others", () => {
    const child = crossoverGenomes({ n: 2, k: 4 }, { n: 8, k: 0 }, sequence([0.9, 0.1]));
    expect(child.n).toBe(5);
    expect(child.k).toBe(4);
  });

  it("keeps the hill climb available", () => {
    const cloner = scripted();
    let state = startEvolution(cloner);
    state = advanceEvolution(cloner, state, () => 0.1);
    expect(state.score).toBe(2);
    expect(state.mode).toBeUndefined();
  });

  it("never lowers the elite and records the population mean", () => {
    const cloner = scripted();
    let state = startPopulation(cloner, { size: 4 }, () => 0.1);
    expect(state.mode).toBe("population");
    expect(state.population).toHaveLength(4);
    expect(state.score).toBeGreaterThanOrEqual(state.baseline);
    const before = state.score;
    state = advancePopulation(cloner, state, () => 0.1);
    expect(state.attempts).toBe(1);
    expect(state.score).toBeGreaterThanOrEqual(before);
    expect(state.history).toHaveLength(2);
    expect(state.history[1].best).toBe(state.score);
    expect(state.history[1].score).toBeLessThanOrEqual(state.score);
    const mean = state.population!.reduce((sum, member) => sum + member.score, 0) / state.population!.length;
    expect(state.history[1].score).toBeCloseTo(mean, 5);
    expect(state.population!.every((member) => member.score <= state.score)).toBe(true);
  });

  it("round-trips a population through a version-1 session", () => {
    const cloner = scripted();
    const state = advancePopulation(
      cloner,
      startPopulation(cloner, { size: 3 }, () => 0.2),
      () => 0.2,
    );
    const encoded = encodeCloneSession({
      version: 1,
      savedAt: 5,
      specimen: { name: "a.txt", mime: "text/plain", bytes: new Uint8Array([97]) },
      evolution: state,
    });
    const decoded = decodeCloneSession(encoded);
    expect(decoded.evolution.mode).toBe("population");
    expect(decoded.evolution.populationSize).toBe(3);
    expect(decoded.evolution.population).toHaveLength(3);
    expect(decoded.evolution.genome).toEqual(state.genome);
    expect(decoded.evolution.history).toHaveLength(state.history.length);
  });

  it("hill-climbs a text cloner with a population without dropping the elite", () => {
    const sample = "the cell divides the cell remembers the cell divides again and again";
    const artifact: Artifact = {
      name: "cell.txt",
      size: sample.length,
      mime: "text/plain",
      kind: "text",
      format: "TEXT",
      magic: "—",
      hash: "cell-pop",
      entropy: 3,
      notes: [],
      text: { sample, lines: 1, words: 12, uniques: 8 },
    };
    const cloner = createTextCloner(artifact);
    let state = startPopulation(cloner, { size: 4 }, () => 0.3);
    for (let i = 0; i < 3; i++) state = advancePopulation(cloner, state, () => 0.4);
    expect(state.score).toBeGreaterThanOrEqual(state.baseline);
    const best = state.history.map((point) => point.best);
    for (let i = 1; i < best.length; i++) expect(best[i]).toBeGreaterThanOrEqual(best[i - 1]);
  });
});
