import type { CloneOutput, Kind } from "./types";
import { baseName } from "./util";

/** Download names for a reconstructed clone. The `.clone` extension is reserved for sessions. */
export const RECONSTRUCTION_EXT: Record<Kind, string> = {
  image: ".png",
  text: ".txt",
  binary: ".bin",
};

export const RECONSTRUCTION_MIME: Record<Kind, string> = {
  image: "image/png",
  text: "text/plain",
  binary: "application/octet-stream",
};

export interface ExportedFile {
  filename: string;
  mime: string;
  bytes: Uint8Array;
}

export function reconstructionFilename(kind: Kind, artifactName: string): string {
  return `${baseName(artifactName)}-clone${RECONSTRUCTION_EXT[kind]}`;
}

export function exportReconstruction(
  kind: Kind,
  artifactName: string,
  output: CloneOutput,
): ExportedFile {
  const filename = reconstructionFilename(kind, artifactName);
  const mime = RECONSTRUCTION_MIME[kind];
  if (kind === "text") {
    return { filename, mime, bytes: new TextEncoder().encode(output.text ?? "") };
  }
  if (kind === "binary") {
    if (!output.bytes) throw new Error("Binary clone has no bytes to export");
    return { filename, mime, bytes: output.bytes };
  }
  if (!output.dataUrl) throw new Error("Image clone has no PNG to export");
  return { filename, mime, bytes: decodePngDataUrl(output.dataUrl) };
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime: string): void {
  const blob = new Blob([Uint8Array.from(bytes)], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 600);
}

function decodePngDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Image clone is not a PNG data URL");
  const meta = dataUrl.slice(0, comma);
  if (!meta.startsWith("data:image/png")) {
    throw new Error("Image clone must be a PNG");
  }
  const payload = dataUrl.slice(comma + 1);
  if (!meta.includes(";base64")) {
    throw new Error("Image clone must be a base64 PNG");
  }
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
