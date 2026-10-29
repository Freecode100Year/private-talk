// Integration of Claude's hosted maker / Fragment scenarios with the shared
// file runtime. The existing file:// suite remains the first verification.
import './html-room.mjs';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const port=Number(process.env.HR_WEB_PORT||19012),base=`http://127.0.0.1:${port}`;
const server=process.env.HR_WEB_EXTERNAL?null:spawn(process.execPath,['server/server.mjs'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1'},stdio:'ignore'});
const dir=await mkdtemp(tmpdir()+'/pt-merged-web-');let browser;
try{
 for(let i=0;i<40;i++){try{if((await fetch(base+'/hr.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true});const a=await browser.newContext(),b=await browser.newContext();
 const maker=await a.newPage(),file=await b.newPage();const errors=[],requests=[];
 for(const p of [maker,file]){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});p.on('request',r=>requests.push(r.url()));}
 await maker.goto(base+'/hr.html');await maker.locator('#mk-make').click();await maker.locator('#mk-out').waitFor({state:'visible'});
 const fragment=await maker.locator('#mk-link').inputValue();assert.ok(fragment.includes('#hr1='));
 const got=maker.waitForEvent('download');await maker.locator('#mk-download').click();const download=await got;const path=dir+'/room.html';await download.saveAs(path);
 const html=await readFile(path,'utf8'),config=JSON.parse(html.match(/type="application\/json">(.*?)<\/script>/s)[1]);
 assert.equal(config.version,1);assert.equal(config.encrypted,false);assert.ok(config.master);
 await maker.goto(fragment);await maker.waitForFunction(()=>location.hash.length===0);assert.equal(new URL(maker.url()).hash.length,0);await maker.locator('#enter').click();
 await file.goto(pathToFileURL(path).href);await file.locator('#enter').click();
 for(const p of [maker,file])await p.locator('#status').filter({hasText:'已建立签名混合加密连接'}).waitFor({timeout:12000});
 await maker.locator('#text').fill('网页到文件');await maker.locator('#send').click();await file.getByText('1：网页到文件',{exact:true}).waitFor({timeout:8000});await maker.getByText('客户端确认 1/1',{exact:true}).waitFor({timeout:8000});
 await file.locator('#text').fill('文件到网页');await file.locator('#send').click();await maker.getByText('2：文件到网页',{exact:true}).waitFor({timeout:8000});await file.getByText('客户端确认 1/1',{exact:true}).waitFor({timeout:8000});
 assert.deepEqual(errors,[]);assert.ok(requests.every(u=>(u.startsWith(base+'/')||u.startsWith('file:'))&&!u.includes('#')&&!u.includes(config.master)));
 for(const c of [a,b])assert.deepEqual(await c.cookies(),[]);
 for(const p of [maker,file])assert.deepEqual(await p.evaluate(async()=>[localStorage.length,sessionStorage.length,(await indexedDB.databases()).length]),[0,0,0]);
 const bad=await a.newPage();let connected=0;bad.on('websocket',()=>connected++);await bad.goto(base+'/hr.html#hr1=invalid');await bad.getByText(/房间链接无效/).waitFor();assert.equal(connected,0);
 const wrapped=await a.newPage();await wrapped.goto(base+'/hr.html');await wrapped.locator('#mk-gen').click();assert.equal((await wrapped.locator('#mk-pass').inputValue()).length,64);await wrapped.locator('#mk-make').click();await wrapped.locator('#mk-out').waitFor({state:'visible'});
 const encoded=new URL(await wrapped.locator('#mk-link').inputValue()).hash.slice(5);const protectedConfig=JSON.parse(Buffer.from(encoded,'base64url').toString());assert.equal(protectedConfig.encrypted,true);assert.equal('master'in protectedConfig,false);
 console.log(JSON.stringify({suite:'integrated hosted maker/Fragment + file interop',checks:9,result:'pass',browser:browser.version(),consoleErrors:0,thirdPartyRequests:0}));
}finally{await browser?.close();server?.kill();await rm(dir,{recursive:true,force:true});}
