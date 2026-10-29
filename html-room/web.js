// Adapted from Claude's hr.js maker/Fragment entry; cryptography and chat
// use the canonical protocol modules shared with standalone files.
import { boot } from './client.js';
import { makeConfig, relayOrigin, hex, random } from './crypto.js';
import { configFromHash, fragmentFor, fillTemplate } from './transport.js';
const fragment=location.hash;
if(fragment)history.replaceState(null,'',location.pathname+location.search);
const el=id=>document.getElementById(id);
const ownRelay=location.origin.replace(/^http/,'ws');
let downloadUrl;
function fail(text){el('mk-error').textContent=text;}
function openFragment(fragment){
 if(location.hash)history.replaceState(null,'',location.pathname+location.search);
 if(!el('room-panel').hidden){el('status').textContent='请在新窗口打开其他房间链接，当前会话不会自动切换。';return;}
 el('maker').hidden=true;el('room-panel').hidden=false;
 try{
  const config=configFromHash(fragment);
  if(config.relay!==ownRelay)throw Error('网页入口仅允许本站中继，请用房间文件连接其他中继。');
  boot(config);
 }catch{el('status').textContent='房间链接无效，或中继与本站不匹配。请重新索取链接或使用验证过的房间文件。';el('enter').disabled=true;}
}
addEventListener('hashchange',()=>{if(location.hash)openFragment(location.hash);});
if(fragment)openFragment(fragment);
else{
 el('mk-relay').value=ownRelay;
 el('mk-gen').addEventListener('click',()=>{el('mk-pass').value=hex(random(32));});
 el('maker').addEventListener('submit',async event=>{
  event.preventDefault();el('mk-make').disabled=true;fail('');el('mk-out').hidden=true;
  try{
   const relay=relayOrigin(el('mk-relay').value),password=el('mk-pass').value;
   if(password && new TextEncoder().encode(password).length>1024)throw Error('口令过长');
   // The submitted relay is the explicit one-item generation allowlist.
   const config=await makeConfig(relay,password||undefined);
   const response=await fetch('hr-template.html',{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
   if(!response.ok)throw Error('模板不可用');
   const html=await fillTemplate(await response.text(),config,[relay],PT_SCRIPT_HASH,PT_STYLE_HASH,PT_TEMPLATE_HASH);
   if(downloadUrl)URL.revokeObjectURL(downloadUrl);
   downloadUrl=URL.createObjectURL(new Blob([html],{type:'text/html'}));
   el('mk-download').href=downloadUrl;el('mk-out').hidden=false;
   el('mk-pass').value='';
   if(relay===ownRelay){el('mk-link').value=location.origin+location.pathname+fragmentFor(config);el('mk-link-row').hidden=false;}
   else{el('mk-link').value='';el('mk-link-row').hidden=true;}
   fail(password?'文件已包装。请通过独立渠道传递口令；仍须防范离线猜测。':'此文件包含完整房间密钥，请勿通过未加密的社交软件直接发送。');
  }catch{fail('生成失败。请检查中继地址、环境和模板完整性。');}
  finally{el('mk-make').disabled=false;}
 });
 el('mk-copy').addEventListener('click',()=>navigator.clipboard?.writeText(el('mk-link').value).then(()=>fail('已复制。链接包含加入能力，请谨慎分发。'),()=>fail('无法自动复制，请手动复制链接。')));
}
addEventListener('pagehide',()=>{if(downloadUrl)URL.revokeObjectURL(downloadUrl);});
