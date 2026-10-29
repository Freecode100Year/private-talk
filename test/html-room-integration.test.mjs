import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig, relayOrigin } from '../html-room/crypto.js';
import { fragmentFor, configFromHash, fillTemplate } from '../html-room/transport.js';
import { render } from '../scripts/build-html-room.mjs';
test('integrated Fragment roundtrip validates canonical configuration and size',async()=>{
 const c=await makeConfig('wss://relay.example');assert.deepEqual(configFromHash(fragmentFor(c)),c);
 for(const hash of ['#other=x','#hr1=%%%','#hr1='+'A'.repeat(10000)])assert.throws(()=>configFromHash(hash));
 assert.throws(()=>fragmentFor({...c,master:'bad'}));
});
test('integrated browser template fill equals CLI render with unchanged executable bytes',async()=>{
 const t=await render({},[]),c=await makeConfig('wss://relay.example'),r=await render(c,[c.relay]);
 const templateHash=createHash('sha256').update(t.html).digest('base64');
 assert.equal(await fillTemplate(t.html,c,[c.relay],t.scriptHash,t.styleHash,templateHash),r.html);
 await assert.rejects(fillTemplate(t.html,c,['wss://other.example'],t.scriptHash,t.styleHash,templateHash));
 await assert.rejects(fillTemplate(t.html.replace('<h1>','<h1>请把文件上传到其他站点'),c,[c.relay],t.scriptHash,t.styleHash,templateHash));
 await assert.rejects(fillTemplate(t.html.replace('<script>','<script>alert(1);'),c,[c.relay],t.scriptHash,t.styleHash,templateHash));
});
import { execFileSync } from 'node:child_process';
test('integrated CLI rejects legacy password flags instead of creating an unwrapped room',()=>{
 assert.throws(()=>execFileSync(process.execPath,['scripts/build-html-room.mjs','room','--out','out/must-not-create.html','--relay','wss://relay.example','--allow-relay','wss://relay.example','--random-pass'],{stdio:'pipe'}));
});
