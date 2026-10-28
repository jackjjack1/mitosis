import fs from "node:fs";
import path from "node:path";

const distDir = "dist";
const outputDir = process.argv[2] ?? "build/desktop/web";
const indexPath = path.join(distDir, "index.html");

let html = fs.readFileSync(indexPath, "utf8");

function assetPath(reference) {
  return path.join(distDir, reference.replace(/^\.\//, "").replace(/^\//, ""));
}

html = html.replace(
  /<script\b([^>]*?)\bsrc="([^"]+)"([^>]*)><\/script>/g,
  (match, before, src, after) => {
    if (!src.startsWith(".") && !src.startsWith("/")) return match;
    const attributes = `${before}${after}`;
    if (/\btype="module"/.test(attributes)) {
      const javascript = fs.readFileSync(assetPath(src), "utf8");
      return `<script type="module">\n${javascript.replace(
        /<\/script/gi,
        "<\\/script",
      )}\n</script>`;
    }
    return match;
  },
);

html = html.replace(
  /<link\b([^>]*?)\bhref="([^"]+)"([^>]*)>/g,
  (match, before, href, after) => {
    const attributes = `${before}${after}`;
    const isLocal = href.startsWith(".") || href.startsWith("/");
    if (/\brel="stylesheet"/.test(attributes) && isLocal) {
      const css = fs.readFileSync(assetPath(href), "utf8");
      return `<style>\n${css}\n</style>`;
    }
    return match;
  },
);

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "index.html"), html);

const external = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
  (match) => match[1],
);
console.log(
  `inlined build → ${outputDir}/index.html (${(html.length / 1024).toFixed(1)} KB)`,
);
if (external.length) {
  console.log(`external references remain: ${external.join(", ")}`);
}
