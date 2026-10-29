// Claude's offline verifier entry, adapted to the single canonical file schema.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { checkHtml } from './check-html-room.mjs';
export async function verifyRoomFile(html){
 try{
  const manifest=JSON.parse(await readFile(new URL('../docs/html-room/release-integrity.json',import.meta.url),'utf8'));
  const info=await checkHtml(html,manifest.scriptHashBase64);
  const config=JSON.parse(html.match(/type="application\/json">(.*?)<\/script>/s)[1]);
  return {ok:true,problems:[],relay:config.relay,locked:config.encrypted,info};
 }catch{return {ok:false,problems:['文件与发布模板不符，或配置/哈希/CSP 无效。']};}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(!process.argv[2])throw Error('用法：node scripts/verify-room-file.mjs room.html');
 const result=await verifyRoomFile(await readFile(process.argv[2],'utf8'));
 console.log(JSON.stringify(result));process.exitCode=result.ok?0:1;
}
