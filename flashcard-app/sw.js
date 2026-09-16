// Service worker: satu-satunya bagian yang bisa menampilkan notifikasi saat aplikasi
// tertutup. Worker di Cloudflare yang memutuskan APAKAH notifikasi dikirim; berkas ini
// hanya menampilkan yang sudah diputuskan itu.

const APP_URL = "./index.html";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch (e) {
    data = {};
  }

  const title = data.title || "Belum belajar hari ini";
  const options = {
    body: data.body || "Cukup 1 sesi untuk menjaga streak.",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: "pengingat-belajar",      // notifikasi baru menggantikan yang lama, tidak menumpuk
    renotify: true,
    requireInteraction: false,
    data: { url: data.url || APP_URL },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || APP_URL;

  // Kalau aplikasinya sudah terbuka di suatu tab, fokuskan tab itu alih-alih membuka
  // jendela baru -- di HP jendela menumpuk terasa berantakan.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes("/flashcard-app/") && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
