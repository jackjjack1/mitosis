import { describe, expect, it } from "vitest";
import { createBinaryCloner } from "./binary";
import { createTextCloner } from "./text";
import { exportReconstruction, reconstructionFilename } from "./export";
import type { Artifact, CloneOutput } from "./types";

function textArtifact(name: string, sample: string): Artifact {
  return {
    name,
    size: sample.length,
    mime: "text/plain",
    kind: "text",
    format: "TEXT",
    magic: "—",
    hash: "text-hash",
    entropy: 1,
    notes: [],
    text: { sample, lines: 1, words: 4, uniques: 4 },
  };
}

function binaryArtifact(): Artifact {
  const sample = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  return {
    name: "payload.dat",
    size: sample.length,
    mime: "application/octet-stream",
    kind: "binary",
    format: "DATA",
    magic: "00 01",
    hash: "bin-hash",
    entropy: 2,
    notes: [],
    binary: {
      sample,
      histogram: Array.from({ length: 256 }, (_, index) => (index < 12 ? 1 : 0)),
      entropyBlocks: [2],
      entropyBlockSize: 4096,
      strings: [],
      sections: [],
      headerInfo: [],
    },
  };
}

describe("reconstruction export", () => {
  it("names each kind with the file type a person can open", () => {
    expect(reconstructionFilename("image", "photo.png")).toBe("photo-clone.png");
    expect(reconstructionFilename("text", "notes.md")).toBe("notes-clone.txt");
    expect(reconstructionFilename("binary", "payload.dat")).toBe("payload-clone.bin");
  });

  it("exports text as UTF-8 .txt", () => {
    const artifact = textArtifact("notes.md", "alpha beta gamma delta epsilon zeta eta theta");
    const output = createTextCloner(artifact).materialize({ order: 2, temperature: 0.8, lengthRatio: 1 });
    const file = exportReconstruction("text", artifact.name, output);

    expect(file.filename).toBe("notes-clone.txt");
    expect(file.mime).toBe("text/plain");
    expect(output.filename).toBe("notes-clone.txt");
    expect(new TextDecoder().decode(file.bytes)).toBe(output.text);
  });

  it("exports binary bytes as .bin and does not use the .clone session type", () => {
    const artifact = binaryArtifact();
    const output = createBinaryCloner(artifact).materialize({ order: 1, blend: 0.4, prefix: 4 });
    const file = exportReconstruction("binary", artifact.name, output);

    expect(file.filename).toBe("payload-clone.bin");
    expect(file.mime).toBe("application/octet-stream");
    expect(output.filename).toBe("payload-clone.bin");
    expect(output.mime).toBe("application/octet-stream");
    expect(file.filename.endsWith(".clone")).toBe(false);
    expect(Array.from(file.bytes)).toEqual(Array.from(output.bytes ?? []));
  });

  it("exports an image data URL as PNG bytes", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    let binary = "";
    for (const byte of png) binary += String.fromCharCode(byte);
    const output: CloneOutput = {
      score: 0.5,
      dataUrl: `data:image/png;base64,${btoa(binary)}`,
      facts: [],
    };
    const file = exportReconstruction("image", "cell.png", output);
    expect(file.filename).toBe("cell-clone.png");
    expect(file.mime).toBe("image/png");
    expect(Array.from(file.bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("refuses an image clone that is not a PNG data URL", () => {
    const output: CloneOutput = {
      score: 0.2,
      dataUrl: "data:text/plain,hello",
      facts: [],
    };
    expect(() => exportReconstruction("image", "cell.png", output)).toThrow(/png/i);
  });
});
