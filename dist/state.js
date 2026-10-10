const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_TEXT_CHARS = 500;
const MAX_TEXT_BYTES = 2048;

function codePart() {
  return Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

export function createRoom(title) {
  const cleanTitle = title.trim();
  if (!cleanTitle) {
    throw new Error('Room passphrase is required');
  }
  if (!/^[A-Za-z0-9]+$/.test(cleanTitle)) {
    throw new Error('Room passphrase must contain only English letters and digits');
  }
  const inviteCode = `${codePart()}-${codePart()}`;
  return {
    title: cleanTitle,
    inviteCode,
    sharePath: `private.talk/room/${encodeURIComponent(cleanTitle)}?invite=${inviteCode}`,
    expiresInMinutes: null,
    expiresWhenEmpty: true,
    maxParticipants: 8,
    maxTextChars: MAX_TEXT_CHARS
  };
}

export function nextStep(step) {
  return ({ create: 'invite', invite: 'chat' })[step] ?? 'create';
}

export function sendDemoMessage(messages, text) {
  const cleanText = text.trim();
  const textBytes = new TextEncoder().encode(cleanText).byteLength;
  if (Array.from(cleanText).length > MAX_TEXT_CHARS || textBytes > MAX_TEXT_BYTES) return messages;
  return cleanText ? [...messages, { sender: '我', text: cleanText, time: '刚刚' }] : messages;
}
