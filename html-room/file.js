import { boot } from './client.js';
try { boot(JSON.parse(document.getElementById('pt-room-config').textContent)); }
catch { document.getElementById('status').textContent='配置无效，请重新获取房间文件。';document.getElementById('enter').disabled=true; }
