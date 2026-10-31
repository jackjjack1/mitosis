import { describe, expect, it } from "vitest";
import { advanceEvolution, startEvolution } from "./evolve";
import type { EvolutionState } from "./evolve";
import {
  CLONE_FORMAT_ID,
  CLONE_FORMAT_VERSION,
  CLONE_MAGIC,
  CloneFormatError,
  decodeCloneSession,
  encodeCloneSession,
  isCloneSession,
  sessionFilename,
} from "./session";
import type { CloneSession } from "./session";

function evolution(): EvolutionState {
  return {
    seed: { order: 1, temperature: 0.95 },
    genome: { order: 3, temperature: 0.8 },
    baseline: 0.41,
    score: 0.73,
    attempts: 4,
    accepted: 2,
    history: [
      { attempt: 0, score: 0.41, best: 0.41, accepted: true, change: "seed" },
      {
        attempt: 1,
        score: 0.2,
        best: 0.41,
        accepted: false,
        change: "temperature 0.95 → 1.10",
      },
      {
        attempt: 4,
        score: 0.73,
        best: 0.73,
        accepted: true,
        change: "context order 1 → 3",
      },
    ],
  };
}

function session(bytes: Uint8Array = new Uint8Array([0, 255, 10, 13])): CloneSession {
  return {
    version: 1,
    savedAt: 1_700_000_000_000,
    specimen: {
      name: "plate.png",
      mime: "image/png",
      bytes,
    },
    evolution: evolution(),
  };
}

describe(".clone session format v1", () => {
  it("round-trips the specimen bytes and the evolution snapshot", () => {
    const specimen = new Uint8Array([0, 1, 2, 255, 10, 13, 0]);
    const encoded = encodeCloneSession(session(specimen));
    const decoded = decodeCloneSession(encoded);

    expect(decoded.version).toBe(1);
    expect(decoded.savedAt).toBe(1_700_000_000_000);
    expect(decoded.specimen.name).toBe("plate.png");
    expect(decoded.specimen.mime).toBe("image/png");
    expect(Array.from(decoded.specimen.bytes)).toEqual(Array.from(specimen));
    expect(decoded.evolution).toEqual(evolution());
    expect(isCloneSession(encoded)).toBe(true);
  });

  it("writes the magic, version, and format id where a reader can find them", () => {
    const encoded = encodeCloneSession(session());
    expect(new TextDecoder().decode(encoded.subarray(0, 8))).toBe(CLONE_MAGIC);
    expect(new DataView(encoded.buffer).getUint16(8, true)).toBe(CLONE_FORMAT_VERSION);

    const headerLength = new DataView(encoded.buffer).getUint32(12, true);
    const header = JSON.parse(
      new TextDecoder().decode(encoded.subarray(16, 16 + headerLength)),
    ) as { format: string; version: number; specimen: { size: number } };
    expect(header.format).toBe(CLONE_FORMAT_ID);
    expect(header.version).toBe(1);
    expect(header.specimen.size).toBe(4);
    expect(encoded.length).toBe(16 + headerLength + 4);
  });

  it("names the download after the specimen", () => {
    expect(sessionFilename("plate.png")).toBe("plate.clone");
    expect(sessionFilename("notes")).toBe("notes.clone");
  });

  it("rejects a file that is not a session", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(isCloneSession(png)).toBe(false);
    expect(() => decodeCloneSession(png)).toThrow(CloneFormatError);
  });

  it("rejects a truncated header", () => {
    const encoded = encodeCloneSession(session());
    expect(() => decodeCloneSession(encoded.subarray(0, 20))).toThrow(/truncated/i);
  });

  it("rejects a future format version instead of guessing", () => {
    const encoded = encodeCloneSession(session());
    const view = new DataView(encoded.buffer);
    view.setUint16(8, 2, true);
    const headerLength = view.getUint32(12, true);
    const header = JSON.parse(
      new TextDecoder().decode(encoded.subarray(16, 16 + headerLength)),
    ) as { version: number };
    header.version = 2;
    const nextHeader = new TextEncoder().encode(JSON.stringify(header));
    const payload = encoded.subarray(16 + headerLength);
    const rebuilt = new Uint8Array(16 + nextHeader.length + payload.length);
    rebuilt.set(encoded.subarray(0, 12), 0);
    new DataView(rebuilt.buffer).setUint32(12, nextHeader.length, true);
    rebuilt.set(nextHeader, 16);
    rebuilt.set(payload, 16 + nextHeader.length);

    expect(() => decodeCloneSession(rebuilt)).toThrow(/version 2/);
  });

  it("rejects a payload whose length does not match the header", () => {
    const encoded = encodeCloneSession(session());
    const truncated = encoded.subarray(0, encoded.length - 1);
    expect(() => decodeCloneSession(truncated)).toThrow(/size/i);
  });

  it("keeps unknown header fields from breaking a version-1 reader", () => {
    const encoded = encodeCloneSession(session());
    const view = new DataView(encoded.buffer);
    const headerLength = view.getUint32(12, true);
    const header = JSON.parse(
      new TextDecoder().decode(encoded.subarray(16, 16 + headerLength)),
    ) as Record<string, unknown>;
    header.note = "stage 7 description";
    header.population = 8;
    const nextHeader = new TextEncoder().encode(JSON.stringify(header));
    const payload = encoded.subarray(16 + headerLength);
    const rebuilt = new Uint8Array(16 + nextHeader.length + payload.length);
    rebuilt.set(encoded.subarray(0, 12));
    new DataView(rebuilt.buffer).setUint32(12, nextHeader.length, true);
    rebuilt.set(nextHeader, 16);
    rebuilt.set(payload, 16 + nextHeader.length);

    const decoded = decodeCloneSession(rebuilt);
    expect(decoded.specimen.name).toBe("plate.png");
    expect(decoded.evolution.score).toBe(0.73);
  });

  it("rejects unsupported payload flags", () => {
    const encoded = encodeCloneSession(session());
    new DataView(encoded.buffer).setUint16(10, 1, true);
    expect(() => decodeCloneSession(encoded)).toThrow(/flag/i);
  });

  it("can store a live evolution run", () => {
    const state = startEvolution(
      {
        kind: "text",
        defaults: { n: 1 },
        evaluate: (genome) => genome.n,
        materialize: (genome) => ({ score: genome.n, text: "x", facts: [] }),
        mutate: () => ({ genome: { n: 2 }, changed: "n 1 → 2" }),
        describe: () => [],
        reflect: () => "learned",
      },
      { n: 1 },
    );
    const advanced = advanceEvolution(
      {
        kind: "text",
        defaults: { n: 1 },
        evaluate: (genome) => genome.n,
        materialize: (genome) => ({ score: genome.n, text: "x", facts: [] }),
        mutate: () => ({ genome: { n: 2 }, changed: "n 1 → 2" }),
        describe: () => [],
        reflect: () => "learned",
      },
      state,
      () => 0,
    );
    const encoded = encodeCloneSession({
      version: 1,
      savedAt: 10,
      specimen: { name: "a.txt", mime: "text/plain", bytes: new Uint8Array([97]) },
      evolution: advanced,
    });
    expect(decodeCloneSession(encoded).evolution.history).toHaveLength(2);
    expect(decodeCloneSession(encoded).evolution.score).toBe(2);
  });
});
