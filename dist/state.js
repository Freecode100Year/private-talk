// Rules shared by the page and the tests.
export const MAX_MEMBERS = 8;
export const MAX_TEXT_CHARS = 500;
export const MAX_TEXT_BYTES = 2048;
export const MIN_PASSPHRASE = 8;

// The passphrase is the only credential: whoever knows it is in the room, and
// it is also what the messages are encrypted with. Letters and digits keep it
// easy to share in a link.
export function checkPassphrase(input) {
  const pass = input.trim();
  if (!pass) throw new Error('请输入房间暗号');
  if (!/^[A-Za-z0-9]+$/.test(pass)) throw new Error('房间暗号只能使用英文字母和数字');
  if (pass.length < MIN_PASSPHRASE) throw new Error(`房间暗号至少 ${MIN_PASSPHRASE} 位`);
  return pass;
}

// The passphrase travels after "#", which browsers never send to the server.
export function roomLink(origin, pass) {
  return `${origin}/#${pass}`;
}

export function passphraseFromHash(hash) {
  try {
    return checkPassphrase(decodeURIComponent(hash.replace(/^#/, '')));
  } catch {
    return null;
  }
}

// checkMessage returns the text to send, or null when it is empty or too long.
export function checkMessage(text) {
  const clean = text.trim();
  if (!clean) return null;
  if (Array.from(clean).length > MAX_TEXT_CHARS) return null;
  if (new TextEncoder().encode(clean).byteLength > MAX_TEXT_BYTES) return null;
  return clean;
}

export function visitorName(n, you) {
  return n === you ? `访客 ${n} · 我` : `访客 ${n}`;
}
