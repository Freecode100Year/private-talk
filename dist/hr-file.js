// The room file's entry (bundled inline by scripts/build-html-room.mjs). The
// configuration is a script element of type application/json: read as text,
// parsed with JSON.parse, checked in hr-core.js. It is never run.
import { boot, errorScreen } from './hr-room.js';

const block = document.getElementById('pt-room-config');
boot({ mode: 'file', text: block ? block.textContent : null }).catch(() => {
  errorScreen('无法打开这个房间', '页面出现了意外错误。请用系统浏览器重新打开这个文件。');
});
