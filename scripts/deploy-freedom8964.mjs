// Deploys chat.freedom8964.com. Same configuration as wrangler.jsonc, except
// that the site is reachable only on its own domain: the workers.dev address
// and version preview URLs, which carry the account's subdomain, are off.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const base = JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const config = {
  ...base,
  workers_dev: false,
  preview_urls: false,
  routes: [{ pattern: 'chat.freedom8964.com', custom_domain: true }]
};
// The signed file list (scripts/integrity.mjs) goes up with the site.
execFileSync(process.execPath, ['scripts/integrity.mjs', '--signed'], { stdio: 'inherit' });
const file = 'wrangler.freedom8964.json';
writeFileSync(file, JSON.stringify(config, null, 2));
try {
  execFileSync('npx', ['wrangler', 'deploy', '-c', file], { stdio: 'inherit' });
} finally {
  rmSync(file, { force: true });
}
