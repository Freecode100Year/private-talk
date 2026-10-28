import { unlock } from './crypto.js';
const c=JSON.parse(document.getElementById('pt-room-config').textContent);
const status=document.getElementById('status');
status.textContent=c.version ? '单文件房间已载入，聊天模块待初始化。' : '无秘密模板：请用生成器创建房间文件。';
if(c.version)document.getElementById('unlock').addEventListener('submit',async e=>{e.preventDefault();try{await unlock(c,document.getElementById('password').value);status.textContent='房间配置验证成功。';}catch{status.textContent='解锁失败：口令或文件不正确。';}});
