#!/usr/bin/env bash
#
# Build Linux packages from macOS via Docker.
#
# Cross-building is not needed for Electron itself — electron-builder simply
# downloads the right binaries. The problem is node-pty: a native module can only
# be compiled for Linux on Linux. Hence the whole build runs in a container.
#
# The container architecture must match the target: node-pty built for arm64 will
# not load on an x86 machine. On Apple Silicon arm64 builds natively and fast,
# while x64 goes through emulation and is noticeably slower.
#
# Usage:
#   scripts/build-linux.sh            # both architectures
#   scripts/build-linux.sh arm64      # arm64 only
#   scripts/build-linux.sh x64        # x64 only

set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"
PROJECT_NAME="$(basename "$PROJECT_DIR")"
IMAGE="electronuserland/builder:22"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and try again." >&2
  exit 1
fi

mkdir -p ~/.cache/electron ~/.cache/electron-builder

build_arch() {
  local arch="$1"
  local platform
  local volume

  case "$arch" in
    arm64) platform="linux/arm64" ;;
    x64)   platform="linux/amd64" ;;
    *) echo "Unknown architecture: $arch" >&2; exit 1 ;;
  esac

  # A separate node_modules volume per architecture. The host directory cannot be
  # shared: npm would overwrite the native modules built for Electron on macOS and
  # silently break the local build.
  volume="${PROJECT_NAME}-node-modules-${arch}"

  echo "==> Building ${arch} (${platform})"
  docker run --rm \
    --platform "$platform" \
    --env ELECTRON_CACHE=/root/.cache/electron \
    --env ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder \
    -v "${PROJECT_DIR}:/project" \
    -v "${volume}:/project/node_modules" \
    -v "${HOME}/.cache/electron:/root/.cache/electron" \
    -v "${HOME}/.cache/electron-builder:/root/.cache/electron-builder" \
    "$IMAGE" \
    /bin/bash -c "set -e
      cd /project
      npm install --no-audit --no-fund
      npx electron-vite build
      npx electron-builder --linux --${arch} --config electron-builder.yml"
}

targets=("${@:-arm64 x64}")
# With no arguments the array holds one string containing two words — split it.
read -r -a targets <<< "${targets[*]}"

for arch in "${targets[@]}"; do
  build_arch "$arch"
done

echo
echo "==> Done. Packages in release/:"
ls -lh release/*.AppImage release/*.deb 2>/dev/null || echo "(nothing found)"
