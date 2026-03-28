#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/.build/arm64-apple-macosx/release"
DIST_DIR="$ROOT_DIR/dist"
APP_NAME="Loopndroll"
APP_DIR="$DIST_DIR/$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
ZIP_PATH="$DIST_DIR/$APP_NAME.app.zip"
SIGN_IDENTITY="${SIGN_IDENTITY:--}"

cd "$ROOT_DIR"

echo "Building release binary..."
swift build -c release --product "$APP_NAME"

echo "Preparing app bundle..."
rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cp "$BUILD_DIR/$APP_NAME" "$MACOS_DIR/$APP_NAME"
cp "$ROOT_DIR/Packaging/Info.plist" "$CONTENTS_DIR/Info.plist"
chmod 755 "$MACOS_DIR/$APP_NAME"
printf 'APPL????' > "$CONTENTS_DIR/PkgInfo"

if [[ "$SIGN_IDENTITY" == "-" ]]; then
    echo "Applying ad-hoc signature..."
    CODESIGN_ARGS=(--force --deep --sign "$SIGN_IDENTITY")
else
    echo "Signing with identity: $SIGN_IDENTITY"
    CODESIGN_ARGS=(--force --deep --options runtime --sign "$SIGN_IDENTITY")
fi
codesign "${CODESIGN_ARGS[@]}" "$APP_DIR"

echo "Creating zip archive..."
rm -f "$ZIP_PATH"
ditto -c -k --keepParent "$APP_DIR" "$ZIP_PATH"

echo
echo "Created:"
echo "  $APP_DIR"
echo "  $ZIP_PATH"
