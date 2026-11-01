import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pickTarget, shouldRegisterServiceWorker } from "./pwa";

const root = new URL("../", import.meta.url);

describe("installable phone build", () => {
  it("registers a worker on the web and skips the file-based Mac app", () => {
    expect(shouldRegisterServiceWorker("https:")).toBe(true);
    expect(shouldRegisterServiceWorker("http:")).toBe(true);
    expect(shouldRegisterServiceWorker("file:")).toBe(false);
  });

  it("uses the file picker when a folder picker is unavailable", () => {
    expect(pickTarget(true)).toBe("folder");
    expect(pickTarget(false)).toBe("files");
  });

  it("points iOS at a standalone manifest and home-screen icon", () => {
    const html = readFileSync(new URL("index.html", root), "utf8");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("manifest.webmanifest");
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-title" content="MITOSIS"');
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain("apple-touch-icon");

    const manifest = JSON.parse(readFileSync(new URL("public/manifest.webmanifest", root), "utf8")) as {
      name: string;
      display: string;
      start_url: string;
      icons: { sizes: string }[];
    };
    expect(manifest.name).toBe("MITOSIS");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("./");
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
  });

  it("caches the shell for offline use", () => {
    const worker = readFileSync(new URL("public/sw.js", root), "utf8");
    expect(worker).toContain("install");
    expect(worker).toContain("fetch");
    expect(worker).toContain("caches");
    expect(worker).toContain("./index.html");
  });

  it("collapses the sidebar into a bottom tab bar", () => {
    const css = readFileSync(new URL("src/styles.css", root), "utf8");
    expect(css).toContain("mobile-tab-bar");
    expect(css).toContain("safe-area-inset-bottom");
    expect(css).toContain("min-height: 48px");
  });

  it("deploys the Vite build as static files", () => {
    const config = JSON.parse(readFileSync(new URL("vercel.json", root), "utf8")) as {
      buildCommand: string;
      outputDirectory: string;
    };
    expect(config.buildCommand).toBe("npm run build");
    expect(config.outputDirectory).toBe("dist");
  });
});
