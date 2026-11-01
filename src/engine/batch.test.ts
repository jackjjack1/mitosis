import { describe, expect, it } from "vitest";
import { batchEntries, batchReportMarkdown, runBatch } from "./batch";
import { emptyMind } from "./memory";
import { decodeCloneSession } from "./session";
import { readZip } from "./sheet";
import { zipStore } from "../features/zip";
import { arrayBufferOf } from "./util";

function csv(name: string, rows: string): File {
  return new File([rows], name, { type: "text/csv" });
}

describe("batch mode", () => {
  it("writes one .clone per file and seeds the later file from memory", async () => {
    const first = csv("alpha.csv", "trial,mass\n01,1\n02,2\n03,3\n04,4\n");
    const second = csv("beta.csv", "trial,mass\n01,5\n02,6\n03,7\n04,8\n");
    const result = await runBatch([first, second], emptyMind(), { generations: 2, population: 3 });

    expect(result.rows.map((row) => row.name)).toEqual(["alpha.csv", "beta.csv"]);
    expect(result.rows[0].seededFrom).toBeNull();
    expect(result.rows[1].seededFrom).toBe("alpha.csv");
    expect(result.rows[0].cloneFile).toBe("alpha.clone");
    expect(result.rows.every((row) => row.attempts === 2)).toBe(true);
    expect(result.rows.every((row) => row.score >= row.baseline)).toBe(true);
    expect(result.mind.memories).toHaveLength(2);

    const session = decodeCloneSession(result.files[0].bytes);
    expect(session.specimen.name).toBe("alpha.csv");
    expect(session.evolution.attempts).toBe(2);

    const report = batchReportMarkdown(result.rows);
    expect(report).toContain("alpha.csv");
    expect(report).toContain("beta.csv");
    expect(report).toContain("alpha.clone");

    const zip = new Uint8Array(await zipStore(batchEntries(result)).arrayBuffer());
    const entries = await readZip(zip);
    expect(entries.has("alpha.clone")).toBe(true);
    expect(entries.has("beta.clone")).toBe(true);
    expect(entries.has("batch-report.md")).toBe(true);
    expect(entries.has("batch-report.json")).toBe(true);
    const archived = decodeCloneSession(entries.get("alpha.clone") ?? new Uint8Array());
    expect(archived.specimen.name).toBe("alpha.csv");
    expect(new TextDecoder().decode(entries.get("batch-report.md") ?? new Uint8Array())).toContain(
      "alpha.csv",
    );
  });

  it("keeps going when one file cannot be read", async () => {
    const empty = new File([arrayBufferOf(new Uint8Array())], "empty.csv", { type: "text/csv" });
    const ok = csv("ok.csv", "trial,mass\n01,1\n02,2\n03,3\n04,4\n");
    const result = await runBatch([empty, ok], emptyMind(), { generations: 1, population: 2 });
    expect(result.rows[0].error).toBeTruthy();
    expect(result.rows[1].cloneFile).toBe("ok.clone");
    expect(result.files).toHaveLength(1);
  });
});
