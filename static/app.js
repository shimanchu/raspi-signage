const $ = (id) => document.getElementById(id);

const STATUS_INTERVAL_MS = 5000;
const CLOCK_INTERVAL_MS = 1000;
const FETCH_TIMEOUT_MS = 10000;

function weatherIcon(code) {
  if (code === 0) return 'clear.svg';
  if (code >= 1 && code <= 2) return 'partly-cloudy.svg';
  if (code === 3) return 'cloudy.svg';
  if (code === 45 || code === 48) return 'fog.svg';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain.svg';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow.svg';
  if (code >= 95) return 'thunder.svg';
  return 'cloudy.svg';
}

function setWeatherIcon(id, code) {
  $(id).src = `/static/weather/${weatherIcon(code)}`;
}

function tick() {
  const d = new Date();
  $('clock').textContent = d.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });
  $('mini-time').textContent = $('clock').textContent;
  $('date').textContent = d.toLocaleDateString('ja-JP', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `${response.status} ${response.statusText}`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function update() {
  try {
    const status = await fetchJson('/api/status');
    const weather = status.weather || {};

    $('device-name').textContent = status.selected_cast || '未選択';

    setWeatherIcon('weather-icon', weather.code);
    setWeatherIcon('mini-weather-icon', weather.code);

    $('temperature').textContent =
      weather.temperature == null ? '--℃' : `${Math.round(weather.temperature)}℃`;
    $('rain').textContent = `降水 ${weather.precipitation ?? '--'}%`;
    $('mini-weather-text').textContent =
      `${weather.temperature == null ? '--' : Math.round(weather.temperature)}℃  ` +
      `降水 ${weather.precipitation ?? '--'}%`;

    const playing = Boolean(status.cast && status.cast.playing);
    $('clock-screen').classList.toggle('hidden', playing);
    $('music-screen').classList.toggle('hidden', !playing);

    if (playing) {
      $('title').textContent = status.cast.title || 'タイトル不明';
      $('artist').textContent = status.cast.artist || 'アーティスト不明';
      $('album').textContent = status.cast.album || '';

      if (status.cast.image) {
        $('cover').src = status.cast.image;
      }
    }
  } catch (error) {
    console.warn('Status update failed:', error);
  }
}

async function updateLoop() {
  await update();
  setTimeout(updateLoop, STATUS_INTERVAL_MS);
}

function clockLoop() {
  tick();
  setTimeout(clockLoop, CLOCK_INTERVAL_MS);
}

async function loadDevices() {
  const list = $('device-list');
  list.innerHTML = '<div class="searching">検索中…</div>';

  try {
    const data = await fetchJson('/api/casts');
    list.innerHTML = '';

    if (!data.devices.length) {
      list.innerHTML = '<div class="searching">機器が見つかりません</div>';
      return;
    }

    data.devices.forEach((name) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'device-choice';
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
    await fetchJson('/api/cast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });

    $('device-name').textContent = name;
    $('device-dialog').classList.add('hidden');
    update();
  } catch (error) {
    $('device-list').innerHTML = `<div class="searching">${error.message}</div>`;
  }
}

$('device-button').onclick = () => {
  $('device-dialog').classList.remove('hidden');
  loadDevices();
};

$('close-dialog').onclick = () => $('device-dialog').classList.add('hidden');
$('rescan').onclick = loadDevices;

function startWaveVisualizer() {
  const canvas = $('wave');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = 444;
  canvas.height = 82;

  let phase = 0;
  let amplitude = 0;

  function layer(freq, speed, scale, offset, color, lineWidth, alpha) {
    const width = canvas.width;
    const height = canvas.height;
    const center = height / 2;

    ctx.beginPath();

    for (let x = 0; x <= width; x += 2) {
      const progress = x / width;
      const envelope = Math.sin(progress * Math.PI);
      const a = Math.sin(progress * Math.PI * 2 * freq + phase * speed + offset);
      const b = Math.sin(progress * Math.PI * 2 * freq * 0.53 - phase * speed * 0.58 + offset);
      const y = center + (a * 0.76 + b * 0.24) * amplitude * scale * envelope;

      if (x === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const playing = !$('music-screen').classList.contains('hidden');
    const targetAmplitude = playing ? 25 : 0;

    amplitude += (targetAmplitude - amplitude) * 0.045;
    phase += playing ? 0.04 : 0.01;

    ctx.save();
    ctx.shadowBlur = 9;

    ctx.shadowColor = '#35d9ff';
    layer(1.7, 1.0, 0.78, 0, '#43e7ff', 2.5, 0.92);

    ctx.shadowColor = '#8b65ff';
    layer(2.35, -0.72, 0.58, 1.7, '#9b70ff', 1.8, 0.66);

    ctx.shadowColor = '#397dff';
    layer(3.05, 0.54, 0.4, 3.2, '#438cff', 1.2, 0.42);

    ctx.restore();
    ctx.globalAlpha = 1;

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    tick();
    update();
  }
});

window.addEventListener('focus', () => {
  tick();
  update();
});

window.addEventListener('pageshow', () => {
  tick();
  update();
});

startWaveVisualizer();
clockLoop();
updateLoop();
