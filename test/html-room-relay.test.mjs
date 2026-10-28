import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { makeConfig, unlock, hex } from '../html-room/crypto.js';
let server,base,relay,c,access;
const expectedOrigin=()=>process.env.HR_EXPECTED_ORIGIN||base;
const sockets=[];
before(async()=>{
 if(process.env.HR_RELAY_ORIGIN){base=process.env.HR_RELAY_ORIGIN;relay=base.replace(/^http/,'ws');c=await makeConfig(relay);access=hex((await unlock(c)).access);return;}
 const net=await import('node:net');const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 base=`http://127.0.0.1:${port}`;relay=`ws://127.0.0.1:${port}`;
 server=spawn(process.execPath,['server/server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),JOIN_LIMIT:'1000'},stdio:['ignore','pipe','pipe']});
 for(let i=0;i<50;i++){try{if((await fetch(base+'/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,50));}
 c=await makeConfig(relay);access=hex((await unlock(c)).access);
});
after(async()=>{for(const s of sockets)s.terminate();server?.kill();});
async function connect(path,origin='null',credential=access){
 const ws=new WebSocket(relay+path,['pt2',`a${credential}`],{origin});sockets.push(ws);
 const messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));await once(ws,'open');
 for(let i=0;i<30&&!messages.some(m=>m.type==='hello');i++)await new Promise(r=>setTimeout(r,10));
 return {ws,messages};
}
async function forbidden(path,origin,credential=access){
 const ws=new WebSocket(relay+path,['pt2',`a${credential}`],{origin});sockets.push(ws);
 const code=await new Promise((resolve,reject)=>{ws.on('unexpected-response',(_req,res)=>{res.resume();resolve(res.statusCode);});ws.on('open',()=>reject(Error('unexpected admission for Origin '+origin)));ws.on('error',()=>{});});assert.equal(code,403);
}
test('HTML Room live relay Origin/auth timing and /ws null regression',async()=>{
 // Miniflare's dev proxy normalizes same-host Origin schemes before Worker fetch.
 for(const origin of ['https://evil.example',expectedOrigin()+'/',...(process.env.HR_RELAY_ORIGIN?[]:[base.replace('http:','https:')])])await forbidden('/hr/'+c.roomId,origin);
 await forbidden('/ws/'+c.roomId,'null');await forbidden('/hr/'+c.roomId,'null','0'.repeat(64));
 const {messages}=await connect('/hr/'+c.roomId,expectedOrigin());assert.ok(messages.some(m=>m.type==='hello'));
});
test('HTML Room namespace isolation, v3 receipt h and table/lobby rejection',async()=>{
 const a=await connect('/hr/'+c.roomId), b=await connect('/hr/'+c.roomId), legacy=await connect('/ws/'+c.roomId,expectedOrigin());
 const sealed={iv:Buffer.alloc(12).toString('base64'),ct:Buffer.alloc(272).toString('base64'),h:'0.0'};
 a.ws.send(JSON.stringify({type:'seen',...sealed}));await new Promise(r=>setTimeout(r,80));
 assert.ok(b.messages.some(m=>m.type==='seen'&&m.h==='0.0'));assert.equal(legacy.messages.some(m=>m.type==='seen'),false);
 const count=b.messages.length;
 for(const type of ['table','lobby','ref','lock'])a.ws.send(JSON.stringify({type,playing:true,a:{},locked:true}));
 await new Promise(r=>setTimeout(r,80));assert.equal(b.messages.length,count);
});
