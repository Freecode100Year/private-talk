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
import { escapeConfig } from '../scripts/build-html-room.mjs';
import { sealAnnouncement, openAnnouncement, hex } from '../html-room/crypto.js';
import { Session, memoryStorage } from '../html-room/session.js';
import { Group } from '../dist/group.js';
test('HTML Room JSON script terminators and unicode cannot escape inert config',()=>{
 const payload={text:'</script><img src=x onerror=alert(1)>/\u2028\u2029'};const out=escapeConfig(payload);
 assert.doesNotMatch(out,/[<>/\u2028\u2029]/);assert.deepEqual(JSON.parse(out),payload);
});
test('HTML Room announcement nonce uniqueness, padding, tamper and room AAD',async()=>{
 const d=await unlock(await makeConfig('wss://relay.example'));const a=await sealAnnouncement(d,'hello'),b=await sealAnnouncement(d,'hello');
 assert.notEqual(a.iv,b.iv);assert.equal(Buffer.from(a.iv,'base64').length,12);assert.equal(Buffer.from(a.ct,'base64').length,272);assert.equal(await openAnnouncement(d,a),'hello');
 await assert.rejects(openAnnouncement({...d,roomId:'0'.repeat(64)},a));
 await assert.rejects(openAnnouncement(d,{...a,ct:(a.ct[0]==='A'?'B':'A')+a.ct.slice(1)}));
});
async function pair(){
 const config=await makeConfig('wss://relay.example'),d=await unlock(config);
 const events=[[],[]], a=new Session(d,config,{emit:(...e)=>events[0].push(e)}),b=new Session(d,config,{emit:(...e)=>events[1].push(e)});
 a.group=await Group.create(d.key,d.bind,1);b.group=await Group.create(d.key,d.bind,2);a.present=b.present=[1,2];
 // Transport drives the exact Session handlers, preserving the serialized frame order.
 const frames=[];
 a.ws={readyState:1,send:raw=>frames.push([b,{...JSON.parse(raw),from:1,at:Date.now()}])};
 b.ws={readyState:1,send:raw=>frames.push([a,{...JSON.parse(raw),from:2,at:Date.now()}])};
 const drain=async()=>{let budget=50;while(frames.length){if(--budget<0)throw Error('announcement loop');const [s,m]=frames.shift();await s.incoming(m);}};
 await a.announce(true);await b.announce(true);await drain();assert.ok(a.ready());assert.ok(b.ready());
 return {a,b,events,frames,drain,config,d};
}
test('HTML Room v3 signed chat and receipt, replay and forged receipt rejection',async()=>{
 const {a,b,events,frames,drain}=await pair();
 a.queue('secret chat');await a.serial;const msg=frames.find(([,m])=>m.type==='msg')[1];await drain();
 assert.equal(events[1].filter(([k])=>k==='message').length,1);
 await b.incoming(msg);assert.equal(events[1].filter(([k])=>k==='message').length,1);
 await b.flush();await drain();assert.ok(events[0].some(([k,v])=>k==='delivery'&&v.text==='客户端确认 1/1'));
 const h=[...a.own.keys()][0];const own=a.own.get(h);own.confirmed.clear();
 const fake={type:'seen',from:2,h:'0.999',iv:msg.iv,ct:msg.ct};await assert.rejects(a.incoming(fake));assert.equal(own.confirmed.size,0);
});
test('HTML Room sessions have independent memory identity and reject identity changes',async()=>{
 const {a,b,d,config,events}=await pair();
 assert.notEqual(a.deviceId,b.deviceId);assert.notEqual(a.store,b.store);assert.notEqual(memoryStorage(),memoryStorage());
 const stranger=await Group.create(d.key,d.bind,2);const text=await stranger.announce([],true);
 // halt is exercised without a real socket.
 a.ws.close=()=>{};await a.incoming({type:'key',from:2,...await sealAnnouncement(d,text)});
 assert.ok(a.stopped);assert.ok(events[0].some(([k])=>k==='fatal'));
 assert.equal('deviceId' in config,false);
});
test('HTML Room replayed and expired announcements are ignored',async()=>{
 const {a,b,d}=await pair();const announcement=await b.group.announce([],false);const m={type:'key',from:2,...await sealAnnouncement(d,announcement)};
 await a.incoming(m);const size=a.seen.size;await a.incoming(m);assert.equal(a.seen.size,size);
 const stale=await b.group.announce([],false,Date.now()-700000);await a.incoming({type:'key',from:2,...await sealAnnouncement(d,stale)});assert.equal(a.seen.size,size);
});
test('HTML Room relay host rejects CSP/meta attribute injection',async()=>{
 for(const relay of ['wss://x%22evil',"wss://x';script-src",'wss://x;foo','wss://user:pass@relay.example','ws://remote.example'])await assert.rejects(makeConfig(relay));
});
import { checkHtml } from '../scripts/check-html-room.mjs';
test('HTML Room equivalent integrity check detects modified code and CSP',async()=>{
 const c=await makeConfig('wss://relay.example'),r=await render(c,[c.relay]);assert.equal((await checkHtml(r.html,r.scriptHash)).bytes,r.bytes);
 await assert.rejects(checkHtml(r.html.replace("default-src 'none'","default-src *"),r.scriptHash));
 await assert.rejects(checkHtml(r.html.replace('<script>','<script>alert(1);'),r.scriptHash));
});
test('HTML Room pins verified identity across relay departure and number reuse',async()=>{
 const {a,b,d,events}=await pair();a.ws.close=()=>{};
 await a.incoming({type:'members',members:[1]});await a.incoming({type:'members',members:[1,2]});
 const replacement=await Group.create(d.key,d.bind,2);
 await a.incoming({type:'key',from:2,...await sealAnnouncement(d,await replacement.announce([],true))});
 assert.ok(a.stopped);assert.ok(events[0].some(([k])=>k==='fatal'));
 const length=events[0].length;await a.incoming({type:'members',members:[1,2,3]});assert.equal(events[0].length,length);assert.equal(a.queue('after halt'),false);
});
