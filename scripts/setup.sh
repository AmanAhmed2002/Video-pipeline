#!/usr/bin/env bash
# Installs the system-level dependencies the pipeline needs (macOS / Homebrew).
set -euo pipefail

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew not found. Install it from https://brew.sh first." >&2
  exit 1
fi

echo "Installing FFmpeg + node-canvas native libraries via Homebrew..."
brew install ffmpeg pkg-config cairo pango libpng jpeg giflib librsvg

echo "Done. You can now run: npm install && npm run start:dev"
