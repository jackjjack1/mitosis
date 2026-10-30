#!/usr/bin/env bash
# Composes the GitHub release notes for a tag: how to verify the download, what
# changed since the previous tag, and a compare link.
#
# GitHub's own --generate-notes only lists pull requests, so a repository that
# lands work as direct commits gets nothing but a compare link. This walks the
# actual history instead.
#
# Usage: release-notes.sh <tag> [output-file]
# Env:   GITHUB_REPOSITORY (owner/repo); derived from origin when absent.
set -euo pipefail

if [ "$#" -lt 1 ] || [ -z "${1:-}" ]; then
  echo "usage: release-notes.sh <tag> [output-file]" >&2
  exit 2
fi

TAG="$1"
OUT="${2:-release-notes.md}"

if ! git rev-parse --verify --quiet "${TAG}^{commit}" >/dev/null; then
  echo "tag ${TAG} is not in this checkout; fetch tags first (git fetch --tags)" >&2
  exit 1
fi

REPO="${GITHUB_REPOSITORY:-}"
if [ -z "$REPO" ]; then
  REPO=$(git config --get remote.origin.url 2>/dev/null \
    | sed -E 's#^git@github\.com:##; s#^https://github\.com/##; s#\.git$##' || true)
fi
if [ -z "$REPO" ]; then
  echo "cannot determine the repository; set GITHUB_REPOSITORY" >&2
  exit 1
fi

PREV=$(git describe --tags --abbrev=0 "${TAG}^" 2>/dev/null || true)
if [ -n "$PREV" ]; then
  RANGE="${PREV}..${TAG}"
else
  RANGE="${TAG}"
fi

# The bump commit is release plumbing, and the tag already names the version.
CHANGES=$(git log "$RANGE" --no-merges --reverse \
  --pretty=format:"- %s ([%h](https://github.com/${REPO}/commit/%H))" \
  | grep -v '^- Bump the version to ' || true)

{
  cat <<'INTRO'
macOS build is ad-hoc signed and not notarized. If macOS blocks it, right-click the app and choose Open, or run:

```bash
xattr -dr com.apple.quarantine /Applications/MITOSIS.app
```

Verify the download from the folder containing both files:

```bash
shasum -a 256 -c MITOSIS-macos.zip.sha256
```

### What changed
INTRO
  echo
  if [ -n "$CHANGES" ]; then
    printf '%s\n' "$CHANGES"
  else
    echo "No changes recorded."
  fi
  if [ -n "$PREV" ]; then
    printf '\n**Full Changelog**: https://github.com/%s/compare/%s...%s\n' "$REPO" "$PREV" "$TAG"
  fi
} > "$OUT"

echo "wrote $OUT (${RANGE})"
