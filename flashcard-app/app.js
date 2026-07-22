// SRS progress is stored per level under its own key so N5 and N4 don't collide
// (both id sets start at 1). The N5 key is kept from the single-level version so
// existing users keep their progress.
const STORAGE_KEYS = {
  N5: "n5-flashcards-progress-v1",
  N4: "n4-flashcards-progress-v1",
};
const NEW_BATCH_SIZE = 20;
// Leitner-style box intervals in days, index = box number.
const BOX_INTERVALS = [0, 1, 3, 7, 14, 30, 60];
const MAX_BOX = BOX_INTERVALS.length - 1;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Deterministic shuffle (fixed seed) so level composition stays the same across
// reloads/days instead of re-randomizing every page load. Used only to decide
// which words fall into which level -- the original alphabetical vocabByLevel
// arrays are left untouched for Daftar Kosakata and the "Semua kata" SRS queue.
function seededShuffle(arr, seed) {
  const out = [...arr];
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

let vocabByLevel = { N5: [], N4: [] };
let vocabLevelOrder = { N5: [], N4: [] }; // seeded-shuffled copies, used only for level chunking
let progressByLevel = { N5: {}, N4: {} };
let vocabLevel = "N5";
let vocabLevelIndex = null; // null = semua kata; else index into chunk(vocabLevelOrder[vocabLevel], 10)
let vocab = [];       // active scope: vocabByLevel[vocabLevel], or a 10-word level slice of it
let progress = {};    // points to progressByLevel[vocabLevel]; id -> { box, due (ms) }
let queue = [];       // ids for current session
let queueTotal = 0;
let current = null;
let flipped = false;
let hintShown = false;

// Kanji Quizzer state
let kanjiListN5 = [];
let kanjiListN4 = [];
let kqLevel = "N5";
let kqLevelIndex = null; // null = semua kanji; else index into chunk(list, 5)
let kqQueue = [];
let kqIndex = 0;
let kqCorrect = 0;
let kqWrong = 0;
let kqQuestionFormat = "kanji";
let kqAnswerFormat = "kana";
let kqCurrentEntry = null;
let kqAnswered = false;
const KQ_FORMATS = ["kanji", "kana", "english"];

function kqFullList() {
  return kqLevel === "N4" ? kanjiListN4 : kanjiListN5;
}

function kqActiveList() {
  const full = kqFullList();
  if (kqLevelIndex === null) return full;
  return chunk(full, 5)[kqLevelIndex] || full;
}

// Latihan Soal (JLPT practice quiz) state
let quizDataN5 = [];
let quizDataN4 = [];
let pqLevel = "N5";
let pqSection = "vocab";
let pqQueue = [];
let pqIndex = 0;
let pqCorrect = 0;
let pqWrong = 0;
let pqCurrentQuestion = null;
let pqAnswered = false;
const PQ_SECTION_LABELS = { vocab: "Kosakata", grammar: "Tata Bahasa", reading: "Membaca" };

function pqActiveList() {
  const data = pqLevel === "N4" ? quizDataN4 : quizDataN5;
  return data.filter(q => q.section === pqSection);
}

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
  kqLevelToggle: document.getElementById("kqLevelToggle"),
  kqQuestionFormatToggle: document.getElementById("kqQuestionFormatToggle"),
  kqAnswerFormatToggle: document.getElementById("kqAnswerFormatToggle"),
  kqQuestion: document.getElementById("kqQuestion"),
  kqCardFlipInner: document.getElementById("kqCardFlipInner"),
  kqBackKanji: document.getElementById("kqBackKanji"),
  kqBackOnyomi: document.getElementById("kqBackOnyomi"),
  kqBackKunyomi: document.getElementById("kqBackKunyomi"),
  kqBackMeaning: document.getElementById("kqBackMeaning"),
  kqChoices: document.getElementById("kqChoices"),
  kqGroupLabel: document.getElementById("kqGroupLabel"),
  kqPositionLabel: document.getElementById("kqPositionLabel"),
  kqCorrect: document.getElementById("kqCorrect"),
  kqWrong: document.getElementById("kqWrong"),
  kqDone: document.getElementById("kqDone"),
  kqDoneSummary: document.getElementById("kqDoneSummary"),
  kqRestartBtn: document.getElementById("kqRestartBtn"),
  viewQuiz: document.getElementById("view-quiz"),
  pqLevelToggle: document.getElementById("pqLevelToggle"),
  pqSectionToggle: document.getElementById("pqSectionToggle"),
  pqSectionLabel: document.getElementById("pqSectionLabel"),
  pqPositionLabel: document.getElementById("pqPositionLabel"),
  pqPassage: document.getElementById("pqPassage"),
  pqQuestion: document.getElementById("pqQuestion"),
  pqNote: document.getElementById("pqNote"),
  pqChoices: document.getElementById("pqChoices"),
  pqCorrect: document.getElementById("pqCorrect"),
  pqWrong: document.getElementById("pqWrong"),
  pqDone: document.getElementById("pqDone"),
  pqDoneSummary: document.getElementById("pqDoneSummary"),
  pqRestartBtn: document.getElementById("pqRestartBtn"),
  vocabLevelSelect: document.getElementById("vocabLevelSelect"),
  kqLevelSelect: document.getElementById("kqLevelSelect"),

  // Rencana Belajar
  viewPlan: document.getElementById("view-plan"),
  spOverview: document.getElementById("spOverview"),
  spDayNumber: document.getElementById("spDayNumber"),
  spDaySub: document.getElementById("spDaySub"),
  spHistoryBody: document.getElementById("spHistoryBody"),
  spBrowse: document.getElementById("spBrowse"),
  spBrowseKindToggle: document.getElementById("spBrowseKindToggle"),
  spBrowsePos: document.getElementById("spBrowsePos"),
  spCard: document.getElementById("spCard"),
  spCardBox: document.getElementById("spCardBox"),
  spCardType: document.getElementById("spCardType"),
  spCardFront: document.getElementById("spCardFront"),
  spCardFrontBack: document.getElementById("spCardFrontBack"),
  spCardKana: document.getElementById("spCardKana"),
  spCardReadings: document.getElementById("spCardReadings"),
  spCardOnyomi: document.getElementById("spCardOnyomi"),
  spCardKunyomi: document.getElementById("spCardKunyomi"),
  spCardMeaning: document.getElementById("spCardMeaning"),
  spPrevBtn: document.getElementById("spPrevBtn"),
  spNextBtn: document.getElementById("spNextBtn"),
  spFinishBrowseBtn: document.getElementById("spFinishBrowseBtn"),
  spBackFromBrowseBtn: document.getElementById("spBackFromBrowseBtn"),
  spQuiz: document.getElementById("spQuiz"),
  spPhaseLabel: document.getElementById("spPhaseLabel"),
  spPositionLabel: document.getElementById("spPositionLabel"),
  spCorrect: document.getElementById("spCorrect"),
  spWrong: document.getElementById("spWrong"),
  spQuestion: document.getElementById("spQuestion"),
  spChoices: document.getElementById("spChoices"),
  spQuizDone: document.getElementById("spQuizDone"),
  spQuizDoneTitle: document.getElementById("spQuizDoneTitle"),
  spQuizDoneSummary: document.getElementById("spQuizDoneSummary"),
  spBackFromQuizBtn: document.getElementById("spBackFromQuizBtn"),
};

