import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvFile, checkConfig, ConfigError } from '../server/config.mjs';

test('config.env lines: comments, set/export, quotes, BOM, CRLF', () => {
  assert.deepEqual(parseEnvFile('\uFEFF# x\r\nPORT=9443\r\nset LAN_NAMES=a,b\r\nexport HOST="10.0.0.2"\r\n'), { PORT: '9443', LAN_NAMES: 'a,b', HOST: '10.0.0.2' });
  assert.throws(() => parseEnvFile('this is not a setting'), ConfigError);
});

test('wrong values stop the server instead of falling back', () => {
  assert.equal(checkConfig({}).port, 8080);
  assert.equal(checkConfig({ PORT: '9443' }).port, 9443);
  for (const env of [{ PORT: 'abc' }, { PORT: '0' }, { PORT: '70000' }, { JOIN_LIMIT: '-1' }, { MAX_CONNECTIONS: '1e3' }, { TRUST_PROXY: 'yes' }, { TLS_CERT: 'a.crt' }]) {
    assert.throws(() => checkConfig(env), ConfigError, JSON.stringify(env));
  }
});
