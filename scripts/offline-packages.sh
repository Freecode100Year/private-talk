#!/usr/bin/env bash
# Builds the offline packages for networks without internet access:
#   private-talk-<platform>.zip/.tar.gz   Node.js + app + dependencies
#   private-talk-app.zip                  app + dependencies, for machines that already have Node.js 22+
#   private-talk-compose.tar.gz           Docker deployment files (compose, Caddyfile, .env.example, pt)
# File names carry no version, so .../releases/latest/download/<name> always
# fetches the newest; the folder inside is named with the version.
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

# Layout of every package (see server/update.mjs):
#   app/      the program: page, server, docs, dependencies
#   node/     Node.js (not in the app package)
#   start-lan, update, status scripts; config.env.example; PLATFORM
# lan-certs/, config.env and previous/ are made on the user's machine and
# never shipped, so the updater can replace app/ and node/ around them.
APP="$WORK/app"
mkdir -p "$APP/src"
cp -r "$ROOT/dist" "$ROOT/server" "$ROOT/docs" "$APP/"
mkdir -p "$APP/deploy" && cp "$ROOT"/deploy/private-talk-lan.service "$ROOT"/deploy/private-talk.service "$ROOT"/deploy/Caddyfile.vps "$ROOT"/deploy/nginx.conf "$APP/deploy/"
cp "$ROOT/docker-compose.lan.yml" "$APP/"
cp "$ROOT/src/html-room.js" "$ROOT/src/rules.js" "$ROOT/src/lobby.js" "$ROOT/src/judge.js" "$ROOT/src/card-table.js" "$ROOT/src/guandan.js" "$ROOT/src/mahjong.js" "$APP/src/"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/LICENSE" "$ROOT/README.md" "$APP/"
(cd "$APP" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null && rm package-lock.json)

# skeleton <dir> <platform>: the folder around app/.
skeleton() {
  local dir="$1" p="$2"
  mkdir -p "$dir"
  cp -r "$APP" "$dir/app"
  cp "$ROOT/offline/使用说明.txt" "$ROOT/offline/config.env.example" "$dir/"
  printf '%s\n' "$p" > "$dir/PLATFORM"
  if [[ $p == win-* ]]; then
    cp "$ROOT/offline/start-lan.cmd" "$ROOT/offline/update.cmd" "$ROOT/offline/status.cmd" "$dir/"
    # Windows reads .cmd and .txt in the console code page; CRLF line ends.
    sed -i 's/$/\r/' "$dir/"*.cmd "$dir/使用说明.txt" "$dir/config.env.example"
  elif [[ $p == app ]]; then
    cp "$ROOT/offline/"*.cmd "$ROOT/offline/"*.sh "$dir/"
    chmod +x "$dir/"*.sh
  else
    cp "$ROOT/offline/start-lan.sh" "$ROOT/offline/update.sh" "$ROOT/offline/status.sh" "$dir/"
    chmod +x "$dir/"*.sh
  fi
}

# Docker deployment, no source checkout needed: compose files, Caddyfile,
# .env.example and the pt helper; images are pulled at the pinned versions.
D="$WORK/private-talk-docker"
mkdir -p "$D/deploy/tailscale"
cp "$ROOT"/docker-compose.yml "$ROOT"/docker-compose.lan.yml "$ROOT"/docker-compose.tunnel.yml "$ROOT"/docker-compose.tailscale.yml \
   "$ROOT"/Caddyfile "$ROOT"/.env.example "$ROOT"/pt "$D/"
cp "$ROOT"/deploy/tailscale/*.json "$D/deploy/tailscale/"
chmod +x "$D/pt"
tar -czf "$OUT/private-talk-compose.tar.gz" -C "$WORK" private-talk-docker

skeleton "$WORK/private-talk-$VERSION-app" app
(cd "$WORK" && zip -qr "$OUT/private-talk-app.zip" "private-talk-$VERSION-app")

curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"
for p in "${PLATFORMS[@]}"; do
  name="private-talk-$VERSION-$p"; dir="$WORK/$name"
  skeleton "$dir" "$p"; mkdir -p "$dir/node"
  if [[ $p == win-* ]]; then file="node-$NODE_VERSION-$p.zip"; else file="node-$NODE_VERSION-$p.tar.xz"; fi
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/$file" -o "$WORK/$file"
  (cd "$WORK" && grep " $file\$" SHASUMS256.txt | sha256sum -c --quiet -)
  if [[ $p == win-* ]]; then
    unzip -q -j "$WORK/$file" "node-$NODE_VERSION-$p/node.exe" "node-$NODE_VERSION-$p/LICENSE" -d "$dir/node"
    (cd "$WORK" && zip -qr "$OUT/private-talk-$p.zip" "$name")
  else
    mkdir -p "$dir/node/bin"
    tar -xJf "$WORK/$file" -C "$WORK" "node-$NODE_VERSION-$p/bin/node" "node-$NODE_VERSION-$p/LICENSE"
    mv "$WORK/node-$NODE_VERSION-$p/bin/node" "$dir/node/bin/"; mv "$WORK/node-$NODE_VERSION-$p/LICENSE" "$dir/node/"
    tar -czf "$OUT/private-talk-$p.tar.gz" -C "$WORK" "$name"
  fi
  echo "built $name"
done
