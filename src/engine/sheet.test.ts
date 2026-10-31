import { describe, expect, it } from "vitest";
import { dissectFile } from "./dissect";
import { exportReconstruction } from "./export";
import { createSheetCloner, parseCsv, parseXlsx } from "./sheet";

function storedZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const encoder = new TextEncoder();
  for (const file of files) {
    const name = encoder.encode(file.name);
    const local = new Uint8Array(30 + name.length + file.data.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(8, 0, true);
    view.setUint32(18, file.data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(file.data, 30 + name.length);
    parts.push(local);

    const entry = new Uint8Array(46 + name.length);
    const centralView = new DataView(entry.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);
    offset += local.length;
  }
  const centralOffset = offset;
  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, centralOffset, true);
  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...parts, ...central, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

describe("spreadsheet cloner", () => {
  it("parses quoted CSV fields", () => {
    const table = parseCsv('name,note,value\nalpha,"hello, lab",1.5\nbeta,plain,2\n');
    expect(table.headers).toEqual(["name", "note", "value"]);
    expect(table.rows).toEqual([
      ["alpha", "hello, lab", "1.5"],
      ["beta", "plain", "2"],
    ]);
  });

  it("reads a stored xlsx sheet", async () => {
    const encoder = new TextEncoder();
    const zip = storedZip([
      {
        name: "xl/sharedStrings.xml",
        data: encoder.encode(
          "<sst><si><t>name</t></si><si><t>alpha</t></si><si><t>beta</t></si></sst>",
        ),
      },
      {
        name: "xl/worksheets/sheet1.xml",
        data: encoder.encode(
          '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>1</v></c></row><row><c r="A2" t="s"><v>1</v></c><c r="B2"><v>2.5</v></c></row><row><c r="A3" t="s"><v>2</v></c><c r="B3"><v>4</v></c></row></sheetData></worksheet>',
        ),
      },
    ]);
    const table = await parseXlsx(zip);
    expect(table.headers).toEqual(["name", "1"]);
    expect(table.rows[0]).toEqual(["alpha", "2.5"]);
    expect(table.rows).toHaveLength(2);
  });

  it("dissects a CSV and exports a CSV reconstruction with the same header", async () => {
    const csv = "name,mass\nalpha,1\nbeta,2\ngamma,3\ndelta,4\n";
    const file = new File([csv], "cells.csv", { type: "text/csv" });
    const artifact = await dissectFile(file);
    expect(artifact.kind).toBe("sheet");
    expect(artifact.format).toBe("CSV");
    expect(artifact.sheet?.headers).toEqual(["name", "mass"]);
    expect(artifact.sheet?.rows).toHaveLength(4);

    const cloner = createSheetCloner(artifact);
    const output = cloner.materialize({ spread: 0, shift: 0, rowRatio: 1, temperature: 0.2 });
    expect(output.filename).toBe("cells-clone.csv");
    expect(output.mime).toBe("text/csv");
    expect(output.table?.headers).toEqual(["name", "mass"]);
    expect(output.table?.rows.length).toBe(4);

    const exported = exportReconstruction("sheet", artifact.name, output);
    expect(exported.filename).toBe("cells-clone.csv");
    expect(exported.mime).toBe("text/csv");
    const parsed = parseCsv(new TextDecoder().decode(exported.bytes));
    expect(parsed.headers).toEqual(["name", "mass"]);
    expect(parsed.rows).toHaveLength(4);
    const masses = parsed.rows.map((row) => Number(row[1]));
    expect(masses.every((value) => value >= 0.5 && value <= 4.5)).toBe(true);
  });

  it("leaves identifier columns with leading zeros alone", () => {
    const artifact = {
      name: "trials.csv",
      size: 40,
      mime: "text/csv",
      kind: "sheet" as const,
      format: "CSV",
      magic: "—",
      hash: "trials",
      entropy: 1,
      notes: [],
      sheet: {
        format: "CSV",
        headers: ["trial", "mass"],
        rows: [
          ["01", "1.2"],
          ["02", "1.8"],
          ["03", "2.1"],
          ["04", "2.6"],
        ],
      },
    };
    const output = createSheetCloner(artifact).materialize({
      spread: 0.8,
      shift: 0,
      rowRatio: 1,
      temperature: 0.2,
    });
    expect(output.table?.rows.map((row) => row[0])).toEqual(["01", "02", "03", "04"]);
  });
});
