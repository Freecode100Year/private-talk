import { unlock, validate, hex } from './crypto.js';
import { Session } from './session.js';
const el=id=>document.getElementById(id), status=text=>{el('status').textContent=text;};
let attempts=0,busy=false,nextUnlock=0;
let config=JSON.parse(el('pt-room-config').textContent),session;
const rows=new Map();
function emit(kind,value){
 if(kind==='notice'||kind==='fatal')status(value);
 if(kind==='presence')el('presence').textContent=`在线 ${value} 人（中继报告）`;
 if(kind==='ready'){status('已建立签名混合加密连接');el('safety').textContent=`安全码：${value}，请通过独立渠道核对。`;}
 if(kind==='message'){const li=document.createElement('li');li.textContent=`${value.from}：${value.text}`;const small=document.createElement('small');li.append(small);el('messages').append(li);rows.set(value.id,small);if(rows.size>200){rows.delete(rows.keys().next().value);el('messages').firstChild.remove();}}
 if(kind==='delivery' && rows.has(value.id))rows.get(value.id).textContent=value.text;
}
function connect(){
 if(session.stopped)return;
 const ws=new WebSocket(`${config.relay}/hr/${config.roomId}`,['pt2',`a${hex(session.d.access)}`,...(session.resume?[`r${session.resume}`]:[])]);session.ws=ws;
 ws.onmessage=e=>{try{const m=JSON.parse(e.data);session.run(()=>session.incoming(m));}catch{status('中继数据格式错误');}};
 ws.onopen=()=>{session.backoff=1000;session.lastPong=Date.now();status('已连接中继，正在验证成员密钥…');};
 ws.onerror=()=>status('WSS 握手失败可能是网络、Origin、鉴权或证书信任问题（含自签名证书）。建议使用有效证书；可先访问对应 HTTPS 地址检查信任，但不能保证所有浏览器允许 WSS。请勿关闭证书校验。');
 ws.onclose=e=>{
  if(session.stopped)return;
  if([4000,4001,4002,4005,4006,4007,4008,1008,1009].includes(e.code)){session.halt();status('连接被拒绝或会话结束，请检查房间文件、中继配置或人数限制后重新打开。');return;}
  session.retry=setTimeout(connect,session.backoff??1000);session.backoff=Math.min((session.backoff??1000)*2,30000);
  if(e.code!==1006)status('连接中断，正在自动重连；待发消息仅保存在本次内存中。');
 };
}
if(!globalThis.crypto?.subtle || !globalThis.WebSocket || !globalThis.TextEncoder){status('此预览环境不支持所需脚本或加密 API，请使用支持的浏览器打开；iOS、微信和 QQ 本地预览需实测。');el('enter').disabled=true;}
else if(config.version){
 try{validate(config);status(config.encrypted?'请输入口令解锁；解锁前不会连接中继。':'无口令文件：点击进入房间。');}catch{status('配置无效，请重新生成文件。');el('enter').disabled=true;}
}else{status('无秘密模板：请使用生成器创建房间文件。');el('enter').disabled=true;}
el('unlock').addEventListener('submit',async e=>{e.preventDefault();if(busy||Date.now()<nextUnlock)return;busy=true;el('enter').disabled=true;try{
 const derived=await unlock(config,el('password').value);el('password').value='';session=new Session(derived,config,{emit});el('unlock').hidden=true;el('chat').hidden=false;connect();
 session.tick=setInterval(()=>session.run(async()=>{
  if(session.ws?.readyState===1){
   if(Date.now()-session.lastPong>65000){session.ws.close();return;}
   if(Date.now()-(session.lastPing??0)>25000){session.send({type:'ping'});session.lastPing=Date.now();}
   if(Date.now()-(session.lastAnnounce??0)>10000){await session.announce(true);session.lastAnnounce=Date.now();}
   await session.flush();await session.retryPending();
  }
 }),1600);
}catch{attempts++;nextUnlock=Date.now()+Math.min(30000,1000*2**Math.min(attempts,5));el('password').value='';status('解锁失败：口令或文件不正确。稍后再试。本机节流不能阻止离线猜测。');}
 finally{busy=false;setTimeout(()=>{el('enter').disabled=false;},Math.max(0,nextUnlock-Date.now()));}});
el('chat').addEventListener('submit',e=>{e.preventDefault();if(session?.queue(el('text').value))el('text').value='';else status('消息为空、过长或队列已满。');});

addEventListener('pagehide',()=>session?.halt());
