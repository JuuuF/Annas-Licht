// Changes who is named as having added moments ("Hinzugefügt von ..."), in the public and the encrypted moments alike.
//
//   node tools/set_author.mjs <alter Name> <neuer Name>
//
// Asks for the name and password of an account (any role): only with it can the protected moments be opened.
// They are written back encrypted with the same key; nothing else in them changes. Afterwards commit data/.
// The name also decides who may change a moment: an account "Mitgestalten" may only change moments added under its own name.
// For tests: a third argument names another data folder; ANNA_NAME and ANNA_PASS can stand in for the questions.
import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [from, to, dir = 'data'] = process.argv.slice(2);
if (!from || !to) { console.error('Aufruf: node tools/set_author.mjs <alter Name> <neuer Name>'); process.exit(1); }

const te = new TextEncoder(), td = new TextDecoder(), { subtle } = globalThis.crypto;
const unb64 = s => Uint8Array.from(Buffer.from(s, 'base64'));
const aesKey = raw => subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
const unseal = async (key, b) => new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, key, b.subarray(12)));
async function seal(key, bytes) {                         // as in js/store.js: a fresh random IV, then the ciphertext
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
async function passKey(name, pass, salt) {                // as in js/store.js
  const base = await subtle.importKey('raw', te.encode(name.trim().toLowerCase() + '\n' + pass), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function ask(question, hidden = false) {                  // a question in the terminal; a hidden answer is not shown while typing
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(question); };
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
  });
}

const users = JSON.parse(readFileSync(`${dir}/users.json`, 'utf8'));
const name = process.env.ANNA_NAME ?? await ask('Name des Zugangs: ');
const pass = process.env.ANNA_PASS ?? await ask('Passwort: ', true);
const key = await passKey(name, pass, unb64(users.salt));
let box = null;
for (const u of users.users) { try { box = JSON.parse(td.decode(await unseal(key, unb64(u.box)))); break; } catch { /* not this one */ } }
if (!box) { console.error('Name oder Passwort stimmen nicht.'); process.exit(1); }
const contentKey = await aesKey(unb64(box.key));

const pub = JSON.parse(readFileSync(`${dir}/public.json`, 'utf8'));
const priv = JSON.parse(td.decode(await unseal(contentKey, readFileSync(`${dir}/private.enc`))));
const hits = list => (list || []).filter(i => i.by === from);
const pubHits = hits(pub.items), privHits = hits(priv.items);
const others = [...new Set([...(pub.items || []), ...(priv.items || [])].map(i => i.by).filter(b => b && b !== from))];
console.log(`Momente von „${from}“: ${pubHits.length} öffentliche, ${privHits.length} geschützte.${others.length ? ` (Andere Namen: ${others.map(o => `„${o}“`).join(', ')} - bleiben, wie sie sind.)` : ''}`);
if (!pubHits.length && !privHits.length) process.exit(0);

// who may change these moments afterwards
const roleOf = n => (priv.accounts || []).find(a => a.name === n)?.role;
const ROLE = { admin: 'Verwaltung', editor: 'Mitgestalten', viewer: 'Nur ansehen' };
if (roleOf(from) === 'editor') console.log(`Achtung: „${from}“ ist ein Zugang „Mitgestalten“ und kann diese Momente danach nicht mehr ändern (nur noch „${to}“ und die Verwaltung).`);
if (!roleOf(to)) console.log(`Hinweis: Es gibt keinen Zugang, der genau „${to}“ heißt. Ändern können diese Momente dann nur Zugänge der Verwaltung.`);
else console.log(`„${to}“ ist ein Zugang „${ROLE[roleOf(to)] || roleOf(to)}“.`);

const sure = process.env.ANNA_NAME ? 'ja' : await ask(`Bei ${pubHits.length + privHits.length} Momenten „${from}“ durch „${to}“ ersetzen? (ja/nein) `);
if (sure.trim().toLowerCase() !== 'ja') { console.log('Nichts geändert.'); process.exit(0); }

for (const i of [...pubHits, ...privHits]) i.by = to;
if (pubHits.length) writeFileSync(`${dir}/public.json`, JSON.stringify(pub, null, 1));
if (privHits.length) writeFileSync(`${dir}/private.enc`, await seal(contentKey, te.encode(JSON.stringify(priv))));
console.log(`Fertig. Jetzt ${dir}/ committen und hochladen.`);
