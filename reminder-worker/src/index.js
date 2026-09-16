// Pengingat belajar bersyarat: hanya mengirim notifikasi kalau hari itu memang belum
// ada sesi yang dikerjakan.
//
// Aplikasi di GitHub Pages bersifat statis dan catatan belajarnya hanya ada di
// localStorage HP, jadi tidak ada pihak yang tahu kapan pengguna terakhir belajar.
// Worker ini menyimpan dua hal saja -- langganan push dan TANGGAL terakhir belajar --
// lalu sebuah cron mengecek tiap 15 menit apakah pengingat perlu dikirim.

import { encryptPayload, vapidHeaders } from "./webpush.js";

const CRON_WINDOW_MINUTES = 20; // sedikit lebih lebar dari jeda cron (15m) supaya tidak terlewat

function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, env, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors(env) },
  });
}

function isClientId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

function isDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Tanggal & menit setempat milik pelanggan, dihitung dari jam UTC worker.
// getTimezoneOffset() di browser bernilai negatif untuk zona di timur Greenwich
// (WIB = -420), jadi waktu setempat = UTC dikurangi offset itu.
function localNow(tzOffsetMinutes) {
  const local = new Date(Date.now() - tzOffsetMinutes * 60000);
  const pad = n => String(n).padStart(2, "0");
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

async function sendPush(record, env) {
  const { subscription } = record;
  const payload = JSON.stringify({
    title: "Belum belajar hari ini",
    body: record.streak > 0
      ? `Streak ${record.streak} hari bisa putus. Cukup 1 sesi.`
      : "Cukup 1 sesi untuk memulai streak.",
    url: env.APP_URL || "",
  });

  const { body } = await encryptPayload(payload, subscription.keys.p256dh, subscription.keys.auth);
  const headers = await vapidHeaders(
    subscription.endpoint,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
    env.VAPID_SUBJECT || "mailto:admin@example.com"
  );

  return fetch(subscription.endpoint, {
    method: "POST",
    headers: { ...headers, TTL: "86400" },
    body,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(env) });
    }

    // Kunci publik VAPID diambil aplikasi dari sini, supaya pengguna cukup menempelkan
    // URL worker di aplikasi dan tidak perlu menyunting kode lalu push ulang.
    if (url.pathname === "/key" && request.method === "GET") {
      if (!env.VAPID_PUBLIC_KEY) return json({ error: "VAPID_PUBLIC_KEY belum diset" }, env, 500);
      return json({ publicKey: env.VAPID_PUBLIC_KEY }, env);
    }

    if (url.pathname === "/health") {
      return json({
        ok: true,
        vapidConfigured: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
        kvBound: !!env.REMINDERS,
      }, env);
    }

    if (url.pathname === "/subscribe" && request.method === "POST") {
      let payload;
      try { payload = await request.json(); } catch { return json({ error: "JSON tidak valid" }, env, 400); }

      const { clientId, subscription, reminderMinutes, tzOffset, lastActive, streak } = payload || {};
      if (!isClientId(clientId)) return json({ error: "clientId tidak valid" }, env, 400);
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return json({ error: "subscription tidak lengkap" }, env, 400);
      }
      if (!Number.isInteger(reminderMinutes) || reminderMinutes < 0 || reminderMinutes > 1439) {
        return json({ error: "reminderMinutes tidak valid" }, env, 400);
      }
      if (!Number.isInteger(tzOffset) || Math.abs(tzOffset) > 840) {
        return json({ error: "tzOffset tidak valid" }, env, 400);
      }

      await env.REMINDERS.put(`sub:${clientId}`, JSON.stringify({
        clientId,
        subscription,
        reminderMinutes,
        tzOffset,
        lastActive: isDateKey(lastActive) ? lastActive : null,
        streak: Number.isInteger(streak) ? streak : 0,
        lastNotified: null,
        updatedAt: new Date().toISOString(),
      }));
      return json({ ok: true }, env);
    }

    // Dipanggil aplikasi tiap satu sesi selesai. Yang dikirim hanya tanggal -- tidak ada
    // isi belajar, skor, maupun identitas apa pun yang keluar dari HP.
    if (url.pathname === "/activity" && request.method === "POST") {
      let payload;
      try { payload = await request.json(); } catch { return json({ error: "JSON tidak valid" }, env, 400); }

      const { clientId, date, streak } = payload || {};
      if (!isClientId(clientId)) return json({ error: "clientId tidak valid" }, env, 400);
      if (!isDateKey(date)) return json({ error: "date tidak valid" }, env, 400);

      const raw = await env.REMINDERS.get(`sub:${clientId}`);
      if (!raw) return json({ error: "belum berlangganan" }, env, 404);

      const record = JSON.parse(raw);
      record.lastActive = date;
      if (Number.isInteger(streak)) record.streak = streak;
      record.updatedAt = new Date().toISOString();
      await env.REMINDERS.put(`sub:${clientId}`, JSON.stringify(record));
      return json({ ok: true }, env);
    }

    if (url.pathname === "/unsubscribe" && request.method === "POST") {
      let payload;
      try { payload = await request.json(); } catch { return json({ error: "JSON tidak valid" }, env, 400); }
      if (!isClientId(payload?.clientId)) return json({ error: "clientId tidak valid" }, env, 400);
      await env.REMINDERS.delete(`sub:${payload.clientId}`);
      return json({ ok: true }, env);
    }

    return json({ error: "not found" }, env, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env));
  },
};

export async function runReminders(env, now = Date.now()) {
  const listed = await env.REMINDERS.list({ prefix: "sub:" });
  const hasil = { diperiksa: 0, dikirim: 0, dilewati: 0, kedaluwarsa: 0, gagal: 0 };

  for (const key of listed.keys) {
    const raw = await env.REMINDERS.get(key.name);
    if (!raw) continue;

    const record = JSON.parse(raw);
    hasil.diperiksa++;

    const local = localNow(record.tzOffset);

    // Tiga syarat, dan yang kedua adalah inti fiturnya.
    const dalamJendela = local.minutes >= record.reminderMinutes
      && local.minutes < record.reminderMinutes + CRON_WINDOW_MINUTES;
    const sudahBelajar = record.lastActive === local.date;
    const sudahDiingatkan = record.lastNotified === local.date;

    if (!dalamJendela || sudahBelajar || sudahDiingatkan) {
      hasil.dilewati++;
      continue;
    }

    try {
      const res = await sendPush(record, env);
      if (res.status === 404 || res.status === 410) {
        // Langganan sudah dicabut di sisi peramban -- buang, jangan coba lagi selamanya.
        await env.REMINDERS.delete(key.name);
        hasil.kedaluwarsa++;
        continue;
      }
      if (!res.ok) {
        hasil.gagal++;
        console.log(`push gagal ${res.status} untuk ${record.clientId}`);
        continue;
      }
      record.lastNotified = local.date;
      await env.REMINDERS.put(key.name, JSON.stringify(record));
      hasil.dikirim++;
    } catch (err) {
      hasil.gagal++;
      console.log(`push error untuk ${record.clientId}: ${err}`);
    }
  }

  console.log("runReminders", JSON.stringify(hasil));
  return hasil;
}

export { localNow };
