// Enkripsi payload Web Push (RFC 8291, aes128gcm) + penandatanganan VAPID (RFC 8292).
// Hanya memakai Web Crypto, jadi berkas yang sama jalan di Node maupun Cloudflare Workers.

const enc = new TextEncoder();

export function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes) {
  let bin = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

async function hmac(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}

// HKDF ditulis manual (bukan lewat deriveBits) supaya tiap langkah antaranya bisa
// dibandingkan dengan vektor uji RFC -- kalau salah satu meleset, ketahuan persis di mana.
async function hkdfExtract(salt, ikm) {
  return hmac(salt, ikm);
}

async function hkdfExpand(prk, info, length) {
  const t = await hmac(prk, concat(info, new Uint8Array([1])));
  return t.slice(0, length); // semua keluaran di sini <= 32 byte, cukup satu iterasi
}

// P-256: kunci privat mentah (32 byte skalar) tidak bisa diimpor langsung oleh Web Crypto,
// jadi dirangkai jadi JWK bersama koordinat x/y dari kunci publiknya.
async function importPrivateKey(privBytes, pubBytes) {
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: bytesToB64url(privBytes),
      x: bytesToB64url(pubBytes.slice(1, 33)),
      y: bytesToB64url(pubBytes.slice(33, 65)),
      ext: true,
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );
}

async function importPublicKey(pubBytes) {
  return crypto.subtle.importKey(
    "raw", pubBytes, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

/**
 * @param plaintext  string isi notifikasi
 * @param p256dh     kunci publik penerima (base64url, 65 byte)
 * @param auth       auth secret penerima (base64url, 16 byte)
 * @param fixed      hanya untuk pengujian: { serverPriv, serverPub, salt } base64url
 */
export async function encryptPayload(plaintext, p256dh, auth, fixed) {
  const uaPublic = b64urlToBytes(p256dh);
  const authSecret = b64urlToBytes(auth);

  let asPublic, asPrivateKey, salt;
  if (fixed) {
    asPublic = b64urlToBytes(fixed.serverPub);
    asPrivateKey = await importPrivateKey(b64urlToBytes(fixed.serverPriv), asPublic);
    salt = b64urlToBytes(fixed.salt);
  } else {
    const pair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    asPrivateKey = pair.privateKey;
    salt = crypto.getRandomValues(new Uint8Array(16));
  }

  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: await importPublicKey(uaPublic) }, asPrivateKey, 256));

  // Langkah RFC 8291 3.4
  const prkKey = await hkdfExtract(authSecret, shared);
  const keyInfo = concat(enc.encode("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, concat(enc.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdfExpand(prk, concat(enc.encode("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const padded = concat(enc.encode(plaintext), new Uint8Array([2])); // 0x02 = rekaman terakhir
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce }, aesKey, padded));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const body = concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);

  return {
    body,
    debug: {
      shared: bytesToB64url(shared),
      prkKey: bytesToB64url(prkKey),
      ikm: bytesToB64url(ikm),
      prk: bytesToB64url(prk),
      cek: bytesToB64url(cek),
      nonce: bytesToB64url(nonce),
    },
  };
}

// --- VAPID (RFC 8292) ---

export async function vapidHeaders(endpoint, publicKey, privateKey, subject) {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = bytesToB64url(enc.encode(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  })));
  const signingInput = enc.encode(`${header}.${payload}`);

  const pubBytes = b64urlToBytes(publicKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: privateKey,
      x: bytesToB64url(pubBytes.slice(1, 33)),
      y: bytesToB64url(pubBytes.slice(33, 65)),
      ext: true,
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, signingInput));

  return {
    Authorization: `vapid t=${header}.${payload}.${bytesToB64url(sig)}, k=${publicKey}`,
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
  };
}

export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: bytesToB64url(pub), privateKey: jwk.d };
}
