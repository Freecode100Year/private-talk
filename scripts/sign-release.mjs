// Signs release files for the offline updater: writes <file>.sig (base64
// Ed25519 signature of the whole file) next to each one. The private key
// comes from RELEASE_SIGNING_KEY (PEM) and never touches the disk here; the
// matching public key is server/release-key.pem, shipped in every package.
//   RELEASE_SIGNING_KEY=… node scripts/sign-release.mjs out/*
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const pem = process.env.RELEASE_SIGNING_KEY;
if (!pem) { console.error('RELEASE_SIGNING_KEY is not set; packages will be unsigned'); process.exit(3); }
const key = createPrivateKey(pem);
const pub = createPublicKey(readFileSync(new URL('../server/release-key.pem', import.meta.url)));
for (const file of process.argv.slice(2).filter((f) => !f.endsWith('.sig'))) {
  const data = readFileSync(file);
  const sig = sign(null, data, key);
  if (!verify(null, data, pub, sig)) { console.error('the signing key does not match server/release-key.pem'); process.exit(1); }
  writeFileSync(`${file}.sig`, `${sig.toString('base64')}\n`);
  console.log(`signed ${file}`);
}