function loadAllProgress() {
  for (const lvl of ["N5", "N4"]) {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS[lvl]);
      progressByLevel[lvl] = raw ? JSON.parse(raw) : {};
    } catch (e) {
      progressByLevel[lvl] = {};
    }
  }
  progress = progressByLevel[vocabLevel];
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEYS[vocabLevel], JSON.stringify(progress));
}

function renderVocabLevelToggles() {
  document.querySelectorAll("[data-vocab-level-toggle] .fmt-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.vlevel === vocabLevel);
  });
}

function activeVocabList() {
  if (vocabLevelIndex === null) return vocabByLevel[vocabLevel];
  return chunk(vocabLevelOrder[vocabLevel], 10)[vocabLevelIndex] || vocabByLevel[vocabLevel];
}

function renderVocabLevelSelect() {
  const sel = el.vocabLevelSelect;
  sel.textContent = "";
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "Semua kata";
  sel.appendChild(allOpt);

  chunk(vocabLevelOrder[vocabLevel], 10).forEach((levelWords, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `Level ${i + 1} (${levelWords.length} kata)`;
    sel.appendChild(opt);
  });

  sel.value = vocabLevelIndex === null ? "" : String(vocabLevelIndex);
}

function setVocabLevelIndex(value) {
  vocabLevelIndex = value === "" ? null : parseInt(value, 10);
  vocab = activeVocabList();
  buildQueue();
  if (!el.viewList.classList.contains("hidden")) {
    renderVocabList(el.vocabSearch.value);
  }
}

function setVocabLevel(level) {
  if (level === vocabLevel || !vocabByLevel[level] || vocabByLevel[level].length === 0) return;
  vocabLevel = level;
  vocabLevelIndex = null;
  progress = progressByLevel[level];
  renderVocabLevelToggles();
  renderVocabLevelSelect();
  vocab = activeVocabList();
  buildQueue();
  if (!el.viewList.classList.contains("hidden")) {
    renderVocabList(el.vocabSearch.value);
  }
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
  el.viewQuiz.classList.toggle("hidden", view !== "quiz");
  el.viewPlan.classList.toggle("hidden", view !== "plan");

  if (view === "list") {
    renderVocabList(el.vocabSearch.value);
  } else if (view === "kanji" && kqQueue.length === 0 && kqActiveList().length > 0) {
    kqBuildQueue();
  } else if (view === "quiz" && pqQueue.length === 0 && pqActiveList().length > 0) {
    pqBuildQueue();
  } else if (view === "plan") {
    spShowOverview();
  }

  closeSidebar();
}

