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

// Kanji Quizzer state
let kanjiList = [];
let kqQueue = [];
let kqIndex = 0;
let kqCorrect = 0;
let kqWrong = 0;
let kqQuestionFormat = "kanji";
let kqAnswerFormat = "kana";
let kqCurrentEntry = null;
let kqAnswered = false;
const KQ_FORMATS = ["kanji", "kana", "english"];

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
  sidebar: document.getElementById("sidebar"),
  sidebarToggle: document.getElementById("sidebarToggle"),
  sidebarOverlay: document.getElementById("sidebarOverlay"),
  navItems: document.querySelectorAll(".nav-item"),
  viewFlashcard: document.getElementById("view-flashcard"),
  viewList: document.getElementById("view-list"),
  vocabSearch: document.getElementById("vocabSearch"),
  listCount: document.getElementById("listCount"),
  vocabTableBody: document.getElementById("vocabTableBody"),
  viewKanji: document.getElementById("view-kanji"),
  kqQuestionFormatToggle: document.getElementById("kqQuestionFormatToggle"),
  kqAnswerFormatToggle: document.getElementById("kqAnswerFormatToggle"),
  kqQuestion: document.getElementById("kqQuestion"),
  kqChoices: document.getElementById("kqChoices"),
  kqGroupLabel: document.getElementById("kqGroupLabel"),
  kqPositionLabel: document.getElementById("kqPositionLabel"),
  kqCorrect: document.getElementById("kqCorrect"),
  kqWrong: document.getElementById("kqWrong"),
  kqDone: document.getElementById("kqDone"),
  kqDoneSummary: document.getElementById("kqDoneSummary"),
  kqRestartBtn: document.getElementById("kqRestartBtn"),
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

function statusFor(id) {
  const s = progress[id];
  if (!s) return { key: "baru", label: "Baru" };
  if (s.box >= MAX_BOX) return { key: "dikuasai", label: "Dikuasai" };
  return { key: "belajar", label: "Belajar" };
}

function renderVocabList(query) {
  const q = (query || "").trim().toLowerCase();
  const rows = !q
    ? vocab
    : vocab.filter(v =>
        v.kanji.toLowerCase().includes(q) ||
        v.kana.toLowerCase().includes(q) ||
        v.romaji.toLowerCase().includes(q) ||
        v.meaning.toLowerCase().includes(q)
      );

  el.vocabTableBody.textContent = "";
  const frag = document.createDocumentFragment();

  rows.forEach(v => {
    const status = statusFor(v.id);
    const tr = document.createElement("tr");

    const cells = [
      { text: v.kanji, cls: "kanji-cell" },
      { text: v.kana, cls: "kana-cell" },
      { text: v.romaji, cls: "romaji-cell" },
      { text: v.type.split(",").map(t => t.trim()).join(", "), cls: "type-cell" },
      { text: v.meaning, cls: "" },
    ];
    cells.forEach(c => {
      const td = document.createElement("td");
      if (c.cls) td.className = c.cls;
      td.textContent = c.text;
      tr.appendChild(td);
    });

    const statusTd = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `status-pill ${status.key}`;
    pill.textContent = status.label;
    statusTd.appendChild(pill);
    tr.appendChild(statusTd);

    frag.appendChild(tr);
  });

  el.vocabTableBody.appendChild(frag);
  el.listCount.textContent = `${rows.length} / ${vocab.length} kata`;
}

function switchView(view) {
  el.navItems.forEach(btn => btn.classList.toggle("active", btn.dataset.view === view));
  el.viewFlashcard.classList.toggle("hidden", view !== "flashcard");
  el.viewList.classList.toggle("hidden", view !== "list");
  el.viewKanji.classList.toggle("hidden", view !== "kanji");

  if (view === "list") {
    renderVocabList(el.vocabSearch.value);
  } else if (view === "kanji" && kqQueue.length === 0 && kanjiList.length > 0) {
    kqBuildQueue();
  }

  closeSidebar();
}

function kqDisplayValue(entry, format) {
  if (format === "kanji") return entry.kanji;
  if (format === "kana") return entry.kunyomi[0] || entry.onyomi[0];
  return entry.meaning.split(";")[0].trim();
}

function kqBuildQueue() {
  kqQueue = kanjiList.map(k => k.id);
  shuffle(kqQueue);
  kqIndex = 0;
  kqCorrect = 0;
  kqWrong = 0;
  el.kqCorrect.textContent = "0";
  el.kqWrong.textContent = "0";
  kqRenderFormatToggles();
  kqShowQuestion();
}

function kqRenderFormatToggles() {
  el.kqQuestionFormatToggle.querySelectorAll(".fmt-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.fmt === kqQuestionFormat);
  });

  el.kqAnswerFormatToggle.textContent = "";
  KQ_FORMATS.filter(f => f !== kqQuestionFormat).forEach(fmt => {
    const btn = document.createElement("button");
    btn.className = "fmt-btn" + (fmt === kqAnswerFormat ? " active" : "");
    btn.dataset.fmt = fmt;
    btn.textContent = fmt === "kanji" ? "Kanji" : fmt === "kana" ? "Kana" : "English";
    btn.addEventListener("click", () => kqSetAnswerFormat(fmt));
    el.kqAnswerFormatToggle.appendChild(btn);
  });
}

