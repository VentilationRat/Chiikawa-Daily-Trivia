// ===== CONFIG: paste your Supabase values here =====
const SUPABASE_URL = "https://ecsldifiixdsbzckqwqk.supabase.co";
const SUPABASE_KEY = "sb_publishable_t5bhaKroerm8Lqu37XNjrw_DeJe-mZw";

const QUESTIONS_PER_DAY = 5;
const START_DATE = Date.UTC(2026, 8, 1); // Puzzle #1 is Sept 1, 2026 (months are 0-based)

// ===== Setup =====
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);

// The day changes at midnight UTC, so everyone shares the same puzzle and leaderboard.
const dayNumber = Math.floor((Date.now() - START_DATE) / 86400000) + 1;
const storageKey = `chiikawa-trivia-day-${dayNumber}`;

// Seeded random so every player gets the same 5 questions on the same day.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const todaysQuestions = seededShuffle(QUESTIONS, mulberry32(dayNumber)).slice(0, QUESTIONS_PER_DAY);

// ===== Saved progress =====
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(storageKey)); } catch { return null; }
}
function save(data) {
  try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch {}
}

// ===== Quiz flow =====
let current = 0;
let results = [];
let startTime = 0;

function show(screen) {
  for (const id of ["start-screen", "quiz-screen", "result-screen"]) {
    $(id).hidden = id !== screen;
  }
}

function startQuiz() {
  current = 0;
  results = [];
  startTime = Date.now();
  show("quiz-screen");
  renderQuestion();
}

function renderQuestion() {
  const item = todaysQuestions[current];
  $("progress").textContent = `Question ${current + 1} of ${todaysQuestions.length}`;
  $("question-text").textContent = item.q;
  $("next-btn").hidden = true;

  const box = $("choices");
  box.innerHTML = "";
  item.choices.forEach((text, i) => {
    const btn = document.createElement("button");
    btn.className = "choice";
    btn.textContent = text;
    btn.addEventListener("click", () => pick(i));
    box.appendChild(btn);
  });
  box.firstChild.focus();
}

function pick(index) {
  const item = todaysQuestions[current];
  const buttons = [...$("choices").children];
  buttons.forEach((b) => (b.disabled = true));
  buttons[item.answer].classList.add("correct");
  if (index !== item.answer) buttons[index].classList.add("wrong");

  results.push(index === item.answer);

  const last = current === todaysQuestions.length - 1;
  $("next-btn").textContent = last ? "See my score" : "Next question";
  $("next-btn").hidden = false;
  $("next-btn").focus();
}

function next() {
  if (current < todaysQuestions.length - 1) {
    current++;
    renderQuestion();
  } else {
    const data = { results, timeMs: Date.now() - startTime, submitted: false };
    save(data);
    showResults(data);
  }
}

// ===== Results + sharing =====
const scoreOf = (data) => data.results.filter(Boolean).length;
const gridOf = (data) => data.results.map((r) => (r ? "🟩" : "🟥")).join("");

function showResults(data) {
  show("result-screen");
  $("result-score").textContent = `You got ${scoreOf(data)} out of ${data.results.length}`;
  $("result-grid").textContent = gridOf(data);
  $("result-time").textContent = `Time: ${(data.timeMs / 1000).toFixed(1)} seconds. Come back tomorrow for new questions.`;
  $("score-form").hidden = data.submitted;
}

async function share() {
  const data = loadSaved();
  const text = `Daily Chiikawa Trivia #${dayNumber}\n${gridOf(data)} ${scoreOf(data)}/${data.results.length}\n${location.href}`;
  try {
    await navigator.clipboard.writeText(text);
    $("share-btn").textContent = "Copied";
  } catch {
    $("share-btn").textContent = "Copy failed. Select the text manually.";
  }
}

// ===== Leaderboard =====
async function submitScore(event) {
  event.preventDefault();
  const data = loadSaved();
  const name = $("name-input").value.trim();
  if (!data || !name) return;

  $("submit-status").textContent = "Adding your score...";
  const { error } = await db.from("scores").insert({
    day_number: dayNumber,
    player_name: name,
    score: scoreOf(data),
    time_ms: data.timeMs
  });

  if (error) {
    $("submit-status").textContent =
      error.code === "23505"
        ? "Someone already used that name today. Try another one."
        : `Your score wasn't added: ${error.message}`;
    return;
  }

  data.submitted = true;
  save(data);
  $("score-form").hidden = true;
  $("submit-status").textContent = "Score added.";
  loadLeaderboard();
}

async function loadLeaderboard() {
  const list = $("leaderboard-list");
  const { data, error } = await db
    .from("scores")
    .select("player_name, score, time_ms")
    .eq("day_number", dayNumber)
    .order("score", { ascending: false })
    .order("time_ms", { ascending: true })
    .limit(10);

  list.innerHTML = "";
  if (error) {
    list.innerHTML = "<li>The leaderboard couldn't load. Check your Supabase URL and key in app.js.</li>";
    return;
  }
  if (data.length === 0) {
    list.innerHTML = "<li>No scores yet today. Be the first.</li>";
    return;
  }
  for (const row of data) {
    const li = document.createElement("li");
    li.textContent = `${row.player_name} `;
    const stat = document.createElement("span");
    stat.className = "stat";
    stat.textContent = `${row.score}/5 in ${(row.time_ms / 1000).toFixed(1)}s`;
    li.appendChild(stat);
    list.appendChild(li);
  }
}

// ===== Start =====
$("day-label").textContent = `Puzzle #${dayNumber}`;
$("start-btn").addEventListener("click", startQuiz);
$("next-btn").addEventListener("click", next);
$("share-btn").addEventListener("click", share);
$("score-form").addEventListener("submit", submitScore);

const saved = loadSaved();
if (saved) showResults(saved);
loadLeaderboard();
