import test from 'node:test';
import assert from 'node:assert/strict';
import { inside, ENTRY, COVER } from '../src/rules.js';
import { checkConfig, ConfigError } from '../server/config.mjs';

test('entry path: only the secret folder is the site', () => {
  const e = '/k7Qp2xVm9aLd/';
  assert.equal(inside('/', null), '/', 'no entry path: everything is the site');
  assert.equal(inside('/', e), null);
  assert.equal(inside('/index.html', e), null);
  assert.equal(inside('/ws/abc', e), null);
  assert.equal(inside('/k7Qp2xVm9aLdX/', e), null, 'a longer name is not the entry');
  assert.equal(inside('/k7Qp2xVm9aLd', e), 'redirect');
  assert.equal(inside('/k7Qp2xVm9aLd/', e), '/');
  assert.equal(inside('/k7Qp2xVm9aLd/ws/ab12', e), '/ws/ab12');
  assert.equal(COVER.status, 404);
  assert.ok(!Object.keys(COVER.headers).some((h) => /security|nel|referrer/i.test(h)), 'none of the site\'s own headers');
});

test('entry path: checked at start-up', () => {
  assert.equal(checkConfig({ ENTRY_PATH: 'k7Qp2xVm9aLd' }).entry, '/k7Qp2xVm9aLd/');
  assert.equal(checkConfig({ ENTRY_PATH: '/k7Qp2xVm9aLd/' }).entry, '/k7Qp2xVm9aLd/');
  assert.equal(checkConfig({}).entry, null);
  assert.equal(checkConfig({ ENTRY_PATH: '' }).entry, null);
  assert.throws(() => checkConfig({ ENTRY_PATH: 'short' }), ConfigError);
  assert.throws(() => checkConfig({ ENTRY_PATH: 'has/slash/inside1' }), ConfigError);
  assert.throws(() => checkConfig({ ENTRY_PATH: '../../etc/passwd' }), ConfigError);
  assert.ok(ENTRY.test('/abc_DEF-123/'));
});
