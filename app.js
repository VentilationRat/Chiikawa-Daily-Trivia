// ===== CONFIG: paste your Supabase values here =====
const SUPABASE_URL = "https://ecsldifiixdsbzckqwqk.supabase.co";
const SUPABASE_KEY = "sb_publishable_t5bhaKroerm8Lqu37XNjrw_DeJe-mZw";

const QUESTIONS_PER_DAY = 5;
const SECONDS_PER_QUESTION = 30;
const START_DATE = Date.UTC(2026, 8, 1); // Puzzle #1 is Sept 1, 2026 (months are 0-based)

// ===== Setup =====
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);

// The day changes at midnight UTC, so everyone shares the same puzzle and stats.
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

const dayRng = mulberry32(dayNumber);
// Pick today's questions, then shuffle each question's choices so the right answer isn't always in the same spot.
const todaysQuestions = seededShuffle(QUESTIONS, dayRng)
  .slice(0, QUESTIONS_PER_DAY)
  .map((item) => {
    const order = seededShuffle(item.choices.map((_, i) => i), dayRng);
    return {
      q: item.q,
      choices: order.map((i) => item.choices[i]),
      answer: order.indexOf(item.answer)
    };
  });

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
let timerId = null;
let deadline = 0;

function show(screen) {
  for (const id of ["start-screen", "quiz-screen", "result-screen"]) {
    $(id).hidden = id !== screen;
  }
  $("stats-panel").hidden = screen !== "result-screen";
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
  startTimer();
}

// ===== Question timer =====
// Counts down from a fixed deadline so a slow or backgrounded tab can't add extra time.
function startTimer() {
  stopTimer();
  deadline = Date.now() + SECONDS_PER_QUESTION * 1000;
  tick();
  timerId = setInterval(tick, 200);
}

function stopTimer() {
  clearInterval(timerId);
  timerId = null;
}

function tick() {
  const msLeft = Math.max(0, deadline - Date.now());
  const secondsLeft = Math.ceil(msLeft / 1000);
  $("timer-text").textContent = `${secondsLeft}s`;
  $("timer-fill").style.width = `${(msLeft / (SECONDS_PER_QUESTION * 1000)) * 100}%`;
  $("quiz-screen").classList.toggle("timer-low", secondsLeft <= 10);
  if (msLeft === 0) pick(null);
}

// index is null when the timer ran out, which counts as wrong.
function pick(index) {
  stopTimer();
  const item = todaysQuestions[current];
  const buttons = [...$("choices").children];
  buttons.forEach((b) => (b.disabled = true));
  buttons[item.answer].classList.add("correct");
  if (index === null) $("timer-text").textContent = "Time's up";
  else if (index !== item.answer) buttons[index].classList.add("wrong");

  results.push(index === item.answer);

  const last = current === todaysQuestions.length - 1;
  $("next-btn").textContent = last ? "See my score" : "Next question";
  $("next-btn").hidden = false;
  $("next-btn").focus();
}

