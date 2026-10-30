#!/usr/bin/env node
/**
 * Bumps the release version in every place it is written down.
 *
 * The app reports CFBundleShortVersionString from a hardcoded Info.plist value,
 * package.json names the version for npm, and the lockfile repeats it twice, so
 * a release used to mean editing three files by hand and hoping they agreed.
 * This writes all of them and then runs check-version.mjs to prove it.
 *
 * Usage:
 *   npm run release:prepare            # patch bump
 *   npm run release:prepare -- minor
 *   npm run release:prepare -- 0.2.3
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

const root = new URL("../", import.meta.url);
const pkgUrl = new URL("package.json", root);
const lockUrl = new URL("package-lock.json", root);
const plistUrl = new URL("desktop/Info.plist", root);

const pkg = JSON.parse(readFileSync(pkgUrl, "utf8"));
const current = String(pkg.version ?? "");
const currentMatch = SEMVER.exec(current);
if (!currentMatch) fail(`package.json reports "${current}", which is not X.Y.Z`);

const request = (process.argv[2] ?? "patch").trim();
let next;

if (request === "major" || request === "minor" || request === "patch") {
  const [major, minor, patch] = currentMatch.slice(1).map(Number);
  next =
    request === "major"
      ? `${major + 1}.0.0`
      : request === "minor"
        ? `${major}.${minor + 1}.0`
        : `${major}.${minor}.${patch + 1}`;
} else if (SEMVER.test(request)) {
  next = request;
} else {
  fail(`"${request}" is not patch, minor, major, or an X.Y.Z version`);
}

if (next === current) fail(`the version is already ${current}`);

if (hasTag(`v${next}`)) fail(`tag v${next} already exists — pick the next version`);

function hasTag(name) {
  try {
    const tags = execFileSync("git", ["tag", "--list", name], {
      cwd: fileURLToPath(root),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return tags.trim() !== "";
  } catch {
    // Not a git checkout, so there is nothing to collide with.
    return false;
  }
}

const plistText = readFileSync(plistUrl, "utf8");
const shortString = /(<key>CFBundleShortVersionString<\/key>\s*<string>)([^<]*)(<\/string>)/;
const buildNumber = /(<key>CFBundleVersion<\/key>\s*<string>)([^<]*)(<\/string>)/;

if (!shortString.test(plistText)) {
  fail("desktop/Info.plist has no CFBundleShortVersionString");
}
if (!buildNumber.test(plistText)) {
  fail("desktop/Info.plist has no CFBundleVersion");
}

const oldBuild = Number.parseInt(buildNumber.exec(plistText)[2].trim(), 10);
const nextBuild = String(Number.isFinite(oldBuild) ? oldBuild + 1 : 1);

// Write package.json and the lockfile through their parsed form; the lockfile
// repeats the version at the top level and under packages[""], and a textual
// replace would happily rewrite a dependency that happens to share the number.
pkg.version = next;
writeFileSync(pkgUrl, `${JSON.stringify(pkg, null, 2)}\n`);

const lock = JSON.parse(readFileSync(lockUrl, "utf8"));
lock.version = next;
if (lock.packages?.[""]) lock.packages[""].version = next;
writeFileSync(lockUrl, `${JSON.stringify(lock, null, 2)}\n`);

const updatedPlist = plistText
  .replace(shortString, (_match, open, _value, close) => `${open}${next}${close}`)
  .replace(buildNumber, (_match, open, _value, close) => `${open}${nextBuild}${close}`);
writeFileSync(plistUrl, updatedPlist);

console.log(`version ${current} -> ${next} (build ${oldBuild || 0} -> ${nextBuild})`);
console.log("updated package.json, package-lock.json, desktop/Info.plist");
console.log("");

execFileSync(process.execPath, [fileURLToPath(new URL("check-version.mjs", import.meta.url))], {
  cwd: fileURLToPath(root),
  stdio: "inherit",
});

console.log("");
console.log("Next:");
console.log("  git add package.json package-lock.json desktop/Info.plist");
console.log(`  git commit -m "Bump the version to ${next}"`);
console.log(`  git tag -a v${next} -m "MITOSIS v${next}"`);
console.log(`  git push origin main v${next}`);
