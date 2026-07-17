const STORAGE_KEY = "n5-flashcards-progress-v1";
const NEW_BATCH_SIZE = 20;
// Leitner-style box intervals in days, index = box number.
const BOX_INTERVALS = [0, 1, 3, 7, 14, 30, 60];
const MAX_BOX = BOX_INTERVALS.length - 1;

let vocab = [];
let progress = {};   // id -> { box, due (timestamp ms) }
let queue = [];       // ids for current session
let queueTotal = 0;
let current = null;
let flipped = false;
let hintShown = false;

const el = {
  cardBox: document.getElementById("cardBox"),
  cardType: document.getElementById("cardType"),
  cardKanji: document.getElementById("cardKanji"),
  cardKanjiBack: document.getElementById("cardKanjiBack"),
  cardKana: document.getElementById("cardKana"),
  cardRomaji: document.getElementById("cardRomaji"),
  cardMeaning: document.getElementById("cardMeaning"),
  cardKanaHint: document.getElementById("cardKanaHint"),
  hintBtn: document.getElementById("hintBtn"),
  card: document.getElementById("card"),
  rateButtons: document.getElementById("rateButtons"),
  emptyState: document.getElementById("emptyState"),
  studyMoreBtn: document.getElementById("studyMoreBtn"),
  resetProgressBtn: document.getElementById("resetProgressBtn"),
  progressBar: document.getElementById("progressBar"),
  statDue: document.getElementById("statDue"),
  statLearning: document.getElementById("statLearning"),
  statMastered: document.getElementById("statMastered"),
  statTotal: document.getElementById("statTotal"),
  toast: document.getElementById("toast"),
};

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    progress = raw ? JSON.parse(raw) : {};
  } catch (e) {
    progress = {};
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function now() {
  return Date.now();
}

function getState(id) {
  return progress[id] || null;
}

function isNew(id) {
  return !progress[id];
}

function isDue(id) {
  const s = progress[id];
  return s && s.due <= now();
}

function buildQueue() {
  const dueIds = vocab.filter(v => isDue(v.id)).map(v => v.id);
  // Shuffle due cards for variety.
  shuffle(dueIds);

  if (dueIds.length > 0) {
    queue = dueIds;
  } else {
    const newIds = vocab.filter(v => isNew(v.id)).map(v => v.id);
    shuffle(newIds);
    queue = newIds.slice(0, NEW_BATCH_SIZE);
  }
  queueTotal = queue.length;
  updateStats();
  showNext();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function showNext() {
  flipped = false;
  hintShown = false;
  el.cardBox.classList.remove("flipped");
  el.rateButtons.classList.add("hidden");
  el.cardKanaHint.classList.remove("show");
  el.cardKanaHint.textContent = "";

  if (queue.length === 0) {
    current = null;
    el.card.classList.add("hidden");
    el.emptyState.classList.remove("hidden");
    updateProgressBar(1);
    updateStats();
    return;
  }

  el.card.classList.remove("hidden");
  el.emptyState.classList.add("hidden");

  const id = queue[0];
  current = vocab.find(v => v.id === id);

  el.cardType.textContent = current.type.split(",")[0].trim();
  el.cardKanji.textContent = current.kanji;
  el.cardKanjiBack.textContent = current.kanji;
  el.cardKana.textContent = current.kana;
  el.cardRomaji.textContent = current.romaji;
  el.cardMeaning.textContent = current.meaning;
  el.hintBtn.disabled = current.kanji === current.kana;

  const done = queueTotal - queue.length;
  updateProgressBar(queueTotal ? done / queueTotal : 0);
}

function updateProgressBar(fraction) {
  el.progressBar.style.width = `${Math.round(fraction * 100)}%`;
}

function flipCard() {
  if (!current) return;
  flipped = !flipped;
  el.cardBox.classList.toggle("flipped", flipped);
  el.rateButtons.classList.toggle("hidden", !flipped);
}

function toggleHint() {
  if (!current || flipped || current.kanji === current.kana) return;
  hintShown = !hintShown;
  el.cardKanaHint.textContent = hintShown ? current.kana : "";
  el.cardKanaHint.classList.toggle("show", hintShown);
}

// Pengganda frekuensi kemunculan kartu relatif terhadap jadwal normal.
// belum hafal -> 2x lebih sering (interval dibagi 2), sudah hafal -> 0,5x lebih sering (interval dikali 2).
const RATE_MULTIPLIER = { belum: 0.5, hafal: 1, sudah: 2 };

function rate(rating) {
  if (!current || !flipped) return;
  const s = progress[current.id] || { box: 0, due: now() };
  let box = s.box;

  if (rating === "belum") {
    box = Math.max(0, box - 1);
  } else {
    box = Math.min(MAX_BOX, box + 1);
  }

  const intervalDays = BOX_INTERVALS[box] * RATE_MULTIPLIER[rating];
  progress[current.id] = { box, due: now() + intervalDays * 24 * 60 * 60 * 1000 };
  saveProgress();

  if (intervalDays <= 0) {
    // Masih jatuh tempo hari ini -> munculkan lagi nanti dalam sesi yang sama.
    queue.push(queue.shift());
  } else {
    queue.shift();
  }

  updateStats();
  showNext();
}

function updateStats() {
  const total = vocab.length;
  let due = 0, learning = 0, mastered = 0;
  vocab.forEach(v => {
    const s = progress[v.id];
    if (!s) return;
    if (s.box >= MAX_BOX) mastered++;
    else learning++;
    if (s.due <= now()) due++;
  });
  el.statDue.textContent = due;
  el.statLearning.textContent = learning;
  el.statMastered.textContent = mastered;
  el.statTotal.textContent = total;
}

function showToast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  setTimeout(() => el.toast.classList.remove("show"), 1800);
}

function init() {
  loadProgress();
  fetch("data/vocab.json")
    .then(r => r.json())
    .then(data => {
      vocab = data;
      buildQueue();
    })
    .catch(err => {
      el.cardKanji.textContent = "⚠";
      el.cardType.textContent = "error";
      console.error("Gagal memuat vocab.json:", err);
    });

  el.card.addEventListener("click", flipCard);
  document.addEventListener("keydown", e => {
    if (e.code === "Space") {
      e.preventDefault();
      flipCard();
    } else if (flipped && ["1", "2", "3"].includes(e.key)) {
      const map = { "1": "belum", "2": "hafal", "3": "sudah" };
      rate(map[e.key]);
    } else if (!flipped && e.key.toLowerCase() === "h") {
      toggleHint();
    }
  });

  el.hintBtn.addEventListener("click", e => {
    e.stopPropagation();
    toggleHint();
  });

  el.rateButtons.querySelectorAll(".rate").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      rate(btn.dataset.rate);
    });
  });

  el.studyMoreBtn.addEventListener("click", buildQueue);

  el.resetProgressBtn.addEventListener("click", () => {
    if (confirm("Reset semua progres belajar? Ini tidak bisa dibatalkan.")) {
      progress = {};
      saveProgress();
      buildQueue();
      showToast("Progres direset");
    }
  });
}

init();