function kqDisplayValue(entry, format) {
  if (format === "kanji") return entry.kanji;
  if (format === "kana") return entry.kunyomi[0] || entry.onyomi[0];
  return entry.meaning.split(";")[0].trim();
}

function kqBuildQueue() {
  kqQueue = kqActiveList().map(k => k.id);
  shuffle(kqQueue);
  kqIndex = 0;
  kqCorrect = 0;
  kqWrong = 0;
  el.kqCorrect.textContent = "0";
  el.kqWrong.textContent = "0";
  kqRenderLevelToggle();
  kqRenderFormatToggles();
  kqShowQuestion();
}

function kqRenderLevelToggle() {
  el.kqLevelToggle.querySelectorAll(".fmt-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.level === kqLevel);
  });
}

function kqRenderLevelSelect() {
  const sel = el.kqLevelSelect;
  sel.textContent = "";
  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = "Semua kanji";
  sel.appendChild(allOpt);

  chunk(kqFullList(), 5).forEach((levelKanji, i) => {
    const start = i * 5 + 1;
    const end = start + levelKanji.length - 1;
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `Level ${i + 1} (kanji ${start}-${end})`;
    sel.appendChild(opt);
  });

  sel.value = kqLevelIndex === null ? "" : String(kqLevelIndex);
}

function kqSetLevelIndex(value) {
  kqLevelIndex = value === "" ? null : parseInt(value, 10);
  kqQueue = [];
  kqBuildQueue();
}

function kqSetLevel(level) {
  if (level === kqLevel) return;
  if ((level === "N4" ? kanjiListN4 : kanjiListN5).length === 0) return;
  kqLevel = level;
  kqLevelIndex = null;
  kqQueue = [];
  kqRenderLevelSelect();
  kqBuildQueue();
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
  el.kqCardFlipInner.classList.remove("flipped");

  if (kqIndex >= kqQueue.length) {
    document.querySelectorAll(".kq-header").forEach(el2 => el2.classList.add("hidden"));
    document.querySelector(".kq-meta").classList.add("hidden");
    el.kqQuestion.classList.add("hidden");
    el.kqChoices.classList.add("hidden");
    el.kqAnswerFormatToggle.classList.add("hidden");
    el.kqDone.classList.remove("hidden");
    el.kqDoneSummary.textContent = `Benar ${kqCorrect} dari ${kqQueue.length} (salah ${kqWrong}).`;
    return;
  }

  document.querySelectorAll(".kq-header").forEach(el2 => el2.classList.remove("hidden"));
  document.querySelector(".kq-meta").classList.remove("hidden");
  el.kqQuestion.classList.remove("hidden");
  el.kqChoices.classList.remove("hidden");
  el.kqAnswerFormatToggle.classList.remove("hidden");
  el.kqDone.classList.add("hidden");

  kqAnswered = false;
  const id = kqQueue[kqIndex];
  kqCurrentEntry = kqActiveList().find(k => k.id === id);

  el.kqQuestion.className = `kq-question fmt-${kqQuestionFormat}`;
  el.kqQuestion.textContent = kqDisplayValue(kqCurrentEntry, kqQuestionFormat);
  el.kqGroupLabel.textContent = `JLPT ${kqLevel} Group ${kqCurrentEntry.group}`;
  el.kqPositionLabel.textContent = `${kqIndex + 1} of ${kqQueue.length}`;

  el.kqBackKanji.textContent = kqCurrentEntry.kanji;
  el.kqBackOnyomi.textContent = kqCurrentEntry.onyomi.length ? kqCurrentEntry.onyomi.join("、") : "-";
  el.kqBackKunyomi.textContent = kqCurrentEntry.kunyomi.length ? kqCurrentEntry.kunyomi.join("、") : "-";
  el.kqBackMeaning.textContent = kqCurrentEntry.meaning;

  const correctValue = kqDisplayValue(kqCurrentEntry, kqAnswerFormat);
  const pool = kqActiveList().filter(k => k.id !== kqCurrentEntry.id);
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

  el.kqCardFlipInner.classList.add("flipped");

  setTimeout(() => {
    kqIndex++;
    kqShowQuestion();
  }, 1700);
}

function pqBuildQueue() {
  pqQueue = pqActiveList().map(q => q.id);
  shuffle(pqQueue);
  pqIndex = 0;
  pqCorrect = 0;
  pqWrong = 0;
  el.pqCorrect.textContent = "0";
  el.pqWrong.textContent = "0";
  pqRenderLevelToggle();
  pqRenderSectionToggle();
  pqShowQuestion();
}

