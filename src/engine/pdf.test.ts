import { describe, expect, it } from "vitest";
import { dissectFile } from "./dissect";
import { arrayBufferOf } from "./util";
import { exportReconstruction } from "./export";
import { createPdfCloner, extractPdfText } from "./pdf";

function pdfWithText(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe("pdf cloner", () => {
  it("reads page text from an uncompressed PDF", async () => {
    const bytes = pdfWithText("Hello mitosis table cell");
    const read = await extractPdfText(bytes);
    expect(read.pages).toBe(1);
    expect(read.text).toContain("Hello mitosis table cell");
  });

  it("dissects a PDF and exports a PDF reconstruction", async () => {
    const bytes = pdfWithText("The cell divides and the table holds");
    const file = new File([arrayBufferOf(bytes)], "notes.pdf", { type: "application/pdf" });
    const artifact = await dissectFile(file);
    expect(artifact.kind).toBe("pdf");
    expect(artifact.format).toBe("PDF");
    expect(artifact.pdf?.text).toContain("cell divides");
    expect(artifact.pdf?.pages).toBe(1);

    const cloner = createPdfCloner(artifact);
    const output = cloner.materialize(cloner.defaults);
    expect(output.filename).toBe("notes-clone.pdf");
    expect(output.mime).toBe("application/pdf");
    expect(output.text?.length).toBeGreaterThan(0);

    const exported = exportReconstruction("pdf", artifact.name, output);
    expect(exported.filename).toBe("notes-clone.pdf");
    expect(exported.mime).toBe("application/pdf");
    expect(new TextDecoder().decode(exported.bytes.subarray(0, 5))).toBe("%PDF-");
    const reread = await extractPdfText(exported.bytes);
    expect(reread.text.toLowerCase()).toMatch(/cell|table|divides|holds/);
  });
});
