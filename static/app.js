const $ = id => document.getElementById(id);
const icons = code => code === 0 ? "☀" : code <= 3 ? "⛅" : code <= 67 ? "🌧" : code <= 77 ? "❄" : "⛈";

const STATUS_INTERVAL_MS = 5000;
const CLOCK_INTERVAL_MS = 1000;
const FETCH_TIMEOUT_MS = 10000;

function tick() {
  const d = new Date();
  $("clock").textContent = d.toLocaleTimeString("ja-JP", {hour: "2-digit", minute: "2-digit"});
  $("mini-time").textContent = $("clock").textContent;
  $("date").textContent = d.toLocaleDateString("ja-JP", {month: "long", day: "numeric", weekday: "long"});
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {...options, cache: "no-store", signal: controller.signal});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function update() {
  try {
    const s = await fetchJson("/api/status");
    $("device-name").textContent = s.selected_cast || "未選択";
    const w = s.weather;
    $("weather-icon").textContent = icons(w.code);
    $("temperature").textContent = w.temperature == null ? "--℃" : `${Math.round(w.temperature)}℃`;
    $("rain").textContent = `降水 ${w.precipitation ?? "--"}%`;
    $("mini-weather").textContent = `${icons(w.code)} ${w.temperature == null ? "--" : Math.round(w.temperature)}℃  降水 ${w.precipitation ?? "--"}%`;
    const playing = Boolean(s.cast.playing);
    $("clock-screen").classList.toggle("hidden", playing);
    $("music-screen").classList.toggle("hidden", !playing);
    if (playing) {
      $("title").textContent = s.cast.title || "タイトル不明";
      $("artist").textContent = s.cast.artist || "アーティスト不明";
      $("album").textContent = s.cast.album || "";
      if (s.cast.image) $("cover").src = s.cast.image;
    }
  } catch (error) {
    console.warn("Status update failed:", error);
  }
}

// setTimeout is scheduled only after the previous update finishes. This avoids
// piling up fetches if the network or backend temporarily stalls.
async function updateLoop() {
  await update();
  setTimeout(updateLoop, STATUS_INTERVAL_MS);
}

function clockLoop() {
  tick();
  setTimeout(clockLoop, CLOCK_INTERVAL_MS);
}

async function loadDevices() {
  const list = $("device-list");
  list.innerHTML = '<div class="searching">検索中…</div>';
  try {
    const data = await fetchJson("/api/casts");
    list.innerHTML = "";
    if (!data.devices.length) {
      list.innerHTML = '<div class="searching">機器が見つかりません</div>';
      return;
    }
    data.devices.forEach(name => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "device-choice";
      button.textContent = name;
      button.onclick = () => selectDevice(name);
      list.appendChild(button);
    });
  } catch (error) {
    list.innerHTML = `<div class="searching">${error.message}</div>`;
  }
}

async function selectDevice(name) {
  try {
    await fetchJson("/api/cast", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({name}),
    });
    $("device-name").textContent = name;
    $("device-dialog").classList.add("hidden");
    update();
  } catch (error) {
    $("device-list").innerHTML = `<div class="searching">${error.message}</div>`;
  }
}

$("device-button").onclick = () => {
  $("device-dialog").classList.remove("hidden");
  loadDevices();
};
$("close-dialog").onclick = () => $("device-dialog").classList.add("hidden");
$("rescan").onclick = loadDevices;

// Refresh immediately when the page becomes active again.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    tick();
    update();
  }
});
window.addEventListener("focus", () => {
  tick();
  update();
});
window.addEventListener("pageshow", () => {
  tick();
  update();
});

clockLoop();
updateLoop();
