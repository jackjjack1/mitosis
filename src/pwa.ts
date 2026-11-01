/** Register the offline worker only for http(s). The Mac app loads over file://. */
export function shouldRegisterServiceWorker(protocol: string): boolean {
  return protocol === "https:" || protocol === "http:";
}

/** iOS Safari has no folder picker. Fall back to the multi-file input. */
export function pickTarget(folderSupported: boolean): "folder" | "files" {
  return folderSupported ? "folder" : "files";
}

export function registerAppWorker(target: {
  navigator: Navigator;
  location: { protocol: string };
}): void {
  if (!("serviceWorker" in target.navigator)) return;
  if (!shouldRegisterServiceWorker(target.location.protocol)) return;
  void target.navigator.serviceWorker.register("./sw.js");
}
