import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeConfig, relayOrigin, validate } from '../html-room/crypto.js';
import { escapeConfig, previewHelp } from '../html-room/transport.js';
export { escapeConfig };
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=s=>createHash('sha256').update(s).digest('base64');
export async function render(config, allowed=[]) {
 if(config.version){validate(config);if(!allowed.map(relayOrigin).includes(config.relay))throw Error('中继源不在明确白名单内');}
 const result=await build({entryPoints:[root+'html-room/file.js'],bundle:true,write:false,format:'iife',target:['es2020'],minify:true,legalComments:'none'});
 const script=result.outputFiles[0].text.trimEnd();
 if(/<\/script/i.test(script))throw Error('可执行脚本含不安全结束标签');
 const style=(await readFile(root+'html-room/style.css','utf8')).trimEnd();
 const scriptHash=hash(script),styleHash=hash(style);
 const csp=`default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; connect-src ${config.version?config.relay:"'none'"}; base-uri 'none'; form-action 'none'`;
 const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><title>私密 HTML 聊天房间</title><style>${style}</style></head><body><h1>私密聊天房间</h1><aside id="risk">此文件包含完整房间密钥，请勿通过未加密的社交软件直接发送。口令模式也可被离线猜测；建议高熵密码，通过独立渠道传递口令。</aside><p id="status" role="status">聊天脚本尚未启动，请查看下方浏览器打开说明。</p>${previewHelp(config)}<form id="unlock"><label for="password">房间口令（无口令文件可直接进入）</label><input id="password" disabled type="password" maxlength="1024" autocomplete="off"><button id="enter" disabled>解锁并进入</button></form><p id="presence"></p><p id="safety"></p><ol id="messages" aria-live="polite"></ol><form id="chat" hidden><label for="text">消息（最多 500 字）</label><textarea id="text" maxlength="500"></textarea><button id="send">发送</button></form><script id="pt-room-config" type="application/json">${escapeConfig(config)}</script><script>${script}</script></body></html>\n`;
 return {html,scriptHash,styleHash,csp,bytes:Buffer.byteLength(html)};
}
export async function buildWeb(check=false) {
 const t=await render({},[]),style=(await readFile(root+'html-room/style.css','utf8')).trimEnd();
 const built=await build({entryPoints:[root+'html-room/web.js'],bundle:true,write:false,format:'iife',target:['es2020'],minify:true,legalComments:'none',define:{PT_SCRIPT_HASH:JSON.stringify(t.scriptHash),PT_STYLE_HASH:JSON.stringify(t.styleHash),PT_TEMPLATE_HASH:JSON.stringify(hash(t.html))}});
 const maker=`<form id="maker"><h1>创建 HTML 房间</h1><p>同一份文件进入同一聊天房间，生成过程在本浏览器内完成。</p><label for="mk-relay">中继源（必须支持本分支 /hr/ 路由）</label><input id="mk-relay" required maxlength="200"><label for="mk-pass">可选打开口令（建议随机生成，通过独立渠道传递）</label><input id="mk-pass" type="password" maxlength="1024" autocomplete="off"><button id="mk-gen" type="button">随机生成高熵口令</button><button id="mk-make">创建房间</button><p id="mk-error" role="status"></p><section id="mk-out" hidden><a id="mk-download" download="private-talk-room.html">下载房间文件</a><section id="mk-link-row" hidden><p>网页入口代码可读取 Fragment；其安全性不等同于经过验证的离线文件。手机预览兼容性仍未验证。</p><input id="mk-link" readonly aria-label="房间链接"><button id="mk-copy" type="button">复制网页链接</button></section></section></form>`;
 const body=t.html.match(/<body>([\s\S]*?)<script id="pt-room-config"/)[1];
 const page=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'"><title>HTML Room · 创建或进入房间</title><link rel="stylesheet" href="hr.css"><script defer src="hr.js"></script></head><body>${maker}<section id="room-panel" hidden>${body}</section></body></html>\n`;
 const files={'hr-template.html':t.html,'hr.js':built.outputFiles[0].text,'hr.css':style+'\n','hr.html':page};
 for(const [name,text] of Object.entries(files)){
  const path=root+'dist/'+name;
  if(check){if(await readFile(path,'utf8')!==text)throw Error(name+' 与源码构建不符');}
  else await writeFile(path,text);
 }
 return {scriptHash:t.scriptHash,styleHash:t.styleHash};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args[0]==='template' && (args.length>2 || args.slice(1).some(x=>x!=='--check')))throw Error('template 仅支持 --check');
 if(args[0]==='template'){console.log(JSON.stringify(await buildWeb(args.includes('--check'))));process.exit(0);}
 let output,relay,allowed;
 if(args[0]==='room'){
  const flags=args.slice(1);
  if(flags.length%2 || flags.some((value,i)=>i%2===0&&!['--out','--relay','--allow-relay'].includes(value)) || new Set(flags.filter((_,i)=>i%2===0)).size!==flags.length/2)throw Error('room 仅支持 --out、--relay、--allow-relay；口令请用 HR_PASSWORD_STDIN');
  const get=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  output=get('--out');relay=get('--relay');allowed=[get('--allow-relay')].filter(Boolean);
  if(!output||!relay||!allowed.length)throw Error('room 需要 --out、--relay 与明确 --allow-relay');
 }else{[output,relay,...allowed]=args;}
 if(!output)throw Error('用法：node scripts/build-html-room.mjs out/room.html wss://relay.example wss://relay.example （从标准输入可选读取口令，HR_PASSWORD_STDIN=1）');
 let pass;
 if(process.env.HR_PASSWORD_STDIN==='1'){let s='';for await(const chunk of process.stdin){s+=chunk;if(Buffer.byteLength(s)>4096)throw Error('输入过长');}pass=s.replace(/\r?\n$/,'');if(!pass)throw Error('口令不能为空');}
 const config=relay?await makeConfig(relay,pass):{};
 const r=await render(config,allowed);
 await mkdir(new URL('../out/',import.meta.url),{recursive:true});
 await writeFile(output,r.html,{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({bytes:r.bytes,scriptHash:r.scriptHash,styleHash:r.styleHash}));
}
