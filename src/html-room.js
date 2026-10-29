import { checkFrame, MAX_FRAME, originAllowed } from './rules.js';
// Header bearer remains relay-visible. Never log request headers.
export function htmlRoomOrigin(origin, expected) {
  return originAllowed('hr',origin,origin===expected);
}
export function checkHtmlRoomFrame(raw, state, now = Date.now()) {
  if (typeof raw !== 'string' || raw.length > MAX_FRAME) return {close:[1009,'bad frame']};
  let m;try{m=JSON.parse(raw);}catch{return checkFrame(raw,state,now);}
  if (!m || !['ping','key','msg','seen'].includes(m.type)) {
    // Still account for floods without invoking any game/lobby handlers.
    return checkFrame('{"type":"hr-rejected"}',state,now);
  }
  if (['msg','seen'].includes(m.type) && !/^\d{1,9}\.\d{1,9}$/.test(m.h ?? '')) return null;
  const r=checkFrame(raw,state,now);
  if(r?.seen)r.seen.h=m.h;
  return r;
}
