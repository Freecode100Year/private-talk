import { unlock, validate, hex } from './crypto.js';
import { Session } from './session.js';
const el=id=>document.getElementById(id), status=text=>{el('status').textContent=text;};
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
 const ws=new WebSocket(`${config.relay}/hr/${config.roomId}`,['pt2',`a${hex(session.d.access)}`,...(session.resume?[`r${session.resume}`]:[])]);session.ws=ws;
 ws.onmessage=e=>{try{const m=JSON.parse(e.data);session.run(()=>session.incoming(m));}catch{status('中继数据格式错误');}};
 ws.onopen=()=>status('已连接中继，正在验证成员密钥…');
 ws.onerror=()=>status('连接失败，请检查中继网络与证书。');
 ws.onclose=()=>status('连接已断开');
}
if(config.version){
 try{validate(config);status(config.encrypted?'请输入口令解锁；解锁前不会连接中继。':'无口令文件：点击进入房间。');}catch{status('配置无效，请重新生成文件。');el('enter').disabled=true;}
}else{status('无秘密模板：请使用生成器创建房间文件。');el('enter').disabled=true;}
el('unlock').addEventListener('submit',async e=>{e.preventDefault();try{
 const derived=await unlock(config,el('password').value);el('password').value='';session=new Session(derived,config,{emit});el('unlock').hidden=true;el('chat').hidden=false;connect();
}catch{status('解锁失败：口令或文件不正确。');}});
el('chat').addEventListener('submit',e=>{e.preventDefault();if(session?.queue(el('text').value))el('text').value='';else status('消息为空、过长或队列已满。');});
