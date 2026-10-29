import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { render } from './build-html-room.mjs';
import { validate } from '../html-room/crypto.js';
const hash=s=>createHash('sha256').update(s).digest('base64');
export async function checkHtml(html, expected) {
 const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
 if(scripts.length!==2 || scripts[0][1]!==' id="pt-room-config" type="application/json"' || scripts[1][1]!=='')throw Error('脚本结构改变');
 const config=JSON.parse(scripts[0][2]);if(config.version)validate(config);
 const canonical=await render(config,config.version?[config.relay]:[]);
 if(canonical.html!==html)throw Error('HTML/CSP/脚本与可复现构建不符');
 if(hash(scripts[1][2])!==expected)throw Error('固定脚本哈希不符');
 if(/\sstyle\s*=/i.test(html) || /<(?:img|iframe|link)\b/i.test(html))throw Error('外部资源或内联样式');
 return {bytes:Buffer.byteLength(html),scriptHash:expected,csp:canonical.csp};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const manifest=JSON.parse(await readFile(new URL('../docs/html-room/release-integrity.json',import.meta.url),'utf8'));
 for(const path of process.argv.slice(2))console.log(JSON.stringify({path,...await checkHtml(await readFile(path,'utf8'),manifest.scriptHashBase64)}));
}
