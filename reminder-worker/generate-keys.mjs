// Membuat sepasang kunci VAPID untuk Web Push.
//
// Jalankan sendiri di komputermu:  node generate-keys.mjs
//
// Kunci PRIVAT sengaja dibuat di sini, bukan dikirimkan oleh siapa pun. Siapa pun yang
// memegangnya bisa mengirim notifikasi atas nama aplikasimu, jadi dia tidak boleh
// melewati percakapan, chat, email, atau masuk ke git.

function bytesToB64url(bytes) {
  return Buffer.from(bytes).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);

const publicKey = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d;

console.log("\nKunci VAPID berhasil dibuat.\n");
console.log("VAPID_PUBLIC_KEY  (boleh publik):");
console.log(publicKey);
console.log("\nVAPID_PRIVATE_KEY (RAHASIA — jangan dibagikan, jangan masuk git):");
console.log(privateKey);
console.log("\nPasang keduanya dengan perintah berikut, tempel nilainya saat diminta:");
console.log("  npx wrangler secret put VAPID_PUBLIC_KEY");
console.log("  npx wrangler secret put VAPID_PRIVATE_KEY");
console.log("  npx wrangler secret put VAPID_SUBJECT      (isi: mailto:emailmu@contoh.com)\n");