function pqRenderLevelToggle() {
  el.pqLevelToggle.querySelectorAll(".fmt-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.level === pqLevel);
  });
}

function pqRenderSectionToggle() {
  el.pqSectionToggle.querySelectorAll(".fmt-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.section === pqSection);
  });
}

function pqSetLevel(level) {
  if (level === pqLevel) return;
  const data = level === "N4" ? quizDataN4 : quizDataN5;
  if (data.length === 0) return;
  pqLevel = level;
  pqQueue = [];
  pqBuildQueue();
}

function pqSetSection(section) {
  if (section === pqSection) return;
  pqSection = section;
  pqQueue = [];
  pqBuildQueue();
}

function pqShowQuestion() {
  if (pqQueue.length === 0 || pqIndex >= pqQueue.length) {
    document.querySelectorAll("#view-quiz .kq-header").forEach(el2 => el2.classList.add("hidden"));
    document.querySelector("#view-quiz .kq-meta").classList.add("hidden");
    el.pqPassage.classList.add("hidden");
    el.pqQuestion.classList.add("hidden");
    el.pqNote.classList.add("hidden");
    el.pqChoices.classList.add("hidden");
    el.pqDone.classList.remove("hidden");
    const total = pqQueue.length;
    el.pqDoneSummary.textContent = total
      ? `Benar ${pqCorrect} dari ${total} (salah ${pqWrong}).`
      : "Belum ada soal untuk bagian ini.";
    return;
  }

  document.querySelectorAll("#view-quiz .kq-header").forEach(el2 => el2.classList.remove("hidden"));
  document.querySelector("#view-quiz .kq-meta").classList.remove("hidden");
  el.pqQuestion.classList.remove("hidden");
  el.pqChoices.classList.remove("hidden");
  el.pqDone.classList.add("hidden");

  pqAnswered = false;
  const id = pqQueue[pqIndex];
  pqCurrentQuestion = pqActiveList().find(q => q.id === id);

  if (pqCurrentQuestion.passage) {
    el.pqPassage.textContent = pqCurrentQuestion.passage;
    el.pqPassage.classList.remove("hidden");
  } else {
    el.pqPassage.classList.add("hidden");
  }

  el.pqQuestion.textContent = pqCurrentQuestion.question;

  if (pqCurrentQuestion.note) {
    el.pqNote.textContent = `⚠️ ${pqCurrentQuestion.note}`;
    el.pqNote.classList.remove("hidden");
  } else {
    el.pqNote.classList.add("hidden");
  }

  el.pqSectionLabel.textContent = `JLPT ${pqLevel} · ${PQ_SECTION_LABELS[pqSection]}`;
  el.pqPositionLabel.textContent = `${pqIndex + 1} of ${pqQueue.length}`;

  el.pqChoices.textContent = "";
  pqCurrentQuestion.choices.forEach((text, idx) => {
    const btn = document.createElement("button");
    btn.className = "kq-choice";
    btn.textContent = text;
    btn.addEventListener("click", () => pqSelectAnswer(idx, btn));
    el.pqChoices.appendChild(btn);
  });
}

function pqSelectAnswer(idx, btnEl) {
  if (pqAnswered) return;
  pqAnswered = true;

  const isCorrect = idx === pqCurrentQuestion.answer;
  if (isCorrect) {
    pqCorrect++;
    el.pqCorrect.textContent = pqCorrect;
    btnEl.classList.add("correct");
  } else {
    pqWrong++;
    el.pqWrong.textContent = pqWrong;
    btnEl.classList.add("wrong");
  }

  el.pqChoices.querySelectorAll(".kq-choice").forEach((b, i) => {
    b.disabled = true;
    if (i === pqCurrentQuestion.answer && b !== btnEl) {
      b.classList.add("correct");
    }
  });

  setTimeout(() => {
    pqIndex++;
    pqShowQuestion();
  }, 900);
}

// ===================== Rencana Belajar (daily study plan) =====================

const SP_STORAGE_KEY = "study-plan-v1";
const SP_VOCAB_CHUNK = 10;
const SP_KANJI_CHUNK = 5;
const SP_SESSION_KEYS = ["s1", "s2", "s3", "s4"];
const SP_FORMATS = ["kanji", "kana", "english"];

let sp = null;
let spBrowseKind = "vocab";
let spBrowseIndex = 0;
let spBrowseFlipped = false;
let spQuizKey = null;
let spQuizPhase = "vocab";
let spQuizQuestions = { vocab: [], kanji: [] };
let spQuizIndex = 0;
let spQuizCorrect = 0;
let spQuizWrong = 0;
let spQuizAnswered = false;
let spQuizCurrentQuestion = null;

function spEmptySessions() {
  return {
    s1: { done: false },
    s2: { done: false, correct: 0, wrong: 0 },
    s3: { done: false, correct: 0, wrong: 0 },
    s4: { done: false, correct: 0, wrong: 0 },
  };
}

