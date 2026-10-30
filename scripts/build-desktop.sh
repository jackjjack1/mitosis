#!/usr/bin/env bash
# Builds MITOSIS.app from the compiled web app and installs it on the Desktop.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP_NAME="MITOSIS"
BUNDLE_ID="io.freebuff.mitosis"
BUILD_DIR="$ROOT/build/desktop"
APP_BUNDLE="$BUILD_DIR/$APP_NAME.app"
ICONSET="$BUILD_DIR/MITOSIS.iconset"
ICON_SOURCE="$BUILD_DIR/icon-1024.png"
INSTALL_PATH="${MITOSIS_INSTALL_PATH:-$HOME/Desktop/$APP_NAME.app}"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc is required. Install Xcode Command Line Tools first." >&2
  exit 1
fi

echo "→ compiling the web interface"
npm run build

# WKWebView refuses to load external ES modules from file://. The app is a
# single page with no routing, so inline the compiled JS/CSS into one file.
echo "→ inlining the interface for offline use"
node scripts/inline-build.mjs "$BUILD_DIR/web"

echo "→ assembling $APP_NAME.app"
rm -rf "$APP_BUNDLE" "$ICONSET"
mkdir -p \
  "$APP_BUNDLE/Contents/MacOS" \
  "$APP_BUNDLE/Contents/Resources/web" \
  "$ICONSET"

cp "$BUILD_DIR/web/index.html" "$APP_BUNDLE/Contents/Resources/web/index.html"
cp desktop/Info.plist "$APP_BUNDLE/Contents/Info.plist"

echo "→ rendering the app icon"
swift desktop/make-icon.swift "$ICON_SOURCE"
for size in 16 32 64 128 256 512 1024; do
  sips -z "$size" "$size" "$ICON_SOURCE" \
    --out "$BUILD_DIR/icon-$size.png" >/dev/null
done
cp "$BUILD_DIR/icon-16.png" "$ICONSET/icon_16x16.png"
cp "$BUILD_DIR/icon-32.png" "$ICONSET/icon_16x16@2x.png"
cp "$BUILD_DIR/icon-32.png" "$ICONSET/icon_32x32.png"
cp "$BUILD_DIR/icon-64.png" "$ICONSET/icon_32x32@2x.png"
cp "$BUILD_DIR/icon-128.png" "$ICONSET/icon_128x128.png"
cp "$BUILD_DIR/icon-256.png" "$ICONSET/icon_128x128@2x.png"
cp "$BUILD_DIR/icon-256.png" "$ICONSET/icon_256x256.png"
cp "$BUILD_DIR/icon-512.png" "$ICONSET/icon_256x256@2x.png"
cp "$BUILD_DIR/icon-512.png" "$ICONSET/icon_512x512.png"
cp "$BUILD_DIR/icon-1024.png" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$APP_BUNDLE/Contents/Resources/MITOSIS.icns"

echo "→ compiling the native shell"
swiftc \
  -O \
  -swift-version 5 \
  -framework Cocoa \
  -framework WebKit \
  desktop/Specimen.swift \
  desktop/main.swift \
  -o "$APP_BUNDLE/Contents/MacOS/$APP_NAME"

printf 'APPL????' > "$APP_BUNDLE/Contents/PkgInfo"

echo "→ signing locally (ad hoc)"
codesign --force --sign - "$APP_BUNDLE" >/dev/null
codesign --verify --deep --strict "$APP_BUNDLE"

if [ -e "$INSTALL_PATH" ]; then
  EXISTING_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' \
    "$INSTALL_PATH/Contents/Info.plist" 2>/dev/null || true)"
  if [ "$EXISTING_ID" != "$BUNDLE_ID" ]; then
    echo "Refusing to replace an unrelated app at $INSTALL_PATH" >&2
    exit 1
  fi
  rm -rf "$INSTALL_PATH"
fi

mkdir -p "$(dirname "$INSTALL_PATH")"
ditto "$APP_BUNDLE" "$INSTALL_PATH"

# Desktop/iCloud sync adds FinderInfo metadata after copying, which strict
# bundle verification treats as detritus. The executable remains launchable.
xattr -cr "$INSTALL_PATH"
codesign --force --sign - "$INSTALL_PATH" >/dev/null

echo "→ installed: $INSTALL_PATH"
echo "→ open it with: open \"$INSTALL_PATH\""
