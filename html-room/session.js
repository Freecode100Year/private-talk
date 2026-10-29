import { Group } from '../dist/group.js';
import { checkKeys, checkEnvelope, checkMessage, envelope } from '../dist/state.js';
import { hex, random, sealAnnouncement, openAnnouncement } from './crypto.js';
export const memoryStorage = () => new Map();
// Explicit injection for tests only; no browser persistence API is used.
export class Session {
  constructor(derived, config, {storage=memoryStorage(),emit=()=>{}}={}) {
    Object.assign(this,{d:derived,config,store:storage,emit,deviceId:hex(random(16)),present:[],pins:new Map(),seen:new Map(),own:new Map(),queued:[],receipts:[],received:new Map(),group:null,ws:null,serial:Promise.resolve()});
    this.store.set('deviceId',this.deviceId);
  }
  run(fn) { this.serial=this.serial.then(()=>{if(!this.stopped)return fn();}).catch(()=>this.emit('notice','收到无法验证的数据，已忽略。'));return this.serial; }
  send(frame) { if(!this.stopped && this.ws?.readyState===1)this.ws.send(JSON.stringify(frame)); }
  async announce(hello=false) {
    if(!this.group)return;
    const owed=this.group.owed(this.present);
    if(!hello && !owed.length)return;
    for(const text of await this.group.announceAll(owed,hello))this.send({type:'key',...await sealAnnouncement(this.d,text)});
  }
  ready() { return !this.stopped && this.group && this.present.length>1 && this.group.ready(this.present,true) && this.group.quantumSafe(this.present); }
  async incoming(m) {
    if(this.stopped)return;
    if(m.type==='pong'){this.lastPong=Date.now();return;}
    if(m.type==='wait'){this.nextSend=Date.now()+Math.min(30000,Math.max(1000,m.ms||6000));return;}
    if(m.type==='hello') {
      this.resume=m.resume;
      if(!this.group || this.group.me!==m.you){this.group=await Group.create(this.d.key,this.d.bind,m.you);this.own.clear();this.received.clear();this.receipts=[];this.present=[];}
      await this.announce(true);return;
    }
    if(!this.group)return;
    if(m.type==='members') {
      if(!Array.isArray(m.members) || m.members.some(n=>!Number.isInteger(n)||n<1||n>25))return;
      const left=this.present.filter(n=>!m.members.includes(n));
      for(const n of left){this.group.forget(n);for(const key of this.received.keys())if(key.startsWith(`${n}|`))this.received.delete(key);}
      this.present=m.members;
      if(left.length)await this.group.rekey();
      await this.announce(true);this.emit('presence',this.present.length);await this.update();return;
    }
    if(m.from===this.group.me) {
      const own=this.own.get(m.h);
      if(m.type==='msg' && own && own.frame.iv===m.iv && own.frame.ct===m.ct){own.echo=true;this.emit('delivery',{id:own.id,text:'已提交中继'});}
      return;
    }
    if(!this.present.includes(m.from))return;
    if(m.type==='key') {
      const a=checkKeys(await openAnnouncement(this.d,m),m,this.seen);
      if(!a || a.v!==32 || !a.spk)return;
      const pinned=this.pins.get(m.from);
      const p=await this.group.receive(a,m.from); // verifies ECDSA before pinning
      if(!p)return;
      if(pinned && pinned!==p.spk){this.halt();this.emit('fatal','成员签名身份发生变化，请通过独立渠道核实并重新打开文件。');return;}
      this.pins.set(m.from,p.spk);
      if(p?.lost)p.sent=-1;
      await this.announce();await this.update();return;
    }
    if(!['msg','seen'].includes(m.type) || !m.h)return;
    const receiptKey=`${m.from}|${m.h}`, prior=this.received.get(receiptKey);
    if(prior){if(m.type==='msg' && prior.iv===m.iv && prior.ct===m.ct && this.receipts.length<100)this.receipts.push([m.from,m.h]);return;}
    const opened=await this.group.open(m,m.from);
    if(!opened.signed || this.group.peers.get(m.from)?.v!==32)return;
    if(m.type==='seen') {
      const a=checkKeys(opened.text,m,this.seen,Date.now(),'seen');
      if(a && Array.isArray(a.l) && a.l.length<=25)for(const item of a.l){
        if(!Array.isArray(item) || item[0]!==this.group.me)continue;
        const own=this.own.get(item[1]);
        if(own && own.targets.includes(m.from)){own.confirmed.add(m.from);this.emit('delivery',{id:own.id,text:`客户端确认 ${own.confirmed.size}/${own.targets.length}`});}
      }
    } else {
      const got=checkEnvelope(opened.text,m,this.seen);
      if(!got || got.g || got.f)return;
      this.received.set(receiptKey,{iv:m.iv,ct:m.ct});while(this.received.size>200)this.received.delete(this.received.keys().next().value);
      this.emit('message',{id:got.id,from:m.from,text:got.text});
      if(this.receipts.length<100)this.receipts.push([m.from,m.h]);
    }
  }
  async update() {
    if(this.ready())this.emit('ready',await this.group.safetyCode(this.present));
    await this.flush();
  }
  queue(text) {
    if(this.stopped)return false;
    text=checkMessage(text);if(!text || this.queued.length>=20)return false;
    const id=hex(random(8));this.queued.push({id,text});this.emit('message',{id,from:'我',text});this.emit('delivery',{id,text:'排队中'});
    this.run(()=>this.flush());return true;
  }
  async flush() {
    if(!this.ready() || this.ws?.readyState!==1)return;
    if(this.group.due()){await this.group.rekey();await this.announce();}
    if(!this.ready())return;
    if(this.receipts.length){
      const plain=JSON.stringify({kind:'seen',id:hex(random(8)),from:this.group.me,t:Date.now(),l:this.receipts.splice(0,25)});
      this.send({type:'seen',...await this.group.seal(plain)});
    }
    // Match the existing relay's message spacing, keeping a bounded memory queue.
    if(this.queued.length && Date.now()>=(this.nextSend??0)){
      const q=this.queued.shift(), frame={type:'msg',...await this.group.seal(envelope(this.group.me,q.text))};
      this.own.set(frame.h,{...q,frame,targets:this.present.filter(n=>n!==this.group.me),confirmed:new Set(),at:Date.now()});
      while(this.own.size>100)this.own.delete(this.own.keys().next().value);
      this.send(frame);this.nextSend=Date.now()+6100;
    }
    for(const [id,t] of this.seen)if(Date.now()-t>1200000)this.seen.delete(id);
    while(this.seen.size>4096)this.seen.delete(this.seen.keys().next().value);
  }
  async retryPending(){
    for(const own of this.own.values()){
      if(!own.echo && Date.now()-own.at>8000 && (own.retries??0)<3){this.send(own.frame);own.at=Date.now();own.retries=(own.retries??0)+1;}
      if(!own.echo && (own.retries??0)>=3)this.emit('delivery',{id:own.id,text:'中继提交未确认，请核实后重发'});
    }
  }
  halt(){this.stopped=true;clearTimeout(this.retry);clearInterval(this.tick);this.ws?.close(4000);}
}