function spLoad() {
  try {
    const raw = localStorage.getItem(SP_STORAGE_KEY);
    sp = raw ? JSON.parse(raw) : null;
  } catch (e) {
    sp = null;
  }
  if (!sp) {
    sp = { day: 1, sessions: spEmptySessions(), weaknessVocab: {}, weaknessKanji: {}, history: [] };
  }
}

function spSave() {
  localStorage.setItem(SP_STORAGE_KEY, JSON.stringify(sp));
}

function spVocabPool() {
  return [...vocabLevelOrder.N5, ...vocabLevelOrder.N4];
}

function spKanjiPool() {
  return [...kanjiListN5, ...kanjiListN4];
}

function spDayVocab(day) {
  return spVocabPool().slice((day - 1) * SP_VOCAB_CHUNK, day * SP_VOCAB_CHUNK);
}

function spDayKanji(day) {
  return spKanjiPool().slice((day - 1) * SP_KANJI_CHUNK, day * SP_KANJI_CHUNK);
}

function spLevelLabel(poolIndexStart, n5Length) {
  return poolIndexStart < n5Length ? "N5" : "N4";
}

function spDaySubLabel(day) {
  const vLabel = spLevelLabel((day - 1) * SP_VOCAB_CHUNK, vocabByLevel.N5.length);
  const kLabel = spLevelLabel((day - 1) * SP_KANJI_CHUNK, kanjiListN5.length);
  return `Vocab ${vLabel} · Kanji ${kLabel}`;
}

function spDisplayValue(entry, format, kind) {
  if (format === "kanji") return entry.kanji;
  if (format === "kana") return kind === "kanji" ? (entry.kunyomi[0] || entry.onyomi[0]) : entry.kana;
  return entry.meaning.split(";")[0].trim();
}

function spWeightedSample(pool, weaknessMap, count) {
  const bag = [];
  pool.forEach(item => {
    const weight = 1 + (weaknessMap[item.id] || 0);
    for (let i = 0; i < weight; i++) bag.push(item);
  });
  shuffle(bag);
  const seen = new Set();
  const result = [];
  for (const item of bag) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
    if (result.length >= count) break;
  }
  return result;
}

function spReviewEntries(kind, count) {
  if (sp.day <= 1) return [];
  const pool = kind === "vocab" ? spVocabPool() : spKanjiPool();
  const chunkSize = kind === "vocab" ? SP_VOCAB_CHUNK : SP_KANJI_CHUNK;
  const historicalPool = pool.slice(0, (sp.day - 1) * chunkSize);
  const weakness = kind === "vocab" ? sp.weaknessVocab : sp.weaknessKanji;
  return spWeightedSample(historicalPool, weakness, count);
}

function spMakeQuestion(entry, qFormat, aFormat, kind, pool) {
  const correctValue = spDisplayValue(entry, aFormat, kind);
  const candidates = pool.filter(e => e.id !== entry.id);
  shuffle(candidates);

  const distractors = [];
  const seen = new Set([correctValue]);
  for (const c of candidates) {
    if (distractors.length >= 3) break;
    const val = spDisplayValue(c, aFormat, kind);
    if (seen.has(val)) continue;
    seen.add(val);
    distractors.push(c);
  }

  const choiceEntries = [entry, ...distractors];
  shuffle(choiceEntries);

  return {
    kind,
    qFormat,
    questionText: spDisplayValue(entry, qFormat, kind),
    choices: choiceEntries.map(c => ({ id: c.id, text: spDisplayValue(c, aFormat, kind) })),
    answerId: entry.id,
  };
}

function spBuildPhaseQuestions(entries, kind) {
  const pool = kind === "vocab" ? spVocabPool() : spKanjiPool();
  const allPairs = [];
  SP_FORMATS.forEach(qf => SP_FORMATS.forEach(af => { if (qf !== af) allPairs.push([qf, af]); }));

  const questions = [];
  entries.forEach(entry => {
    const pairs = [...allPairs];
    shuffle(pairs);
    pairs.slice(0, 2).forEach(([qFormat, aFormat]) => {
      questions.push(spMakeQuestion(entry, qFormat, aFormat, kind, pool));
    });
  });

  shuffle(questions);
  return questions;
}

function spEnsureLoaded() {
  if (!sp) spLoad();
}

function spCheckDayAdvance() {
  const allDone = SP_SESSION_KEYS.every(k => sp.sessions[k].done);
  if (!allDone) return;

  sp.history.push({
    day: sp.day,
    vocabLabel: spLevelLabel((sp.day - 1) * SP_VOCAB_CHUNK, vocabByLevel.N5.length),
    kanjiLabel: spLevelLabel((sp.day - 1) * SP_KANJI_CHUNK, kanjiListN5.length),
    sessions: JSON.parse(JSON.stringify(sp.sessions)),
  });
  sp.day += 1;
  sp.sessions = spEmptySessions();
  spSave();
}

