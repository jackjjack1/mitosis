import type { FeatureSet } from "../engine/features";
import { zipStore } from "./zip";

export function buildFeatureBundle(set: FeatureSet): Blob {
  const encoder = new TextEncoder();
  return zipStore(
    set.files.map((file) => ({
      name: file.name,
      data: encoder.encode(file.content),
    })),
  );
}

export function featureBundleName(set: FeatureSet): string {
  return `${set.base}-features.zip`;
}

export function downloadFeatureBundle(set: FeatureSet): void {
  const url = URL.createObjectURL(buildFeatureBundle(set));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = featureBundleName(set);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 600);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
