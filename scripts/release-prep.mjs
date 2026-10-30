#!/usr/bin/env node
/**
 * Bumps the release version in every place it is written down, and can commit
 * and tag it in the same run.
 *
 * The app reports CFBundleShortVersionString from a hardcoded Info.plist value,
 * package.json names the version for npm, and the lockfile repeats it twice, so
 * a release used to mean editing three files by hand and hoping they agreed.
 * This writes all of them, runs check-version.mjs to prove it, and with
 * --commit leaves a clean commit and an annotated tag behind.
 *
 * Usage:
 *   npm run release:prepare                           # bump only (patch)
 *   npm run release:prepare -- minor --commit         # bump, commit, tag
 *   npm run release:prepare -- 0.2.0 --commit --push  # ...and push both
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const KNOWN_FLAGS = new Set(["--commit", "--push", "--help", "-h"]);
const VERSION_FILES = ["package.json", "package-lock.json", "desktop/Info.plist"];

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("-")));
const positional = args.filter((arg) => !arg.startsWith("-"));

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const wantCommit = flags.has("--commit");
const wantPush = flags.has("--push");

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function usage() {
  console.log("usage: npm run release:prepare -- [patch|minor|major|X.Y.Z] [--commit] [--push]");
  console.log("");
  console.log("  (no flags)  bump the version files and verify them");
  console.log("  --commit    also commit the bump and create the annotated tag");
  console.log("  --push      also push the commit and tag (requires --commit)");
}

if (flags.has("--help") || flags.has("-h")) {
  usage();
  process.exit(0);
}

for (const flag of flags) {
  if (!KNOWN_FLAGS.has(flag)) fail(`unknown option "${flag}" — try --help`);
}
if (wantPush && !wantCommit) fail("--push needs --commit, so the commit and tag exist first");

function git(argv) {
  return execFileSync("git", argv, {
    cwd: rootPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitRun(argv) {
  execFileSync("git", argv, { cwd: rootPath, stdio: "inherit" });
}

function inGitCheckout() {
  try {
    return git(["rev-parse", "--is-inside-work-tree"]).trim() === "true";
  } catch {
    return false;
  }
}

if ((wantCommit || wantPush) && !inGitCheckout()) {
  fail("--commit needs a git checkout");
}

const pkgUrl = new URL("package.json", root);
const lockUrl = new URL("package-lock.json", root);
const plistUrl = new URL("desktop/Info.plist", root);

const pkg = JSON.parse(readFileSync(pkgUrl, "utf8"));
const current = String(pkg.version ?? "");
const currentMatch = SEMVER.exec(current);
if (!currentMatch) fail(`package.json reports "${current}", which is not X.Y.Z`);

const request = (positional[0] ?? "patch").trim();
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
  if (!inGitCheckout()) return false;
  return git(["tag", "--list", name]).trim() !== "";
}

if (wantCommit) {
  // The bump must be its own commit, so refuse to mix it with unrelated work.
  const dirty = git(["status", "--porcelain"]).trim();
  if (dirty) {
    fail(
      [
        "the working tree is not clean:",
        ...dirty.split("\n").map((line) => `  ${line}`),
        "commit or stash these first, so the release is a commit of its own",
      ].join("\n"),
    );
  }
  try {
    git(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  } catch {
    fail("--commit needs to be on a branch, not a detached HEAD");
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
  cwd: rootPath,
  stdio: "inherit",
});

if (!wantCommit) {
  console.log("");
  console.log("Next:");
  console.log("  npm run release:prepare -- " + next + " --commit --push   # do it in one step");
  console.log("  or finish by hand:");
  console.log(`    git add ${VERSION_FILES.join(" ")}`);
  console.log(`    git commit -m "Bump the version to ${next}"`);
  console.log(`    git tag -a v${next} -m "MITOSIS v${next}"`);
  console.log("    git push origin HEAD");
  console.log(`    git push origin v${next}`);
  process.exit(0);
}

gitRun(["add", ...VERSION_FILES]);
gitRun([
  "commit",
  "-m",
  `Bump the version to ${next}`,
  "-m",
  "Every version file moves with the tag so the bundle cannot report a version the release does not name.",
]);

try {
  gitRun(["tag", "-a", `v${next}`, "-m", `MITOSIS v${next}`]);
} catch {
  fail(
    `the bump was committed, but tagging v${next} failed — create it by hand with: git tag -a v${next} -m "MITOSIS v${next}"`,
  );
}

console.log("");
console.log(`committed and tagged v${next}`);

if (wantPush) {
  gitRun(["push", "origin", "HEAD"]);
  gitRun(["push", "origin", `v${next}`]);
  console.log(`pushed the commit and tag v${next}`);
} else {
  console.log("Next:");
  console.log("  git push origin HEAD");
  console.log(`  git push origin v${next}`);
}