function spShowOverview() {
  spEnsureLoaded();
  el.spOverview.classList.remove("hidden");
  el.spBrowse.classList.add("hidden");
  el.spQuiz.classList.add("hidden");
  spRenderOverview();
}

function spRenderOverview() {
  el.spDayNumber.textContent = sp.day;
  el.spDaySub.textContent = spDaySubLabel(sp.day);

  SP_SESSION_KEYS.forEach(key => {
    const s = sp.sessions[key];
    const statusEl = document.getElementById(`spStatus_${key}`);
    if (s.done) {
      statusEl.textContent = key === "s1" ? "✓ Selesai" : `✓ ${s.correct} benar, ${s.wrong} salah`;
      statusEl.classList.add("done");
    } else {
      statusEl.textContent = "Belum dikerjakan";
      statusEl.classList.remove("done");
    }
  });

  spRenderHistory();
}

function spRenderHistory() {
  el.spHistoryBody.textContent = "";
  const frag = document.createDocumentFragment();

  [...sp.history].reverse().forEach(rec => {
    const tr = document.createElement("tr");
    const scoreText = s => (s ? `${s.correct}/${s.correct + s.wrong}` : "-");
    const cells = [
      `Hari ${rec.day}`,
      `Vocab ${rec.vocabLabel} · Kanji ${rec.kanjiLabel}`,
      scoreText(rec.sessions.s2),
      scoreText(rec.sessions.s3),
      scoreText(rec.sessions.s4),
    ];
    cells.forEach(text => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  });

  el.spHistoryBody.appendChild(frag);
}

function spStartSession(key) {
  if (key === "s1") {
    spStartBrowse();
  } else {
    spStartQuiz(key);
  }
}

// --- Sesi 1: belajar bebas, tanpa skor ---

function spBrowseList() {
  return spBrowseKind === "vocab" ? spDayVocab(sp.day) : spDayKanji(sp.day);
}

function spRenderBrowseKindToggle() {
  el.spBrowseKindToggle.querySelectorAll(".fmt-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.kind === spBrowseKind);
  });
}

function spSetBrowseKind(kind) {
  if (kind === spBrowseKind) return;
  spBrowseKind = kind;
  spBrowseIndex = 0;
  spRenderBrowseKindToggle();
  spShowBrowseCard();
}

function spStartBrowse() {
  el.spOverview.classList.add("hidden");
  el.spQuiz.classList.add("hidden");
  el.spBrowse.classList.remove("hidden");
  spBrowseKind = "vocab";
  spBrowseIndex = 0;
  spRenderBrowseKindToggle();
  spShowBrowseCard();
}

function spShowBrowseCard() {
  const list = spBrowseList();
  spBrowseFlipped = false;
  el.spCardBox.classList.remove("flipped");

  if (list.length === 0) {
    el.spCardType.textContent = "";
    el.spCardFront.textContent = "-";
    el.spCardFrontBack.textContent = "-";
    el.spCardKana.textContent = "";
    el.spCardKana.classList.remove("hidden");
    el.spCardReadings.classList.add("hidden");
    el.spCardMeaning.textContent = "Tidak ada konten baru untuk hari ini.";
    el.spBrowsePos.textContent = "0 of 0";
    return;
  }

  const entry = list[spBrowseIndex];
  el.spBrowsePos.textContent = `${spBrowseIndex + 1} of ${list.length}`;
  el.spCardFront.textContent = entry.kanji;
  el.spCardFrontBack.textContent = entry.kanji;
  el.spCardMeaning.textContent = entry.meaning;

  if (spBrowseKind === "vocab") {
    el.spCardType.textContent = entry.type.split(",")[0].trim();
    el.spCardKana.textContent = entry.kana;
    el.spCardKana.classList.remove("hidden");
    el.spCardReadings.classList.add("hidden");
  } else {
    el.spCardType.textContent = "Kanji";
    el.spCardKana.classList.add("hidden");
    el.spCardReadings.classList.remove("hidden");
    el.spCardOnyomi.textContent = entry.onyomi.length ? entry.onyomi.join("、") : "-";
    el.spCardKunyomi.textContent = entry.kunyomi.length ? entry.kunyomi.join("、") : "-";
  }
}

function spFlipBrowseCard() {
  if (spBrowseList().length === 0) return;
  spBrowseFlipped = !spBrowseFlipped;
  el.spCardBox.classList.toggle("flipped", spBrowseFlipped);
}

function spBrowsePrev() {
  const list = spBrowseList();
  if (list.length === 0) return;
  spBrowseIndex = (spBrowseIndex - 1 + list.length) % list.length;
  spShowBrowseCard();
}