function kqSetQuestionFormat(fmt) {
  if (fmt === kqQuestionFormat) return;
  kqQuestionFormat = fmt;
  if (kqAnswerFormat === fmt) {
    kqAnswerFormat = KQ_FORMATS.find(f => f !== kqQuestionFormat);
  }
  kqRenderFormatToggles();
  kqShowQuestion();
}

function kqSetAnswerFormat(fmt) {
  if (fmt === kqAnswerFormat) return;
  kqAnswerFormat = fmt;
  kqRenderFormatToggles();
  kqShowQuestion();
}

function kqShowQuestion() {
  if (kqIndex >= kqQueue.length) {
    document.querySelector(".kq-header").classList.add("hidden");
    document.querySelector(".kq-meta").classList.add("hidden");
    el.kqQuestion.classList.add("hidden");
    el.kqChoices.classList.add("hidden");
    el.kqAnswerFormatToggle.classList.add("hidden");
    el.kqDone.classList.remove("hidden");
    el.kqDoneSummary.textContent = `Benar ${kqCorrect} dari ${kqQueue.length} (salah ${kqWrong}).`;
    return;
  }

  document.querySelector(".kq-header").classList.remove("hidden");
  document.querySelector(".kq-meta").classList.remove("hidden");
  el.kqQuestion.classList.remove("hidden");
  el.kqChoices.classList.remove("hidden");
  el.kqAnswerFormatToggle.classList.remove("hidden");
  el.kqDone.classList.add("hidden");

  kqAnswered = false;
  const id = kqQueue[kqIndex];
  kqCurrentEntry = kanjiList.find(k => k.id === id);

  el.kqQuestion.className = `kq-question fmt-${kqQuestionFormat}`;
  el.kqQuestion.textContent = kqDisplayValue(kqCurrentEntry, kqQuestionFormat);
  el.kqGroupLabel.textContent = `JLPT N5 Group ${kqCurrentEntry.group}`;
  el.kqPositionLabel.textContent = `${kqIndex + 1} of ${kqQueue.length}`;

  const correctValue = kqDisplayValue(kqCurrentEntry, kqAnswerFormat);
  const pool = kanjiList.filter(k => k.id !== kqCurrentEntry.id);
  shuffle(pool);

  const distractors = [];
  const seenValues = new Set([correctValue]);
  for (const candidate of pool) {
    if (distractors.length >= 3) break;
    const val = kqDisplayValue(candidate, kqAnswerFormat);
    if (seenValues.has(val)) continue;
    seenValues.add(val);
    distractors.push(candidate);
  }

  const choices = [kqCurrentEntry, ...distractors];
  shuffle(choices);

  el.kqChoices.textContent = "";
  choices.forEach(entry => {
    const btn = document.createElement("button");
    btn.className = "kq-choice";
    btn.textContent = kqDisplayValue(entry, kqAnswerFormat);
    btn.addEventListener("click", () => kqSelectAnswer(entry, btn));
    el.kqChoices.appendChild(btn);
  });
}

function kqSelectAnswer(entry, btnEl) {
  if (kqAnswered) return;
  kqAnswered = true;

  const isCorrect = entry.id === kqCurrentEntry.id;
  if (isCorrect) {
    kqCorrect++;
    el.kqCorrect.textContent = kqCorrect;
    btnEl.classList.add("correct");
  } else {
    kqWrong++;
    el.kqWrong.textContent = kqWrong;
    btnEl.classList.add("wrong");
  }

  el.kqChoices.querySelectorAll(".kq-choice").forEach(b => {
    b.disabled = true;
    if (b !== btnEl && b.textContent === kqDisplayValue(kqCurrentEntry, kqAnswerFormat)) {
      b.classList.add("correct");
    }
  });

  setTimeout(() => {
    kqIndex++;
    kqShowQuestion();
  }, 900);
}

function openSidebar() {
  el.sidebar.classList.add("open");
  el.sidebarOverlay.classList.remove("hidden");
  el.sidebarOverlay.classList.add("open");
}

function closeSidebar() {
  el.sidebar.classList.remove("open");
  el.sidebarOverlay.classList.remove("open");
  el.sidebarOverlay.classList.add("hidden");
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

  fetch("data/kanji-n5.json")
    .then(r => r.json())
    .then(data => {
      kanjiList = data;
      if (!el.viewKanji.classList.contains("hidden") && kqQueue.length === 0) {
        kqBuildQueue();
      }
    })
    .catch(err => console.error("Gagal memuat kanji-n5.json:", err));

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

  el.navItems.forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  el.sidebarToggle.addEventListener("click", openSidebar);
  el.sidebarOverlay.addEventListener("click", closeSidebar);

  el.vocabSearch.addEventListener("input", () => renderVocabList(el.vocabSearch.value));

  el.kqQuestionFormatToggle.querySelectorAll(".fmt-btn").forEach(btn => {
    btn.addEventListener("click", () => kqSetQuestionFormat(btn.dataset.fmt));
  });

  el.kqRestartBtn.addEventListener("click", () => {
    kqQueue = [];
    kqBuildQueue();
  });
}

init();
