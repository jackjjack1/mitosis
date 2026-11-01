import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { manifestDocument, pickTarget, PAGES_BASE, serviceWorkerSource, shouldRegisterServiceWorker } from "./pwa";

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

  it("scopes the installed app to the GitHub Pages subpath", () => {
    const manifest = manifestDocument(PAGES_BASE);
    expect(manifest.start_url).toBe("/mitosis/");
    expect(manifest.scope).toBe("/mitosis/");
    expect(manifest.icons[0].src).toBe("/mitosis/icons/icon-192.png");

    const worker = serviceWorkerSource(PAGES_BASE);
    expect(worker).toContain('"/mitosis/"');
    expect(worker).toContain("/mitosis/index.html");
    expect(worker).not.toContain('"./index.html"');
  });

  it("deploys dist to GitHub Pages from main", () => {
    const workflow = readFileSync(new URL(".github/workflows/pages.yml", root), "utf8");
    expect(workflow).toContain("actions/deploy-pages@v4");
    expect(workflow).toContain("actions/upload-pages-artifact@v4");
    expect(workflow).toContain("VITE_BASE: /mitosis/");
    expect(workflow).toContain("branches:");
    expect(workflow).toContain("- main");
    const viteConfig = readFileSync(new URL("vite.config.ts", root), "utf8");
    expect(viteConfig).toContain("VITE_BASE");
  });
});