function spBrowseNext() {
  const list = spBrowseList();
  if (list.length === 0) return;
  spBrowseIndex = (spBrowseIndex + 1) % list.length;
  spShowBrowseCard();
}

function spFinishBrowse() {
  sp.sessions.s1.done = true;
  spSave();
  spCheckDayAdvance();
  spShowOverview();
}

function spBackFromBrowse() {
  spShowOverview();
}

// --- Sesi 2/3/4: kuis bertahap (kosakata dulu, lalu kanji), berskor ---

function spCurrentPhaseQuestions() {
  return spQuizQuestions[spQuizPhase];
}

function spStartQuiz(key) {
  spQuizKey = key;
  spQuizCorrect = 0;
  spQuizWrong = 0;
  el.spCorrect.textContent = "0";
  el.spWrong.textContent = "0";

  let vocabEntries = spDayVocab(sp.day);
  let kanjiEntries = spDayKanji(sp.day);
  if (key === "s4") {
    vocabEntries = vocabEntries.concat(spReviewEntries("vocab", 5));
    kanjiEntries = kanjiEntries.concat(spReviewEntries("kanji", 3));
  }

  spQuizQuestions.vocab = vocabEntries.length ? spBuildPhaseQuestions(vocabEntries, "vocab") : [];
  spQuizQuestions.kanji = kanjiEntries.length ? spBuildPhaseQuestions(kanjiEntries, "kanji") : [];
  spQuizPhase = spQuizQuestions.vocab.length ? "vocab" : "kanji";
  spQuizIndex = 0;

  el.spOverview.classList.add("hidden");
  el.spBrowse.classList.add("hidden");
  el.spQuiz.classList.remove("hidden");

  spShowQuizQuestion();
}

function spShowQuizQuestion() {
  const list = spCurrentPhaseQuestions();

  if (spQuizIndex >= list.length) {
    if (spQuizPhase === "vocab" && spQuizQuestions.kanji.length > 0) {
      spQuizPhase = "kanji";
      spQuizIndex = 0;
      spShowQuizQuestion();
      return;
    }
    spFinishQuiz();
    return;
  }

  spQuizAnswered = false;
  spQuizCurrentQuestion = list[spQuizIndex];

  el.spPhaseLabel.textContent = spQuizPhase === "vocab" ? "Kosakata" : "Kanji";
  el.spPositionLabel.textContent = `${spQuizIndex + 1} of ${list.length}`;
  el.spQuestion.className = `kq-question fmt-${spQuizCurrentQuestion.qFormat}`;
  el.spQuestion.textContent = spQuizCurrentQuestion.questionText;
  el.spQuestion.classList.remove("hidden");
  el.spChoices.classList.remove("hidden");
  el.spQuizDone.classList.add("hidden");

  el.spChoices.textContent = "";
  spQuizCurrentQuestion.choices.forEach(choice => {
    const btn = document.createElement("button");
    btn.className = "kq-choice";
    btn.textContent = choice.text;
    btn.addEventListener("click", () => spSelectAnswer(choice, btn));
    el.spChoices.appendChild(btn);
  });
}

function spSelectAnswer(choice, btnEl) {
  if (spQuizAnswered) return;
  spQuizAnswered = true;

  const isCorrect = choice.id === spQuizCurrentQuestion.answerId;
  const weaknessMap = spQuizPhase === "vocab" ? sp.weaknessVocab : sp.weaknessKanji;

  if (isCorrect) {
    spQuizCorrect++;
    el.spCorrect.textContent = spQuizCorrect;
    btnEl.classList.add("correct");
  } else {
    spQuizWrong++;
    el.spWrong.textContent = spQuizWrong;
    btnEl.classList.add("wrong");
    weaknessMap[spQuizCurrentQuestion.answerId] = (weaknessMap[spQuizCurrentQuestion.answerId] || 0) + 1;
  }

  const buttons = [...el.spChoices.querySelectorAll(".kq-choice")];
  buttons.forEach((b, i) => {
    b.disabled = true;
    if (b !== btnEl && spQuizCurrentQuestion.choices[i].id === spQuizCurrentQuestion.answerId) {
      b.classList.add("correct");
    }
  });

  setTimeout(() => {
    spQuizIndex++;
    spShowQuizQuestion();
  }, 900);
}

function spFinishQuiz() {
  sp.sessions[spQuizKey] = { done: true, correct: spQuizCorrect, wrong: spQuizWrong };
  spSave();
  spCheckDayAdvance();

  el.spQuestion.classList.add("hidden");
  el.spChoices.classList.add("hidden");
  el.spQuizDone.classList.remove("hidden");
  const total = spQuizCorrect + spQuizWrong;
  el.spQuizDoneSummary.textContent = total
    ? `Benar ${spQuizCorrect} dari ${total} (salah ${spQuizWrong}).`
    : "Tidak ada soal untuk sesi ini.";
}

