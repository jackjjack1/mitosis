/**
 * Save the original file bytes, not a statistical reconstruction.
 *
 * This is the browser-side exact-copy path. Directories and .app bundles must
 * be copied by the host application (MITOSIS uses its native File menu action).
 */
export function saveExact(file: File, filename = file.name || "artifact"): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 600);
}

/** Read every byte of the original file, without MITOSIS's 8 MB analysis cap. */
export async function readExact(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
