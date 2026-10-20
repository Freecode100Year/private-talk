# Private Talk (隐匿对话)

[中文](README.md)

**Android**: [online APK (0.9 MB, website built in)](https://github.com/Freecode100Year/private-talk/releases/download/android-online-v2.20.0/PrivateTalk-online-v2.20.0.apk) · [offline APK (58 MB, arm64, no internet needed: one phone's hotspot is the server)](https://github.com/Freecode100Year/private-talk/releases/download/android-offline-v17/PrivateTalk-offline-arm64-v17.apk)

![Private Talk: only for those who know the passphrase, and nothing left behind](docs/images/banner.jpg)

**Only for those who know the passphrase. Talk, then leave without a trace.**

- **Private**: no account, no phone number, no nickname. Messages are encrypted in the browser; the server only passes on ciphertext it cannot read, keeps no messages and writes no logs.
- **Simple**: open the address, type the passphrase, and you are in the same room. No app to install; works on phones and computers.
- **No censorship**: no keyword filters, no moderation, no reporting or banning, no back doors. The server cannot read messages and judges nothing by content. The only limits are on room size, message rate and length, to keep the service from being flooded.
- **Runs anywhere**: one-click on Cloudflare's free tier, one Docker command, an offline LAN, an intranet with no internet, even a single Android phone.

Use it now: <https://chat.freedom8964.com> (Cloudflare) or <https://chat.nya.je> (separate VPS, backup) · [privacy design (Chinese)](docs/privacy.md)

## In 30 seconds

1. Open `https://chat.freedom8964.com/#your-passphrase`.
2. Send that address to your friends.
3. Everyone who opens the same address is in the same room, up to 25 people.

A passphrase may use letters and digits of any language, no symbols. Opening the home page gives you a random passphrase nobody can guess. Lock the room once everyone is in; close the page when you are done. The interface follows your browser's language: English, Español, 简体中文, 繁體中文, বাংলা, Русский, العربية, Kreyòl Ayisyen, 한국어, اردو, Français, हिन्दी.

## What stays private

| Who | Can see | Cannot see |
| :--- | :--- | :--- |
| The server operator | your IP address, when you are online, which connections share a room | messages, the passphrase, who you are |
| Someone watching the network | that you connected to this site | content, passphrase, room |
| People in the room | the messages, and your seat number (1️⃣–🔟, then #11–#25) | who you are, your IP address |

- **End-to-end encryption**: keys come from the passphrase, in the browser (PBKDF2 with 310,000 rounds → HKDF → AES-256-GCM). Messages are padded to a few fixed sizes before encryption, so the ciphertext does not show how long a message is.
- **Forward secrecy** (since 2.4): everyone makes a short-lived key pair on entering; every message uses a one-time key; when someone leaves, everyone changes keys. Traffic recorded today stays closed even if the passphrase leaks later. Since 2.8 the pairwise keys also include ML-KEM-768 (post-quantum, against "record now, decrypt later"). Every message is signed by its sender, so nobody can write under another seat number. A 20-digit safety code in the sidebar, read out by phone or in person, shows that nobody has been slipped in between. Strict mode (the default) pauses the room rather than quietly falling back when an older version is present. Since 2.14 you can **send pictures**: shrunk in the browser with location (GPS) and other EXIF data removed, encrypted with a one-time key that travels inside a forward-secret message; the relay sees only ciphertext. Since 2.10 the room doubles as a game table: Undercover, a 4–8 player deduction game, Cipher Escape (since 2.11), where 2–8 players pool clues to open three combination locks, Pact Exchange (since 2.12), a prisoner's dilemma with private notes between partners, Secret Mission (since 2.13), where 3–8 players try to get someone to say their word, Liar's Dice (since 2.20), 2–8 players bluffing about dice nobody else can see (since 2.20 you can also “Find a table” and play strangers at public tables, which anyone and the server can see into; private rooms are never listed), and Werewolf (since 2.15), 6–12 players with an automatic judge, so everyone plays (since 2.16: 23 boards, 19 roles, a sheriff election; since 2.17 every game and board has detailed rules under “📖 Game rules”); cards, votes, clues and notes are encrypted too. Since 2.9 your messages show encrypted delivery receipts ("delivered 2/3", "✓ delivered to all").
- **No passphrase, no entry**: the server only accepts an access value derived from the passphrase; knowing the room's address is not enough to take a seat, lock the room or post.
- **Nothing kept**: no accounts, no message history, no logs. The room disappears when everyone leaves.
- **Few traces**: no cookies or browser storage, no caching, and the browser is asked to wipe the site's data on closing. No outside resources, no analytics.
- **Checkable code**: the site carries a signed list of its files; `node scripts/verify-site.mjs <address>` checks a running site against it, and GitHub checks chat.freedom8964.com every six hours.

**What it cannot do** (please read):

- Anyone with the passphrase can come in and hear what is said from then on. Short passphrases can be guessed; use a random one for anything important. Invitation links do not expire.
- The server sees IP addresses. Use a VPN you trust to hide yours.
- It cannot prove who is in the room. People can take screenshots. Keyboards that upload what you type, and devices that are being watched, are beyond what a web page can protect.
- The web page comes from the server. If the operator's account is taken over, the page could be swapped. The signed list catches that for everyone, but not a swap aimed at one person; the Android apps and offline packages, whose page is built in, do not have this problem.

## Screenshots

Taken by `browser-tests/screens.mjs`, which plays the games with real browsers (phone-sized; fresh rooms, numbered members only). The interface is in Chinese here; it follows the browser's language.

| Werewolf: the wolves choose | The seer checks | The witch's potions | Sheriff election |
|---|---|---|---|
| <img src="docs/screenshots/werewolf-night-wolf.webp" width="200"> | <img src="docs/screenshots/werewolf-night-seer.webp" width="200"> | <img src="docs/screenshots/werewolf-night-witch.webp" width="200"> | <img src="docs/screenshots/werewolf-sheriff.webp" width="200"> |
| **Holding the role card** | **Speeches by day** | **The vote** | **The end, roles revealed** |
| <img src="docs/screenshots/werewolf-card.webp" width="200"> | <img src="docs/screenshots/werewolf-day.webp" width="200"> | <img src="docs/screenshots/werewolf-vote.webp" width="200"> | <img src="docs/screenshots/werewolf-end.webp" width="200"> |
| **Undercover** | **Cipher Escape** | **Pact Exchange (a note)** | **Secret Mission** |
| <img src="docs/screenshots/undercover.webp" width="200"> | <img src="docs/screenshots/escape.webp" width="200"> | <img src="docs/screenshots/pact.webp" width="200"> | <img src="docs/screenshots/mission.webp" width="200"> |
| **A picture (EXIF removed)** | **The room on a computer** | | |
| <img src="docs/screenshots/picture.webp" width="200"> | <img src="docs/screenshots/room-desktop.webp" width="300"> | | |

## Run your own

Anyone may run their own copy for free ([MIT licence](LICENSE)), no permission needed.

| Your situation | Recommended | Guide (Chinese) |
| :--- | :--- | :--- |
| No server | Cloudflare one-click deploy (free tier) | [Cloudflare](docs/manual/cloudflare.md) |
| A VPS and a domain | Docker with automatic HTTPS: `./pt setup your.domain` | [VPS](docs/manual/vps.md) |
| Offline LAN, event venue, intranet | offline package with Node.js included: unpack and run `start-lan` | [LAN](docs/manual/lan.md) |

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Freecode100Year/private-talk)

```sh
# VPS with Docker: point the domain at the server and open ports 80 and 443 first
curl -fsSL https://github.com/Freecode100Year/private-talk/releases/latest/download/private-talk-compose.tar.gz | tar -xz
cd private-talk-docker && ./pt setup chat.example.com
```

- HTTPS is required: browsers only allow the page's encryption over HTTPS. Every option above sets it up.
- Self-hosted servers can set `ENTRY_PATH` for a **hidden entrance**: the site only opens under a secret path, and every other address answers a plain 404, so a scan cannot tell what runs there.
- Turn on two-factor authentication for the account you deploy with: it holds the keys to the site.

## Licence

[MIT](LICENSE).
