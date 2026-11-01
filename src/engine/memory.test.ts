import { describe, expect, it } from "vitest";
import { startPopulation } from "./evolve";
import { createTextCloner } from "./text";
import {
  applyMindImport,
  decodeMindFile,
  emptyMind,
  encodeMindFile,
  isMindFile,
  mergeMinds,
  mindEtag,
  rememberRun,
  seedFromMemory,
} from "./memory";
import type { Artifact } from "./types";

function artifact(name: string, kind: Artifact["kind"], hash: string, format = "TEXT"): Artifact {
  return {
    name,
    size: 20,
    mime: "text/plain",
    kind,
    format,
    magic: "—",
    hash,
    entropy: 1,
    notes: [],
    text: { sample: "the cell divides the cell remembers the cell divides again", lines: 1, words: 9, uniques: 6 },
  };
}

describe("memory seeding and sync", () => {
  it("seeds startPopulation from the closest recalled genome", () => {
    const notes = artifact("notes.md", "text", "notes");
    const mind = rememberRun(emptyMind(), {
      artifact: notes,
      genome: { order: 4, temperature: 0.4, lengthRatio: 1 },
      baseline: 0.2,
      score: 0.8,
      accepted: 2,
      attempts: 5,
    });
    const seeded = seedFromMemory(mind, notes);
    expect(seeded?.source.name).toBe("notes.md");
    expect(seeded?.genome.order).toBe(4);

    const state = startPopulation(createTextCloner(notes), { size: 2, seed: seeded?.genome }, () => 0.4);
    expect(state.seed.order).toBe(4);
    expect(state.mode).toBe("population");
  });

  it("does not seed a different kind", () => {
    const notes = artifact("notes.md", "text", "notes");
    const mind = rememberRun(emptyMind(), {
      artifact: notes,
      genome: { order: 4, temperature: 0.4, lengthRatio: 1 },
      baseline: 0.2,
      score: 0.8,
      accepted: 1,
      attempts: 3,
    });
    const sheet = artifact("cells.csv", "sheet", "cells", "CSV");
    expect(seedFromMemory(mind, sheet)).toBeNull();
  });

  it("updates the same specimen on a later pause instead of counting it twice", () => {
    const notes = artifact("notes.md", "text", "notes");
    const first = rememberRun(emptyMind(), {
      artifact: notes,
      genome: { order: 2, temperature: 0.8, lengthRatio: 1 },
      baseline: 0.2,
      score: 0.5,
      accepted: 1,
      attempts: 4,
    });
    const second = rememberRun(first, {
      artifact: notes,
      genome: { order: 4, temperature: 0.4, lengthRatio: 1 },
      baseline: 0.2,
      score: 0.9,
      accepted: 3,
      attempts: 7,
    });
    expect(second.runs).toBe(1);
    expect(second.generations).toBe(7);
    expect(second.memories).toHaveLength(1);
    expect(second.memories[0].score).toBe(0.9);
    expect(second.memories[0].attempts).toBe(7);
    expect(second.best.text?.score).toBe(0.9);
  });

  it("round-trips a sync-ready mind file", () => {
    const notes = artifact("notes.md", "text", "notes");
    const mind = rememberRun(emptyMind(), {
      artifact: notes,
      genome: { order: 3, temperature: 0.5, lengthRatio: 1 },
      baseline: 0.1,
      score: 0.6,
      accepted: 1,
      attempts: 2,
    });
    const encoded = encodeMindFile(mind, { id: "bank-1", revision: 2 }, 50);
    expect(isMindFile(encoded)).toBe(true);
    expect(isMindFile(new TextEncoder().encode("hello"))).toBe(false);
    const decoded = decodeMindFile(encoded);
    expect(decoded.format).toBe("io.freebuff.mitosis.mind");
    expect(decoded.version).toBe(1);
    expect(decoded.sync).toEqual({ id: "bank-1", revision: 2, etag: mindEtag(mind) });
    expect(decoded.mind.memories[0].genome.order).toBe(3);
    expect(decoded.exportedAt).toBe(50);
  });

  it("merges by keeping the higher score and bumps the sync revision", () => {
    const notes = artifact("notes.md", "text", "notes");
    const local = rememberRun(emptyMind(), {
      artifact: notes,
      genome: { order: 5, temperature: 0.3, lengthRatio: 1 },
      baseline: 0.2,
      score: 0.9,
      accepted: 4,
      attempts: 8,
    });
    const incoming = rememberRun(emptyMind(), {
      artifact: notes,
      genome: { order: 1, temperature: 1, lengthRatio: 1 },
      baseline: 0.2,
      score: 0.2,
      accepted: 0,
      attempts: 1,
    });
    const other = artifact("tone.wav", "audio", "tone", "WAV");
    const withAudio = rememberRun(incoming, {
      artifact: other,
      genome: { bands: 8, noise: 0.1, smooth: 1, gain: 1 },
      baseline: 0.4,
      score: 0.7,
      accepted: 1,
      attempts: 3,
    });
    const merged = mergeMinds(local, withAudio);
    expect(merged.memories.find((memory) => memory.id.startsWith("text:"))?.score).toBe(0.9);
    expect(merged.memories.some((memory) => memory.kind === "audio")).toBe(true);

    const encoded = encodeMindFile(withAudio, { id: "bank-1", revision: 1 }, 10);
    const applied = applyMindImport(local, { id: "bank-1", revision: 4 }, decodeMindFile(encoded));
    expect(applied.mind.memories.find((memory) => memory.kind === "text")?.genome.order).toBe(5);
    expect(applied.sync).toEqual({ id: "bank-1", revision: 5 });
  });
});
