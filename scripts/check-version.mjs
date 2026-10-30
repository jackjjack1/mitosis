#!/usr/bin/env node
/**
 * Fails when the release version drifts between the tag, package.json and the
 * macOS bundle.
 *
 * The bundle reports CFBundleShortVersionString from a hardcoded Info.plist
 * value, so a release can ship an app claiming a version the tag does not name.
 * CI runs this on every push and pull request to compare the two files, and the
 * release workflow passes --tag to check the tag as well before building.
 *
 * Usage:
 *   node scripts/check-version.mjs              # files only
 *   node scripts/check-version.mjs --tag v0.1.1 # files plus the git tag
 */

import { readFileSync } from "node:fs";

const SEMVER = /^\d+\.\d+\.\d+$/;

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

const tagIndex = process.argv.indexOf("--tag");
const tag = tagIndex === -1 ? "" : (process.argv[tagIndex + 1] ?? "");

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const plist = readFileSync(new URL("desktop/Info.plist", root), "utf8");

const plistMatch = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]*)<\/string>/.exec(plist);
if (!plistMatch) {
  fail([
    "FAIL CFBundleShortVersionString is missing from desktop/Info.plist",
    "Add the key next to the other CFBundle entries so the bundle reports a version.",
  ]);
}

const sources = new Map([
  ["package.json", pkg.version],
  ["desktop/Info.plist", plistMatch[1].trim()],
]);

if (tagIndex !== -1) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    fail([
      `FAIL tag "${tag}" is not shaped like vX.Y.Z`,
      "Tag the release as vX.Y.Z so it can be compared with the version files.",
    ]);
  }
  sources.set(`tag ${tag}`, tag.slice(1));
}

for (const [source, value] of sources) {
  if (!SEMVER.test(value)) {
    fail([`FAIL ${source} reports "${value}", which is not X.Y.Z`]);
  }
}

const expected = sources.get("package.json");
let consistent = true;

for (const [source, value] of sources) {
  const passes = value === expected;
  if (!passes) consistent = false;
  console.log(`${passes ? "PASS" : "FAIL"} ${source}: ${value}${passes ? "" : ` (expected ${expected})`}`);
}

if (!consistent) {
  fail([
    "",
    "The release version disagrees between these files.",
    "Move all of them together before tagging, for example:",
    "  npm version <new> --no-git-tag-version",
    "  then update CFBundleShortVersionString in desktop/Info.plist",
  ]);
}