async function next() {
  if (current < todaysQuestions.length - 1) {
    current++;
    renderQuestion();
  } else {
    const data = { results, timeMs: Date.now() - startTime, submitted: false };
    save(data);
    showResults(data);
    await submitScore(data);
    loadStats(data);
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

// ===== Saving the score (no names, just the number) =====
async function submitScore(data) {
  if (data.submitted) return;
  const { error } = await db.from("scores").insert({ day_number: dayNumber, score: scoreOf(data) });
  if (error) {
    console.error("Score not saved:", error.message);
    return;
  }
  data.submitted = true;
  save(data);
}

// ===== Stats: percentile + chart =====
async function loadStats(data) {
  const myScore = scoreOf(data);
  const { data: rows, error } = await db.rpc("score_distribution", { p_day: dayNumber });

  if (error) {
    $("percentile").textContent = "Today's stats couldn't load.";
    $("stats-note").textContent = "Check your Supabase URL and key in app.js.";
    return;
  }

  // counts[s] = number of players who scored s today
  const counts = Array(QUESTIONS_PER_DAY + 1).fill(0);
  for (const row of rows) counts[row.score] = Number(row.players);

  const total = counts.reduce((a, b) => a + b, 0);
  const others = data.submitted ? total - 1 : total; // don't compare you to yourself
  const lower = counts.slice(0, myScore).reduce((a, b) => a + b, 0);

  if (others <= 0) {
    $("percentile").textContent = "You're the first player today!";
  } else {
    const pct = Math.round((lower / others) * 100);
    $("percentile").textContent = `You did better than ${pct}% of players`;
  }

  $("stats-note").textContent = `${total} ${total === 1 ? "player has" : "players have"} played today.`;
  renderChart(counts, myScore, total);
}

function renderChart(counts, myScore, total) {
  const chart = $("chart");
  const max = Math.max(...counts, 1);
  chart.innerHTML = "";
  chart.setAttribute("aria-label", counts.map((n, s) => `${n} scored ${s}`).join(", "));

  counts.forEach((n, s) => {
    const col = document.createElement("div");
    col.className = "bar-col" + (s === myScore ? " mine" : "");

    const value = document.createElement("span");
    value.className = "bar-value";
    value.textContent = total ? `${Math.round((n / total) * 100)}%` : "0%";

    const track = document.createElement("div");
    track.className = "bar-track";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = "0%";
    track.appendChild(bar);

    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = s;

    col.append(value, track, label);
    chart.appendChild(col);
    requestAnimationFrame(() => (bar.style.height = `${(n / max) * 100}%`));
  });
}

// ===== Start =====
$("day-label").textContent = `Puzzle #${dayNumber}`;
$("start-btn").addEventListener("click", startQuiz);
$("next-btn").addEventListener("click", next);
$("share-btn").addEventListener("click", share);

(async () => {
  const saved = loadSaved();
  if (!saved) return;
  showResults(saved);
  await submitScore(saved); // retries if the first save failed
  loadStats(saved);
})();
// Background music: loops the song, with a play/pause toggle and volume slider.
(function setupMusic() {
  const audio = document.getElementById("bg-music");
  const toggle = document.getElementById("music-toggle");
  const volume = document.getElementById("music-volume");

  audio.volume = Number(volume.value);

  function render() {
    toggle.textContent = audio.paused ? "▶" : "❚❚";
    toggle.setAttribute("aria-label", audio.paused ? "Play music" : "Pause music");
  }

  toggle.addEventListener("click", () => {
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  });

  volume.addEventListener("input", () => {
    audio.volume = Number(volume.value);
  });

  audio.addEventListener("play", render);
  audio.addEventListener("pause", render);

  // Browsers block sound until the visitor interacts. If autoplay is refused,
  // show a tap-to-enter screen so the song starts with that first tap.
  const enterScreen = document.getElementById("enter-screen");
  const enterBtn = document.getElementById("enter-btn");

  enterBtn.addEventListener("click", () => {
    enterScreen.hidden = true;
    audio.play().catch(() => {});
  });

  audio.play().catch(() => {
    enterScreen.hidden = false;
    enterBtn.focus();
  });
  render();
})();

// Crucify button: shows Momonga over a fire gif with the burning sound for 6 seconds,
// pausing the background song and resuming it afterwards if it was playing.
(function setupCrucify() {
  const DURATION_MS = 6000;
  const FIRE_GIF = "gif/cfc92674208b20a4a3ce01defecccd32.gif";
  const button = document.getElementById("crucify-btn");
  const overlay = document.getElementById("crucify-overlay");
  const fire = document.getElementById("crucify-fire");
  const sound = document.getElementById("crucify-sound");
  const music = document.getElementById("bg-music");

  button.addEventListener("click", () => {
    const musicWasPlaying = !music.paused;
    music.pause();

    button.disabled = true;
    fire.src = `${FIRE_GIF}?t=${Date.now()}`; // fresh URL restarts the gif from its first frame
    overlay.hidden = false;
    sound.currentTime = 0;
    sound.play().catch(() => {});

    setTimeout(() => {
      sound.pause();
      overlay.hidden = true;
      fire.removeAttribute("src");
      button.disabled = false;
      if (musicWasPlaying) music.play().catch(() => {});
    }, DURATION_MS);
  });
})();
