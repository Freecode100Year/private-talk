#!/usr/bin/env bash
# Builds the offline packages for networks without internet access:
#   private-talk-<version>-<platform>.zip/.tar.gz   Node.js + app + dependencies
#   private-talk-<version>-app.zip                  app + dependencies, for machines that already have Node.js 22+
# The Node.js binaries come from nodejs.org and are checked against its SHASUMS256.txt.
#   scripts/offline-packages.sh <version> [platform ...]
# platforms: win-x64 linux-x64 linux-arm64 darwin-arm64 darwin-x64 (default: all)
set -euo pipefail
VERSION="${1:?version, e.g. 1.5.0}"; shift || true
NODE_VERSION="${NODE_VERSION:-v22.23.3}"
PLATFORMS=("${@:-win-x64 linux-x64 linux-arm64 darwin-arm64 darwin-x64}")
PLATFORMS=(${PLATFORMS[@]})
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/out"; WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

# The app with its production dependencies, the same for every platform.
APP="$WORK/app"
mkdir -p "$APP/src"
cp -r "$ROOT/dist" "$ROOT/server" "$ROOT/docs" "$APP/"
cp "$ROOT/src/rules.js" "$APP/src/"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/LICENSE" "$ROOT/README.md" "$ROOT/offline/使用说明.txt" "$APP/"
(cd "$APP" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null && rm package-lock.json)
(cd "$WORK" && cp -r app "private-talk-$VERSION-app" && zip -qr "$OUT/private-talk-$VERSION-app.zip" "private-talk-$VERSION-app")

curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"
for p in "${PLATFORMS[@]}"; do
  name="private-talk-$VERSION-$p"; dir="$WORK/$name"
  cp -r "$APP" "$dir"; mkdir -p "$dir/node"
  if [[ $p == win-* ]]; then file="node-$NODE_VERSION-$p.zip"; else file="node-$NODE_VERSION-$p.tar.xz"; fi
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$file" -o "$WORK/$file"
  (cd "$WORK" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet -)
  if [[ $p == win-* ]]; then
    unzip -q -j "$WORK/$file" "node-$NODE_VERSION-$p/node.exe" "node-$NODE_VERSION-$p/LICENSE" -d "$dir/node"
    cp "$ROOT/offline/start-lan.cmd" "$dir/"
    # Windows reads .cmd and .txt in the console code page; CRLF line ends.
    sed -i 's/$/\r/' "$dir/start-lan.cmd" "$dir/使用说明.txt"
    (cd "$WORK" && zip -qr "$OUT/$name.zip" "$name")
  else
    mkdir -p "$dir/node/bin"
    tar -xJf "$WORK/$file" -C "$WORK" "node-$NODE_VERSION-$p/bin/node" "node-$NODE_VERSION-$p/LICENSE"
    mv "$WORK/node-$NODE_VERSION-$p/bin/node" "$dir/node/bin/"; mv "$WORK/node-$NODE_VERSION-$p/LICENSE" "$dir/node/"
    cp "$ROOT/offline/start-lan.sh" "$dir/"; chmod +x "$dir/start-lan.sh"
    tar -czf "$OUT/$name.tar.gz" -C "$WORK" "$name"
  fi
  echo "built $name"
done