function spBackFromQuiz() {
  spShowOverview();
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
  loadAllProgress();
  renderVocabLevelToggles();
  spLoad();

  // vocab.json is the N5 dataset (kept at its original path); vocab-n4.json is N4.
  Promise.all([
    fetch("data/vocab.json").then(r => r.json()),
    fetch("data/vocab-n4.json").then(r => r.json()),
  ])
    .then(([n5, n4]) => {
      vocabByLevel.N5 = n5;
      vocabByLevel.N4 = n4;
      vocabLevelOrder.N5 = seededShuffle(n5, 20260722);
      vocabLevelOrder.N4 = seededShuffle(n4, 20260723);
      vocab = activeVocabList();
      renderVocabLevelSelect();
      buildQueue();
    })
    .catch(err => {
      el.cardKanji.textContent = "⚠";
      el.cardType.textContent = "error";
      console.error("Gagal memuat data vocab:", err);
    });

  fetch("data/kanji-n5.json")
    .then(r => r.json())
    .then(data => {
      kanjiListN5 = data;
      kqRenderLevelSelect();
      if (!el.viewKanji.classList.contains("hidden") && kqQueue.length === 0) {
        kqBuildQueue();
      }
    })
    .catch(err => console.error("Gagal memuat kanji-n5.json:", err));

  fetch("data/kanji-n4.json")
    .then(r => r.json())
    .then(data => {
      kanjiListN4 = data;
      if (kqLevel === "N4" && !el.viewKanji.classList.contains("hidden") && kqQueue.length === 0) {
        kqBuildQueue();
      }
    })
    .catch(err => console.error("Gagal memuat kanji-n4.json:", err));

  fetch("data/quiz-n5.json")
    .then(r => r.json())
    .then(data => {
      quizDataN5 = data;
      if (pqLevel === "N5" && !el.viewQuiz.classList.contains("hidden") && pqQueue.length === 0) {
        pqBuildQueue();
      }
    })
    .catch(err => console.error("Gagal memuat quiz-n5.json:", err));

  fetch("data/quiz-n4.json")
    .then(r => r.json())
    .then(data => {
      quizDataN4 = data;
      if (pqLevel === "N4" && !el.viewQuiz.classList.contains("hidden") && pqQueue.length === 0) {
        pqBuildQueue();
      }
    })
    .catch(err => console.error("Gagal memuat quiz-n4.json:", err));

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
    if (confirm(`Reset semua progres belajar ${vocabLevel}? Ini tidak bisa dibatalkan.`)) {
      progress = {};
      progressByLevel[vocabLevel] = progress;
      saveProgress();
      buildQueue();
      showToast(`Progres ${vocabLevel} direset`);
    }
  });

  document.querySelectorAll("[data-vocab-level-toggle] .fmt-btn").forEach(btn => {
    btn.addEventListener("click", () => setVocabLevel(btn.dataset.vlevel));
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

  el.kqLevelToggle.querySelectorAll(".fmt-btn").forEach(btn => {
    btn.addEventListener("click", () => kqSetLevel(btn.dataset.level));
  });

  el.kqRestartBtn.addEventListener("click", () => {
    kqQueue = [];
    kqBuildQueue();
  });

  el.pqLevelToggle.querySelectorAll(".fmt-btn").forEach(btn => {
    btn.addEventListener("click", () => pqSetLevel(btn.dataset.level));
  });

  el.pqSectionToggle.querySelectorAll(".fmt-btn").forEach(btn => {
    btn.addEventListener("click", () => pqSetSection(btn.dataset.section));
  });

  el.pqRestartBtn.addEventListener("click", () => {
    pqQueue = [];
    pqBuildQueue();
  });

  el.vocabLevelSelect.addEventListener("change", () => setVocabLevelIndex(el.vocabLevelSelect.value));
  el.kqLevelSelect.addEventListener("change", () => kqSetLevelIndex(el.kqLevelSelect.value));

  document.querySelectorAll("[data-start]").forEach(btn => {
    btn.addEventListener("click", () => spStartSession(btn.dataset.start));
  });

  el.spBrowseKindToggle.querySelectorAll(".fmt-btn").forEach(btn => {
    btn.addEventListener("click", () => spSetBrowseKind(btn.dataset.kind));
  });

  el.spCard.addEventListener("click", spFlipBrowseCard);
  el.spPrevBtn.addEventListener("click", e => { e.stopPropagation(); spBrowsePrev(); });
  el.spNextBtn.addEventListener("click", e => { e.stopPropagation(); spBrowseNext(); });
  el.spFinishBrowseBtn.addEventListener("click", spFinishBrowse);
  el.spBackFromBrowseBtn.addEventListener("click", spBackFromBrowse);
  el.spBackFromQuizBtn.addEventListener("click", spBackFromQuiz);
}

init();
