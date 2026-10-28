import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { derive, makeConfig, unlock } from '../html-room/crypto.js';
import { render } from '../scripts/build-html-room.mjs';
test('HTML Room HKDF frozen vector', async () => {
 const v=JSON.parse(await readFile(new URL('../docs/html-room/hkdf-vector.json',import.meta.url)));
 const d=await derive(v.master);for(const k of ['access','keyBytes','bind','roomId'])assert.equal(k==='roomId'?d[k]:Buffer.from(d[k]).toString('hex'),v[k==='keyBytes'?'key':k]);
});
test('HTML Room wrapping validates password, AAD, bounded KDF', async () => {
 const c=await makeConfig('wss://relay.example', 'correct horse long random password');
 assert.equal('master' in c,false);assert.equal((await unlock(c,'correct horse long random password')).roomId,c.roomId);
 await assert.rejects(unlock(c,'wrong'));await assert.rejects(unlock({...c,roomId:'0'.repeat(64)},'correct horse long random password'));
 await assert.rejects(unlock({...c,kdf:{...c.kdf,iterations:999999999}},'x'));
});
test('HTML Room config escaping, relay whitelist and fixed executable hash', async () => {
 const c=await makeConfig('wss://relay.example');const a=await render(c,['wss://relay.example']);const b=await render(await makeConfig('wss://relay.example'),['wss://relay.example']);
 assert.equal(a.scriptHash,b.scriptHash);assert.match(a.html,/default-src 'none'/);assert.doesNotMatch(a.html,/\sstyle\s*=/i);assert.doesNotMatch(a.html,/<script[^>]+src=/i);
 await assert.rejects(render({...c,relay:'wss://evil.example'},['wss://relay.example']));
 await assert.rejects(render({...c,relay:'wss://relay.example/</script>'},['wss://relay.example']));
});
import { htmlRoomOrigin, checkHtmlRoomFrame } from '../src/html-room.js';
import { accessMatches } from '../src/rules.js';
test('HTML Room route policy isolates Origins and drops game frames', async()=>{
 assert.ok(htmlRoomOrigin('null','https://relay.example'));assert.ok(htmlRoomOrigin('https://relay.example','https://relay.example'));
 for(const o of [null,'https://evil.example','http://relay.example','https://relay.example/'])assert.equal(htmlRoomOrigin(o,'https://relay.example'),false);
 for(const type of ['table','lobby','ref','file','lock','remove'])assert.equal(checkHtmlRoomFrame(JSON.stringify({type}),{}),null);
 const c=await makeConfig('wss://relay.example');const d=await unlock(c);assert.ok(await accessMatches(c.roomId,Buffer.from(d.access).toString('hex')));assert.equal(await accessMatches('0'.repeat(64),Buffer.from(d.access).toString('hex')),false);
});
