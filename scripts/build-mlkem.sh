#!/bin/sh
# Rebuilds dist/vendor/mlkem.js: ML-KEM-768 from @noble/post-quantum, bundled
# for Chrome 83 (the Android 10 WebView). Object.hasOwn is replaced because
# that WebView does not have it. Check the result into git; the site has no
# build step and its files are signed as they are.
set -e
VERSION=${1:-0.7.1}
DIR=$(mktemp -d)
cd "$DIR"
npm init -y >/dev/null
npm i -q "@noble/post-quantum@$VERSION" esbuild
echo "export { ml_kem768 } from '@noble/post-quantum/ml-kem.js';" > entry.js
npx esbuild entry.js --bundle --format=esm --target=chrome83 --legal-comments=inline --outfile=out.js
OUT="$OLDPWD/dist/vendor/mlkem.js"
{
  echo "// ML-KEM-768 (FIPS 203) from @noble/post-quantum $VERSION and @noble/hashes,"
  echo "// bundled with esbuild for Chrome 83 (the Android 10 WebView). MIT License,"
  echo "// Copyright (c) 2024 Paul Miller (https://paulmillr.com). Rebuild: scripts/build-mlkem.sh"
  echo "// Not independently audited: private-talk uses it only next to ECDH (see group.js)."
  sed 's/Object\.hasOwn(\([a-z]*\), /Object.prototype.hasOwnProperty.call(\1, /' out.js
} > "$OUT"
rm -rf "$DIR"
echo "wrote $OUT"
