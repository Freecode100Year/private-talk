import { validate, relayOrigin } from './crypto.js';
export const escapeConfig=c=>JSON.stringify(c).replace(/[<>/\u2028\u2029]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
const encode=s=>btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function fragmentFor(config){validate(config);return '#hr1='+encode(JSON.stringify(config));}
// Static HTML: still usable when a file preview disables JavaScript or CSP blocks boot.
export function previewHelp(config){
 const link=config.version ? `${config.relay.replace(/^ws/,'http')}/hr.html${fragmentFor(config)}` : '';
 return `<section id="preview-help"><p>若此提示一直显示，当前文件预览未能运行聊天脚本。iOS「文件」、微信或 QQ 的预览可能无法使用此房间；输入口令不会生效。请在 Safari 等浏览器中打开房间网页链接。</p>${link?`<p><a id="preview-link" href="${link.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">在浏览器中打开同一房间</a>（若无法跳转，请复制链接到 Safari 地址栏）。</p><p>链接包含加入房间的能力，请谨慎分发。网页代码可读取链接中的房间配置，其安全性不等同于验证过的离线文件；中继须提供 /hr.html 网页入口。</p>`:''}</section>`;
}
export function configFromHash(hash){
 if(typeof hash!=='string'||!/^#hr1=[A-Za-z0-9_-]+$/.test(hash)||hash.length>8192)throw Error('房间链接格式或长度无效');
 const b64=hash.slice(5).replace(/-/g,'+').replace(/_/g,'/');
 const bytes=Uint8Array.from(atob(b64+'='.repeat((4-b64.length%4)%4)),c=>c.charCodeAt(0));
 if(bytes.length>4096)throw Error('房间配置过长');
 return validate(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
}
const digest=async s=>btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))));
export async function fillTemplate(template,config,allowed,scriptHash,styleHash,templateHash){
 validate(config);if(!allowed.map(relayOrigin).includes(config.relay))throw Error('中继源不在明确白名单内');
 if(template.length>200000)throw Error('模板过长');
 if(await digest(template)!==templateHash)throw Error('完整模板哈希不符');
 const scripts=[...template.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)],styles=[...template.matchAll(/<style>([\s\S]*?)<\/style>/g)];
 if(scripts.length!==2||scripts[0][1]!==' id="pt-room-config" type="application/json"'||scripts[0][2]!=='{}'||scripts[1][1]!==''||styles.length!==1)throw Error('模板结构无效');
 if(await digest(scripts[1][2])!==scriptHash||await digest(styles[0][1])!==styleHash)throw Error('模板完整性不符');
 const csp=`default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; connect-src 'none'; base-uri 'none'; form-action 'none'`;
 const marker=`<meta http-equiv="Content-Security-Policy" content="${csp}">`;
 if(!template.includes(marker))throw Error('模板 CSP 无效');
 return template.replace(marker,`<meta http-equiv="Content-Security-Policy" content="${csp.replace("connect-src 'none'",`connect-src ${config.relay}`)}">`).replace(previewHelp({}),previewHelp(config)).replace('<script id="pt-room-config" type="application/json">{}</script>',`<script id="pt-room-config" type="application/json">${escapeConfig(config)}</script>`);
}
