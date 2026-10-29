import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { makeConfig } from '../html-room/crypto.js';
import { render } from '../scripts/build-html-room.mjs';
const dir=await mkdtemp(tmpdir()+'/pt-hr-e2e-');
const port=Number(process.env.HR_TEST_PORT||18973),relay=`ws://127.0.0.1:${port}`;
const server=process.env.HR_EXTERNAL_RELAY?null:spawn(process.execPath,['server/server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
let browser,tlsServer;
try{
 for(let i=0;i<60;i++){try{if((await fetch(`http://127.0.0.1:${port}/healthz`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true});
 const config=await makeConfig(relay),r=await render(config,[relay]);
 const path=dir+'/room.html';await writeFile(path,r.html,{mode:0o600});
 const contexts=await Promise.all([browser.newContext(),browser.newContext()]);
 const pages=await Promise.all(contexts.map(c=>c.newPage()));
 const errors=[],requests=[],sockets=[];
 for(const p of pages){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});p.on('request',req=>requests.push(req.url()));p.on('websocket',w=>sockets.push(w.url()));await p.goto(pathToFileURL(path).href);await p.locator('#enter').click();}
 for(const p of pages)await p.locator('#status').filter({hasText:'已建立签名混合加密连接'}).waitFor({timeout:15000});
 const send=async(p,text)=>{await p.locator('#text').fill(text);await p.locator('#send').click();};
 await send(pages[0],'第一端 <script> 不执行');await pages[1].getByText('1：第一端 <script> 不执行',{exact:true}).waitFor({timeout:10000});
 await pages[0].getByText('客户端确认 1/1',{exact:true}).waitFor({timeout:10000});
 await send(pages[1],'第二端 双向确认');await pages[0].getByText('2：第二端 双向确认',{exact:true}).waitFor({timeout:10000});
 await pages[1].getByText('客户端确认 1/1',{exact:true}).waitFor({timeout:10000});
 assert.deepEqual(errors,[]);assert.ok(requests.every(u=>u.startsWith('file:')));assert.ok(sockets.every(u=>u===`${relay}/hr/${config.roomId}`));
 for(const c of contexts)assert.deepEqual(await c.cookies(),[]);
 for(const p of pages)assert.equal(await p.evaluate(async()=>({local:localStorage.length,session:sessionStorage.length,dbs:(await indexedDB.databases()).length})).then(x=>JSON.stringify(x)),JSON.stringify({local:0,session:0,dbs:0}));
 // Offline/reconnect with the same in-memory session and a queued message.
 await contexts[0].setOffline(true);await pages[0].waitForTimeout(300);await send(pages[0],'重连排队消息');await contexts[0].setOffline(false);
 await pages[1].getByText('1：重连排队消息',{exact:true}).waitFor({timeout:20000});
 // Wrapped room never opens a sensitive socket before successful unlock.
 const pass='browser test long random passphrase',wrapped=await makeConfig(relay,pass),wr=await render(wrapped,[relay]);
 const wp=dir+'/wrapped.html';await writeFile(wp,wr.html,{mode:0o600});
 const w=await contexts[1].newPage();let opened=0;w.on('websocket',()=>opened++);await w.goto(pathToFileURL(wp).href);
 await w.locator('#password').fill('wrong');await w.locator('#enter').click();await w.getByText(/解锁失败/).waitFor();assert.equal(opened,0);
 await w.locator('#enter').waitFor({state:'visible'});await w.waitForFunction(()=>!document.getElementById('enter').disabled);
 await w.locator('#password').fill(pass);const socketOpened=w.waitForEvent('websocket',{timeout:5000});await w.locator('#enter').click();await w.waitForFunction(()=>document.getElementById('unlock').hidden);await socketOpened;assert.equal(opened,1);

 // Real TLS rejection: an untrusted certificate must fail without disabling verification.
 const cert=dir+'/cert.pem',key=dir+'/key.pem';
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
 const tlsPort=port+2,tlsRelay=`wss://127.0.0.1:${tlsPort}`;
 tlsServer=spawn(process.execPath,['server/server.mjs'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(tlsPort),TLS_CERT:cert,TLS_KEY:key},stdio:'ignore'});
 await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,700);tlsServer.once('exit',()=>{clearTimeout(timer);reject(Error('TLS fixture server exited'));});});
 const tlsConfig=await makeConfig(tlsRelay),tlsHtml=await render(tlsConfig,[tlsRelay]);const tlsPath=dir+'/tls.html';await writeFile(tlsPath,tlsHtml.html,{mode:0o600});
 const tp=await contexts[0].newPage();await tp.goto(pathToFileURL(tlsPath).href);await tp.locator('#enter').click();await tp.locator('#status').filter({hasText:'证书信任问题'}).waitFor({timeout:7000});await tp.close();
 console.log(JSON.stringify({browser:browser.version(),checks:11,result:'pass',fileBytes:r.bytes,scriptHash:r.scriptHash,consoleErrors:errors.length,httpExternalRequests:requests.filter(u=>!u.startsWith('file:')).length}));
}finally{await browser?.close();server?.kill('SIGTERM');tlsServer?.kill('SIGTERM');await rm(dir,{recursive:true,force:true});}
