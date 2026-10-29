import { validate, relayOrigin } from './crypto.js';
export const escapeConfig=c=>JSON.stringify(c).replace(/[<>/\u2028\u2029]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
const encode=s=>btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function fragmentFor(config){validate(config);return '#hr1='+encode(JSON.stringify(config));}
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
 return template.replace(marker,`<meta http-equiv="Content-Security-Policy" content="${csp.replace("connect-src 'none'",`connect-src ${config.relay}`)}">`).replace('<script id="pt-room-config" type="application/json">{}</script>',`<script id="pt-room-config" type="application/json">${escapeConfig(config)}</script>`);
}
