import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { readArchive, safePath, ArchiveError } from '../server/archive.mjs';

const dir = mkdtempSync(join(tmpdir(), 'pt-archive-'));
mkdirSync(join(dir, 'pkg', 'app', 'sub'), { recursive: true });
writeFileSync(join(dir, 'pkg', 'app', 'a.txt'), '隐匿对话\n');
writeFileSync(join(dir, 'pkg', 'app', 'sub', 'b.bin'), Buffer.alloc(70000, 7));

function check(entries) {
  const files = Object.fromEntries(entries.filter((e) => !e.dir).map((e) => [e.path, e.data()]));
  assert.equal(files['pkg/app/a.txt'].toString(), '隐匿对话\n');
  assert.equal(files['pkg/app/sub/b.bin'].length, 70000);
}

test('reads tar.gz made by the system tar', () => {
  execFileSync('tar', ['-czf', join(dir, 'p.tar.gz'), '-C', dir, 'pkg']);
  check(readArchive(readFileSync(join(dir, 'p.tar.gz'))));
});

test('reads zip', (t) => {
  try {
    if (process.platform === 'linux') execFileSync('zip', ['-qr', join(dir, 'p.zip'), 'pkg'], { cwd: dir });
    else execFileSync('tar', ['-a', '-cf', join(dir, 'p.zip'), '-C', dir, 'pkg']);
  } catch { t.skip('no zip tool'); return; }
  check(readArchive(readFileSync(join(dir, 'p.zip'))));
});

test('refuses paths that leave the folder, and links', () => {
  for (const bad of ['../x', '/etc/passwd', 'a/../../x', 'C:/x', 'a\\..\\..\\x']) assert.throws(() => safePath(bad), ArchiveError, bad);
  assert.equal(safePath('a/./b/'), 'a/b');
  const header = (name, type, size = 0) => {
    const h = Buffer.alloc(512);
    h.write(name, 0);
    h.write('0000644\0', 100); h.write(size.toString(8).padStart(11, '0') + '\0', 124);
    h.write(type, 156); h.write('ustar\0', 257);
    let sum = 0; h.fill(' ', 148, 156); for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
  };
  const tar = (name, type) => gzipSync(Buffer.concat([header(name, type), Buffer.alloc(1024)]));
  assert.throws(() => readArchive(tar('pkg/../../evil', '0')), ArchiveError);
  assert.throws(() => readArchive(tar('pkg/link', '2')), ArchiveError);
  assert.throws(() => readArchive(Buffer.from('not an archive')), ArchiveError);
});
