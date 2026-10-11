// Rules shared by the page and the tests.
export const MAX_MEMBERS = 10;
export const MAX_TEXT_CHARS = 500;
export const MAX_TEXT_BYTES = 2048;
export const SHORT_PASSPHRASE = 8; // shorter ones work, with a warning
export const SEND_GAP_SECONDS = 3;

// The passphrase is the only credential: whoever knows it is in the room, and
// it is also what the messages are encrypted with. It may be as short as one
// character: digits, English letters, or Chinese (simplified or traditional).
// NFKC folds full-width letters and digits from Chinese input methods into
// plain ones, so ＡＢ１ and AB1 open the same room. Simplified and traditional
// forms of a character are different characters, and so different rooms.
export const MAX_PASSPHRASE = 64;

export function checkPassphrase(input) {
  const pass = input.normalize('NFKC').trim();
  if (!pass) throw new Error('请输入房间暗号');
  if (!/^[A-Za-z0-9\p{Script=Han}]+$/u.test(pass)) throw new Error('房间暗号只能用数字、英文字母和中文');
  if (Array.from(pass).length > MAX_PASSPHRASE) throw new Error(`房间暗号最多 ${MAX_PASSPHRASE} 个字`);
  return pass;
}

export function isShortPassphrase(pass) {
  return Array.from(pass).length < SHORT_PASSPHRASE;
}

// The passphrase travels after "#", which browsers never send to the server.
// Chinese is percent-encoded so the link survives chat apps that would cut it
// at the first non-ASCII character; browsers show it decoded again.
export function roomLink(origin, pass) {
  return `${origin}/#${encodeURIComponent(pass)}`;
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

// Visitors are numbered 1️⃣ to 🔟.
export const BADGES = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

export function badge(n) {
  return BADGES[n - 1] ?? `#${n}`;
}

export function visitorName(n, you) {
  return n === you ? `${badge(n)} 我` : badge(n);
}

// randomPassphrase makes a 22-character passphrase, about 128 bits: far
// beyond guessing. Letters and digits only, minus look-alikes (I, O, l, 0, 1),
// so it also survives being read aloud or retyped.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function randomPassphrase(length = 22) {
  const out = [];
  const limit = 256 - (256 % ALPHABET.length); // keep every symbol equally likely
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return out.join('');
}

// roomCode is what the page shows instead of the passphrase, so a screenshot
// of the room does not give the room away. Everyone in the same room sees the
// same code.
export function roomCode(roomId) {
  return roomId.slice(0, 4).toUpperCase();
}

// A message's sender, id and time travel inside the encryption. The relay
// labels each message with who sent it; the page shows a message only when
// that label matches the sealed one, it has not seen the id before, and the
// message is not old, so a tampering relay cannot reattribute or replay.
export const MAX_SKEW = 10 * 60 * 1000;

export function envelope(from, text, now = Date.now()) {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  return JSON.stringify({ from, id, t: now, text });
}

export function checkEnvelope(plain, relayed, seen) {
  let e;
  try { e = JSON.parse(plain); } catch { return null; }
  if (!e || typeof e.text !== 'string' || typeof e.id !== 'string' || typeof e.t !== 'number') return null;
  if (e.from !== relayed.from || Math.abs(relayed.at - e.t) > MAX_SKEW || seen.has(e.id)) return null;
  seen.add(e.id);
  return e.text;
}

// joinsAndLeaves compares two member lists.
export function joinsAndLeaves(before, after) {
  return {
    joined: after.filter((n) => !before.includes(n)),
    left: before.filter((n) => !after.includes(n))
  };
}
