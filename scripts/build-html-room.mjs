import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeConfig, relayOrigin, validate } from '../html-room/crypto.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=s=>createHash('sha256').update(s).digest('base64');
export const escapeConfig=c=>JSON.stringify(c).replace(/[<>/\u2028\u2029]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
export async function render(config, allowed=[]) {
 if(config.version){validate(config);if(!allowed.map(relayOrigin).includes(config.relay))throw Error('中继源不在明确白名单内');}
 const result=await build({entryPoints:[root+'html-room/client.js'],bundle:true,write:false,format:'iife',target:['es2020'],minify:true,legalComments:'none'});
 const script=result.outputFiles[0].text.trimEnd();
 if(/<\/script/i.test(script))throw Error('可执行脚本含不安全结束标签');
 const style=(await readFile(root+'html-room/style.css','utf8')).trimEnd();
 const scriptHash=hash(script),styleHash=hash(style);
 const csp=`default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; connect-src ${config.version?config.relay:"'none'"}; base-uri 'none'; form-action 'none'`;
 const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><title>私密 HTML 聊天房间</title><style>${style}</style></head><body><h1>私密聊天房间</h1><aside id="risk">此文件包含完整房间密钥，请勿通过未加密的社交软件直接发送。口令模式也可被离线猜测；建议高熵密码，通过独立渠道传递口令。</aside><p id="status" role="status">正在自检…</p><form id="unlock"><label for="password">房间口令（无口令文件可直接进入）</label><input id="password" type="password" maxlength="1024" autocomplete="off"><button id="enter">解锁并进入</button></form><p id="presence"></p><p id="safety"></p><ol id="messages" aria-live="polite"></ol><form id="chat" hidden><label for="text">消息（最多 500 字）</label><textarea id="text" maxlength="500"></textarea><button id="send">发送</button></form><script id="pt-room-config" type="application/json">${escapeConfig(config)}</script><script>${script}</script></body></html>\n`;
 return {html,scriptHash,styleHash,csp,bytes:Buffer.byteLength(html)};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [output,relay,...allowed]=process.argv.slice(2);
 if(!output)throw Error('用法：node scripts/build-html-room.mjs out/room.html wss://relay.example wss://relay.example （从标准输入可选读取口令，HR_PASSWORD_STDIN=1）');
 let pass;
 if(process.env.HR_PASSWORD_STDIN==='1'){let s='';for await(const chunk of process.stdin){s+=chunk;if(Buffer.byteLength(s)>4096)throw Error('输入过长');}pass=s.replace(/\r?\n$/,'');if(!pass)throw Error('口令不能为空');}
 const config=relay?await makeConfig(relay,pass):{};
 const r=await render(config,allowed);
 await mkdir(new URL('../out/',import.meta.url),{recursive:true});
 await writeFile(output,r.html,{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({bytes:r.bytes,scriptHash:r.scriptHash,styleHash:r.styleHash}));
}
