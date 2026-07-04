const form = document.getElementById('search-form');
const input = document.getElementById('city-input');
const submitBtn = form.querySelector('button[type="submit"]');
const resultsEl = document.getElementById('weather-results');
const unitBtns = document.querySelectorAll('.unit-btn');

let unit = localStorage.getItem('unit') || 'C';
let lastWeatherData = null;

const DEFAULT_CITIES = [
  { name: 'Austin',       country: 'US' },
  { name: 'Montevideo',   country: 'UY' },
  { name: 'Buenos Aires', country: 'AR' },
];
let recentSearches = JSON.parse(localStorage.getItem('recentSearches') || '[]');

// ── Dynamic background ────────────────────────────────────────────────────────

const bgEl     = document.getElementById('weather-bg');
const bgNextEl = document.getElementById('weather-bg-next');
const bgCanvas = document.getElementById('bg-canvas');
const bgCtx    = bgCanvas.getContext('2d');
const flashEl  = document.getElementById('lightning-flash');

let bgRafId       = null;
let bgFlashTimer  = null;
let bgXfadeTimer  = null;
let bgParticles   = [];
let currentBgType = null;

const BG_THEMES = {
  sunny: {
    bg:        'linear-gradient(180deg, #38bdf8 0%, #7dd3fc 35%, #bae6fd 65%, #fef3c7 90%, #fffbeb 100%)',
    particles: null,
  },
  partly: {
    bg:        'linear-gradient(180deg, #60a5fa 0%, #93c5fd 30%, #bfdbfe 65%, #eff6ff 100%)',
    particles: null,
  },
  cloudy: {
    bg:        'linear-gradient(180deg, #475569 0%, #64748b 35%, #94a3b8 65%, #cbd5e1 100%)',
    particles: null,
  },
  fog: {
    bg:        'linear-gradient(180deg, #94a3b8 0%, #b8c8d4 30%, #d4dfe8 60%, #edf2f7 100%)',
    particles: 'fog',
  },
  drizzle: {
    bg:        'linear-gradient(180deg, #334155 0%, #475569 40%, #64748b 70%, #94a3b8 100%)',
    particles: 'drizzle',
  },
  rain: {
    bg:        'linear-gradient(180deg, #0f172a 0%, #1e293b 35%, #334155 65%, #475569 100%)',
    particles: 'rain',
  },
  snow: {
    bg:        'linear-gradient(180deg, #bfdbfe 0%, #dbeafe 30%, #e0f2fe 60%, #f0f9ff 100%)',
    particles: 'snow',
  },
  thunder: {
    bg:        'linear-gradient(180deg, #020617 0%, #0f172a 35%, #1e293b 65%, #334155 100%)',
    particles: 'thunder',
  },
};

// Decide light/dark header text from the gradient's own first color stop,
// rather than a hand-maintained flag that can drift out of sync with the
// actual colors (the root cause of low-contrast header text bugs).
function isDarkGradient(gradientCss) {
  const match = gradientCss.match(/#([0-9a-fA-F]{6})/);
  if (!match) return false;
  const hex = match[1];
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance < 0.2;
}

// Resize canvas to fill viewport
function resizeBgCanvas() {
  bgCanvas.width  = window.innerWidth;
  bgCanvas.height = window.innerHeight;
}
resizeBgCanvas();
window.addEventListener('resize', () => {
  resizeBgCanvas();
  if (currentBgType && BG_THEMES[currentBgType]?.particles) {
    bgParticles = spawnBgParticles(BG_THEMES[currentBgType].particles, true);
  }
});

// Crossfade between two gradient backgrounds
function crossfadeBg(grad) {
  clearTimeout(bgXfadeTimer);
  bgNextEl.style.transition = 'none';
  bgNextEl.style.opacity    = '0';
  bgNextEl.style.background = grad;
  bgNextEl.offsetHeight;                        // force reflow
  bgNextEl.style.transition = 'opacity 0.9s ease';
  bgNextEl.style.opacity    = '1';
  bgXfadeTimer = setTimeout(() => {
    bgEl.style.background     = grad;
    bgNextEl.style.transition = 'none';
    bgNextEl.style.opacity    = '0';
  }, 950);
}

// Create one particle of the given type
function makeBgParticle(type, W, H, randomY) {
  if (type === 'snow') {
    return {
      kind:   'snow',
      x:      Math.random() * W,
      y:      randomY ? Math.random() * H : -6,
      r:      1.5 + Math.random() * 3,
      vy:     0.5 + Math.random() * 1.5,
      drift:  (Math.random() - 0.5) * 0.5,
      wobble: Math.random() * Math.PI * 2,
      ws:     0.012 + Math.random() * 0.018,
      a:      0.4 + Math.random() * 0.55,
    };
  }
  if (type === 'fog') {
    return {
      kind: 'fog',
      x:    Math.random() * W,
      y:    H * 0.05 + Math.random() * H * 0.78,
      w:    W * 0.25 + Math.random() * W * 0.5,
      h:    50 + Math.random() * 110,
      vx:   (Math.random() > 0.5 ? 1 : -1) * (0.08 + Math.random() * 0.22),
      a:    0.025 + Math.random() * 0.055,
    };
  }
  // rain / drizzle / thunder streaks
  return {
    kind: type,
    x:    Math.random() * (W + 200) - 100,
    y:    randomY ? Math.random() * H : -50,
    vy:   type === 'drizzle' ?  5 + Math.random() * 4 : 12 + Math.random() * 8,
    len:  type === 'drizzle' ? 10 + Math.random() * 8 : 20 + Math.random() * 15,
    a:    type === 'drizzle' ? 0.12 + Math.random() * 0.18 : 0.18 + Math.random() * 0.28,
  };
}

// Spawn a full batch of particles
function spawnBgParticles(type, randomY = false) {
  const W = bgCanvas.width, H = bgCanvas.height;
  const n = {
    drizzle: Math.min(120, Math.floor(W / 14)),
    rain:    Math.min(350, Math.floor(W /  5)),
    thunder: Math.min(450, Math.floor(W /  4)),
    snow:    Math.min(200, Math.floor(W /  9)),
    fog:     14,
  }[type] ?? 80;
  return Array.from({ length: n }, () => makeBgParticle(type, W, H, randomY));
}

// RAF render loop
function animateBg() {
  const W = bgCanvas.width, H = bgCanvas.height;
  bgCtx.clearRect(0, 0, W, H);

  bgParticles.forEach((p, i) => {
    if (p.kind === 'snow') {
      p.wobble += p.ws;
      p.x += p.drift + Math.sin(p.wobble) * 0.4;
      p.y += p.vy;
      if (p.y > H + p.r) { bgParticles[i] = makeBgParticle('snow', W, H, false); return; }
      if (p.x < -p.r)    p.x = W + p.r;
      if (p.x > W + p.r) p.x = -p.r;
      bgCtx.save();
      bgCtx.globalAlpha = p.a;
      bgCtx.fillStyle   = 'rgba(255,255,255,0.92)';
      bgCtx.beginPath();
      bgCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      bgCtx.fill();
      bgCtx.restore();

    } else if (p.kind === 'fog') {
      p.x += p.vx;
      if (p.x >  W + p.w / 2) p.x = -p.w / 2;
      if (p.x < -p.w / 2)     p.x =  W + p.w / 2;
      const grd = bgCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.w / 2);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      bgCtx.save();
      bgCtx.globalAlpha = p.a;
      bgCtx.fillStyle   = grd;
      bgCtx.beginPath();
      bgCtx.ellipse(p.x, p.y, p.w / 2, p.h / 2, 0, 0, Math.PI * 2);
      bgCtx.fill();
      bgCtx.restore();

    } else {
      // Rain / drizzle / thunder streak
      const lean = 0.22;
      p.x += lean * p.vy * 0.1;
      p.y += p.vy;
      if (p.y - p.len > H) { bgParticles[i] = makeBgParticle(p.kind, W, H, false); return; }
      bgCtx.save();
      bgCtx.globalAlpha = p.a;
      bgCtx.strokeStyle = p.kind === 'drizzle'
        ? 'rgba(186,230,253,0.85)'
        : 'rgba(147,197,253,0.95)';
      bgCtx.lineWidth = p.kind === 'drizzle' ? 0.8 : 1.2;
      bgCtx.lineCap   = 'round';
      bgCtx.beginPath();
      bgCtx.moveTo(p.x, p.y);
      bgCtx.lineTo(p.x + lean * p.len, p.y + p.len);
      bgCtx.stroke();
      bgCtx.restore();
    }
  });

  bgRafId = requestAnimationFrame(animateBg);
}

// Schedule a random lightning flash for thunder
function scheduleLightning() {
  bgFlashTimer = setTimeout(() => {
    if (currentBgType !== 'thunder') return;
    flashEl.classList.remove('flash');
    void flashEl.offsetWidth; // force reflow so animation restarts
    flashEl.classList.add('flash');
    scheduleLightning();
  }, 3500 + Math.random() * 7000);
}

// Main entry: call this whenever weather type changes
function updateBackground(type) {
  if (type === currentBgType) return;
  currentBgType = type;

  const theme = BG_THEMES[type] ?? BG_THEMES.partly;

  crossfadeBg(theme.bg);
  document.body.classList.toggle('bg-dark', isDarkGradient(theme.bg));

  // Tear down old particles / lightning
  if (bgRafId) { cancelAnimationFrame(bgRafId); bgRafId = null; }
  clearTimeout(bgFlashTimer);
  bgParticles = [];
  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);

  if (theme.particles) {
    bgParticles = spawnBgParticles(theme.particles, true);
    bgRafId     = requestAnimationFrame(animateBg);
    if (theme.particles === 'thunder') scheduleLightning();
  }
}

// Apply saved preference on load
setUnit(unit);
showPlaceholder();
input.focus();

document.getElementById('home-btn').addEventListener('click', resetToHome);

unitBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    setUnit(btn.dataset.unit);
    if (lastWeatherData) showWeather(lastWeatherData);
  });
});

function setUnit(u) {
  unit = u;
  localStorage.setItem('unit', u);
  unitBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.unit === u));
}

function toDisplay(celsius) {
  if (unit === 'F') return Math.round(celsius * 9 / 5 + 32);
  return Math.round(celsius);
}

function unitLabel() {
  return unit === 'F' ? '°F' : '°C';
}

const WMO = {
  0:  { label: 'Clear Sky',                    emoji: '☀️'  },
  1:  { label: 'Mainly Clear',                 emoji: '🌤️' },
  2:  { label: 'Partly Cloudy',                emoji: '⛅'  },
  3:  { label: 'Overcast',                     emoji: '☁️'  },
  45: { label: 'Fog',                          emoji: '🌫️' },
  48: { label: 'Freezing Fog',                 emoji: '🌫️' },
  51: { label: 'Light Drizzle',                emoji: '🌦️' },
  53: { label: 'Drizzle',                      emoji: '🌦️' },
  55: { label: 'Heavy Drizzle',                emoji: '🌧️' },
  56: { label: 'Light Freezing Drizzle',       emoji: '🌨️' },
  57: { label: 'Heavy Freezing Drizzle',       emoji: '🌨️' },
  61: { label: 'Light Rain',                   emoji: '🌧️' },
  63: { label: 'Rain',                         emoji: '🌧️' },
  65: { label: 'Heavy Rain',                   emoji: '🌧️' },
  66: { label: 'Light Freezing Rain',          emoji: '🌨️' },
  67: { label: 'Heavy Freezing Rain',          emoji: '🌨️' },
  71: { label: 'Light Snow',                   emoji: '🌨️' },
  73: { label: 'Snow',                         emoji: '❄️'  },
  75: { label: 'Heavy Snow',                   emoji: '❄️'  },
  77: { label: 'Snow Grains',                  emoji: '🌨️' },
  80: { label: 'Light Showers',                emoji: '🌦️' },
  81: { label: 'Showers',                      emoji: '🌧️' },
  82: { label: 'Heavy Showers',                emoji: '⛈️'  },
  85: { label: 'Light Snow Showers',           emoji: '🌨️' },
  86: { label: 'Heavy Snow Showers',           emoji: '❄️'  },
  95: { label: 'Thunderstorm',                 emoji: '⛈️'  },
  96: { label: 'Thunderstorm with Hail',       emoji: '⛈️'  },
  99: { label: 'Thunderstorm with Heavy Hail', emoji: '⛈️'  },
};

function wmoCondition(code) {
  return WMO[code] ?? { label: 'Unknown', emoji: '🌡️' };
}

// ── Weather phrases ───────────────────────────────────────────────────────────

const PHRASES = {
  sunny: [
    "Fire up the BBQ 🍖",
    "Great day for padel 🎾",
    "Perfect weather for a hike ⛰️",
    "Get the tennis racket out 🎾",
    "Soccer weather. No excuses ⚽",
    "Ideal conditions for a bike ride 🚴",
    "Take the kayak out. Seriously 🛶",
    "Golf day. You know it ⛳",
    "Too nice to be staring at a screen",
    "The sun showed up. You should too",
    "Put on some sunscreen and go enjoy yourself",
    "No excuses — get outside",
    "Peak day for a long run 🏃",
    "Beach volleyball won't play itself 🏐",
    "Your body needs vitamin D, not vitamin C",
    "Open the windows, close the laptop",
  ],
  partly: [
    "Pretty decent out there actually",
    "Good enough for a coffee outside",
    "Take the sunglasses just in case",
    "Not complaining. Could be worse",
    "A solid 7/10 weather day",
    "Good hiking weather — overcast keeps you cool 🥾",
    "Tennis weather with a side of drama ☁️",
    "Grab a jacket, go for a run",
    "Park bench weather. Bring a book",
    "Still a padel day if you ask me 🎾",
    "Great for a long walk, questionable for a tan",
    "Could go either way. Dress in layers",
  ],
  cloudy: [
    "Grey but totally manageable",
    "Great weather for a long drive",
    "Ideal for an aimless walk",
    "Moody sky. Respect it",
    "Put on a coat and get on with it",
    "Perfect day for a museum visit",
    "Indoor climbing gym calling your name 🧗",
    "Great for a run — no sun to kill you",
    "Yoga on the porch. Low-key iconic",
    "Good day for deep thoughts and darker coffee",
    "Atmospheric. Lean into it",
    "Not the day for sunglasses. Everything else is fine",
  ],
  fog: [
    "Mysterious vibes. Drive carefully 👻",
    "Leave extra early — visibility is rough",
    "Nature's mystery mode: activated",
    "The world has gone blurry",
    "Spooky. Drive slow",
    "Horror movie set outside. Stay calm",
    "Great visibility for zero things",
    "The mountains disappeared. Rude",
    "Even the fog doesn't know what it's doing",
    "Ideal weather for reading a thriller",
  ],
  drizzle: [
    "Barely counts as rain tbh",
    "Undeniably coffee weather ☕",
    "An umbrella wouldn't hurt",
    "Light drizzle, heavy vibes",
    "Not enough rain to cancel plans. Not enough sun to enjoy them",
    "The sky can't commit. Relatable",
    "Indoor padel exists for a reason 🎾",
    "Great excuse for a long lunch",
    "Gym day. Clearly",
    "Just annoying enough to ruin a haircut",
  ],
  rain: [
    "Weather is shit, sorry :S",
    "Solid excuse to cancel every plan",
    "Netflix called. It wants you back 🎬",
    "Good day to order delivery and disappear",
    "The sky said no to outdoor activities",
    "Embrace the couch. It was always going to be this",
    "Soccer is cancelled. Football is not on. Life is hard",
    "At least it's not a hike day 🥾",
    "Indoor pool exists. Just saying 🏊",
    "Board game weather. Someone find Catan",
    "The only run happening today is a bath",
    "Your plants are thriving. You are not",
    "Rain: 1 — Your plans: 0",
    "Call someone you've been postponing",
  ],
  snow: [
    "Build a snowman. You know you want to ⛄",
    "Hot chocolate. Now. Non-negotiable",
    "Bundle up or suffer the consequences",
    "Everything looks suspiciously clean outside",
    "If you have skis, today's your day 🎿",
    "Snowboard or snowman — pick one ❄️",
    "Ice skating > everything else today ⛸️",
    "Boots, coat, scarf. In that order",
    "The slope is calling 🏔️",
    "Snow day. Childhood rules apply",
    "Cancel everything. Build a fort",
    "Hot soup weather. No debate",
  ],
  thunder: [
    "Mother Nature is not okay right now",
    "The sky is throwing a full tantrum 🌩️",
    "Seriously, just stay inside",
    "Wildly unhinged weather today",
    "Skip the outdoor plans. All of them",
    "God's playing sound effects out there",
  ],
};

function weatherPhrase(code) {
  const type = WMO_ICON[code] ?? 'cloudy';
  const pool  = PHRASES[type] ?? PHRASES.cloudy;
  return pool[Math.floor(Math.random() * pool.length)];
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const city = input.value.trim();
  if (!city) {
    form.classList.add('form-shake');
    form.addEventListener('animationend', () => form.classList.remove('form-shake'), { once: true });
    if (!lastWeatherData) {
      resultsEl.innerHTML = `<p class="status-message">Type a city name above to see the weather.</p>`;
    }
    input.focus();
    return;
  }
  await search(city);
});

// ── Autocomplete ─────────────────────────────────────────────────────────────

const autocompleteList = document.getElementById('autocomplete-list');
let acResults = [];
let acActiveIndex = -1;
let acTimer = null;

function closeAutocomplete() {
  autocompleteList.hidden = true;
  autocompleteList.innerHTML = '';
  acResults = [];
  acActiveIndex = -1;
}

function setAcActive(index) {
  autocompleteList.querySelectorAll('.autocomplete-item').forEach((el, i) => {
    el.setAttribute('aria-selected', i === index ? 'true' : 'false');
  });
  acActiveIndex = index;
}

function renderAutocomplete(results) {
  if (!results.length) { closeAutocomplete(); return; }
  acResults = results;
  acActiveIndex = -1;
  const pin = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  autocompleteList.innerHTML = results.map((r, i) => {
    const sub = [r.admin1, r.country_code].filter(Boolean).join(', ');
    return `<li class="autocomplete-item" role="option" aria-selected="false" data-index="${i}">
      ${pin}<span class="ac-name">${r.name}</span>${sub ? `<span class="ac-sub">${sub}</span>` : ''}
    </li>`;
  }).join('');
  autocompleteList.hidden = false;

  autocompleteList.querySelectorAll('.autocomplete-item').forEach(el => {
    el.addEventListener('mousedown', e => {
      e.preventDefault();
      selectSuggestion(acResults[+el.dataset.index]);
    });
  });
}

function selectSuggestion(result) {
  input.value = result.name;
  closeAutocomplete();
  search(result.name);
}

input.addEventListener('input', () => {
  clearTimeout(acTimer);
  const q = input.value.trim();
  if (q.length < 2) { closeAutocomplete(); return; }
  acTimer = setTimeout(async () => {
    try {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`
      );
      const data = await res.json();
      if (input.value.trim() === q) renderAutocomplete(data.results || []);
    } catch { /* network error — stay silent */ }
  }, 250);
});

input.addEventListener('keydown', e => {
  if (autocompleteList.hidden) return;
  const items = autocompleteList.querySelectorAll('.autocomplete-item');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setAcActive(Math.min(acActiveIndex + 1, items.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setAcActive(Math.max(acActiveIndex - 1, -1));
  } else if (e.key === 'Enter' && acActiveIndex >= 0) {
    e.preventDefault();
    selectSuggestion(acResults[acActiveIndex]);
  } else if (e.key === 'Escape') {
    closeAutocomplete();
  }
});

input.addEventListener('blur', () => setTimeout(closeAutocomplete, 150));

document.addEventListener('click', e => {
  if (!e.target.closest('search')) closeAutocomplete();
});

// ─────────────────────────────────────────────────────────────────────────────

async function search(city) {
  showLoading();
  submitBtn.disabled = true;

  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
    );
    const geoData = await geoRes.json();

    if (!geoData.results?.length) {
      showError('City not found. Try a different name.');
      return;
    }

    const { latitude, longitude, name, country } = geoData.results[0];

    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current_weather=true` +
      `&hourly=temperature_2m,weathercode,precipitation_probability,relative_humidity_2m` +
      `&daily=temperature_2m_max,temperature_2m_min,weathercode` +
      `&timezone=auto&forecast_days=5`
    );
    const weatherData = await weatherRes.json();
    const { temperature, weathercode, windspeed, winddirection, time: currentTime } = weatherData.current_weather;

    showWeather({ name, country, temperature, weathercode, windspeed, winddirection, daily: weatherData.daily, hourly: weatherData.hourly, currentTime });
  } catch {
    showError(
      navigator.onLine
        ? 'Something went wrong. Please try again.'
        : 'No internet connection. Check your network and try again.',
      true
    );
  } finally {
    submitBtn.disabled = false;
  }
}

function skeletonForecastCard() {
  return `
    <article class="forecast-card">
      <div class="skeleton skel-day"></div>
      <div class="skeleton skel-ficon"></div>
      <div class="skeleton skel-ftemp"></div>
    </article>`;
}

function showLoading() {
  lastWeatherData = null;
  resultsEl.innerHTML = `
    <article class="weather-card">
      <div class="skeleton skel-city"></div>
      <div class="skeleton skel-icon"></div>
      <div class="skeleton skel-temp"></div>
      <div class="skeleton skel-desc"></div>
    </article>
    <section class="forecast" aria-label="5-day forecast">
      ${Array.from({ length: 5 }, skeletonForecastCard).join('')}
    </section>
  `;
}

function showError(message, canRetry = false) {
  resultsEl.innerHTML = `
    <div class="error-state">
      <p class="status-message error">${message}</p>
      ${canRetry ? `<button class="retry-btn">Try again</button>` : ''}
    </div>`;
  if (canRetry) {
    resultsEl.querySelector('.retry-btn').addEventListener('click', () => {
      const city = input.value.trim();
      if (city) search(city);
    });
  }
}

// ── SVG Icon System ───────────────────────────────────────────────────────────

const WMO_ICON = {
  0: 'sunny',  1: 'sunny',
  2: 'partly', 3: 'cloudy',
  45: 'fog',   48: 'fog',
  51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
  56: 'drizzle', 57: 'drizzle',
  61: 'rain',  63: 'rain',  65: 'rain',
  66: 'rain',  67: 'rain',
  71: 'snow',  73: 'snow',  75: 'snow',  77: 'snow',
  80: 'rain',  81: 'rain',  82: 'rain',
  85: 'snow',  86: 'snow',
  95: 'thunder', 96: 'thunder', 99: 'thunder',
};

const SVG_ICONS = {
  sunny: `
    <svg class="wi" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g class="wi-rays">
        <line x1="32" y1="4"  x2="32" y2="13" stroke="#fbbf24" stroke-width="3" stroke-linecap="round"/>
        <line x1="32" y1="4"  x2="32" y2="13" stroke="#fbbf24" stroke-width="3" stroke-linecap="round" transform="rotate(45 32 32)"/>
        <line x1="32" y1="4"  x2="32" y2="13" stroke="#fbbf24" stroke-width="3" stroke-linecap="round" transform="rotate(90 32 32)"/>
        <line x1="32" y1="4"  x2="32" y2="13" stroke="#fbbf24" stroke-width="3" stroke-linecap="round" transform="rotate(135 32 32)"/>
        <line x1="32" y1="4"  x2="32" y2="13" stroke="#fbbf24" stroke-width="3" stroke-linecap="round" transform="rotate(180 32 32)"/>
        <line x1="32" y1="4"  x2="32" y2="13" stroke="#fbbf24" stroke-width="3" stroke-linecap="round" transform="rotate(225 32 32)"/>
        <line x1="32" y1="4"  x2="32" y2="13" stroke="#fbbf24" stroke-width="3" stroke-linecap="round" transform="rotate(270 32 32)"/>
        <line x1="32" y1="4"  x2="32" y2="13" stroke="#fbbf24" stroke-width="3" stroke-linecap="round" transform="rotate(315 32 32)"/>
      </g>
      <circle cx="32" cy="32" r="13" fill="#fbbf24"/>
    </svg>`,

  partly: `
    <svg class="wi" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g class="wi-rays-sm">
        <line x1="20" y1="7"  x2="20" y2="14" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="20" y1="7"  x2="20" y2="14" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" transform="rotate(45 20 22)"/>
        <line x1="20" y1="7"  x2="20" y2="14" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" transform="rotate(90 20 22)"/>
        <line x1="20" y1="7"  x2="20" y2="14" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" transform="rotate(135 20 22)"/>
        <line x1="20" y1="7"  x2="20" y2="14" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" transform="rotate(180 20 22)"/>
        <line x1="20" y1="7"  x2="20" y2="14" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" transform="rotate(225 20 22)"/>
        <line x1="20" y1="7"  x2="20" y2="14" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" transform="rotate(270 20 22)"/>
        <line x1="20" y1="7"  x2="20" y2="14" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round" transform="rotate(315 20 22)"/>
      </g>
      <circle cx="20" cy="22" r="11" fill="#fbbf24"/>
      <circle cx="26" cy="40" r="10" fill="#94a3b8"/>
      <circle cx="38" cy="32" r="13" fill="#94a3b8"/>
      <circle cx="50" cy="40" r="10" fill="#94a3b8"/>
      <rect x="16" y="40" width="44" height="11" fill="#94a3b8"/>
    </svg>`,

  cloudy: `
    <svg class="wi" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g class="wi-cloud">
        <circle cx="22" cy="36" r="11" fill="#94a3b8"/>
        <circle cx="34" cy="26" r="15" fill="#94a3b8"/>
        <circle cx="46" cy="36" r="12" fill="#94a3b8"/>
        <rect x="11" y="36" width="47" height="13" fill="#94a3b8"/>
      </g>
    </svg>`,

  fog: `
    <svg class="wi" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g class="wi-fog">
        <line x1="8"  y1="18" x2="56" y2="18" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/>
        <line x1="12" y1="28" x2="52" y2="28" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/>
        <line x1="8"  y1="38" x2="56" y2="38" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/>
        <line x1="14" y1="48" x2="50" y2="48" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/>
      </g>
    </svg>`,

  drizzle: `
    <svg class="wi" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="22" cy="28" r="10" fill="#94a3b8"/>
      <circle cx="34" cy="20" r="13" fill="#94a3b8"/>
      <circle cx="46" cy="28" r="10" fill="#94a3b8"/>
      <rect x="12" y="28" width="42" height="10" fill="#94a3b8"/>
      <line class="wi-drop wi-drop-1" x1="24" y1="44" x2="22" y2="54" stroke="#93c5fd" stroke-width="2" stroke-linecap="round"/>
      <line class="wi-drop wi-drop-2" x1="33" y1="44" x2="31" y2="54" stroke="#93c5fd" stroke-width="2" stroke-linecap="round"/>
      <line class="wi-drop wi-drop-3" x1="42" y1="44" x2="40" y2="54" stroke="#93c5fd" stroke-width="2" stroke-linecap="round"/>
    </svg>`,

  rain: `
    <svg class="wi" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="22" cy="26" r="10" fill="#64748b"/>
      <circle cx="34" cy="18" r="13" fill="#64748b"/>
      <circle cx="46" cy="26" r="10" fill="#64748b"/>
      <rect x="12" y="26" width="42" height="10" fill="#64748b"/>
      <line class="wi-drop wi-drop-1" x1="20" y1="42" x2="17" y2="54" stroke="#60a5fa" stroke-width="2.5" stroke-linecap="round"/>
      <line class="wi-drop wi-drop-2" x1="30" y1="42" x2="27" y2="54" stroke="#60a5fa" stroke-width="2.5" stroke-linecap="round"/>
      <line class="wi-drop wi-drop-3" x1="40" y1="42" x2="37" y2="54" stroke="#60a5fa" stroke-width="2.5" stroke-linecap="round"/>
      <line class="wi-drop wi-drop-4" x1="50" y1="42" x2="47" y2="54" stroke="#60a5fa" stroke-width="2.5" stroke-linecap="round"/>
    </svg>`,

  snow: `
    <svg class="wi" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="22" cy="26" r="10" fill="#94a3b8"/>
      <circle cx="34" cy="18" r="13" fill="#94a3b8"/>
      <circle cx="46" cy="26" r="10" fill="#94a3b8"/>
      <rect x="12" y="26" width="42" height="10" fill="#94a3b8"/>
      <g class="wi-flake wi-flake-1">
        <line x1="20" y1="41" x2="20" y2="51" stroke="#93c5fd" stroke-width="2"   stroke-linecap="round"/>
        <line x1="15" y1="46" x2="25" y2="46" stroke="#93c5fd" stroke-width="2"   stroke-linecap="round"/>
        <line x1="16.5" y1="42.5" x2="23.5" y2="49.5" stroke="#93c5fd" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="23.5" y1="42.5" x2="16.5" y2="49.5" stroke="#93c5fd" stroke-width="1.5" stroke-linecap="round"/>
      </g>
      <g class="wi-flake wi-flake-2">
        <line x1="32" y1="41" x2="32" y2="51" stroke="#93c5fd" stroke-width="2"   stroke-linecap="round"/>
        <line x1="27" y1="46" x2="37" y2="46" stroke="#93c5fd" stroke-width="2"   stroke-linecap="round"/>
        <line x1="28.5" y1="42.5" x2="35.5" y2="49.5" stroke="#93c5fd" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="35.5" y1="42.5" x2="28.5" y2="49.5" stroke="#93c5fd" stroke-width="1.5" stroke-linecap="round"/>
      </g>
      <g class="wi-flake wi-flake-3">
        <line x1="44" y1="41" x2="44" y2="51" stroke="#93c5fd" stroke-width="2"   stroke-linecap="round"/>
        <line x1="39" y1="46" x2="49" y2="46" stroke="#93c5fd" stroke-width="2"   stroke-linecap="round"/>
        <line x1="40.5" y1="42.5" x2="47.5" y2="49.5" stroke="#93c5fd" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="47.5" y1="42.5" x2="40.5" y2="49.5" stroke="#93c5fd" stroke-width="1.5" stroke-linecap="round"/>
      </g>
    </svg>`,

  thunder: `
    <svg class="wi" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="22" cy="24" r="10" fill="#475569"/>
      <circle cx="34" cy="16" r="13" fill="#475569"/>
      <circle cx="46" cy="24" r="10" fill="#475569"/>
      <rect x="12" y="24" width="42" height="10" fill="#475569"/>
      <polyline class="wi-bolt" points="36,34 28,48 35,48 26,60"
                fill="none" stroke="#fbbf24" stroke-width="3"
                stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
};

function makeIcon(code) {
  return SVG_ICONS[WMO_ICON[code] ?? 'cloudy'] ?? SVG_ICONS.cloudy;
}

// ── Temperature chart ────────────────────────────────────────────────────────

function curvePath(pts) {
  const T = 0.3; // Catmull-Rom tension
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[Math.max(i - 2, 0)];
    const p1 = pts[i - 1];
    const p2 = pts[i];
    const p3 = pts[Math.min(i + 1, pts.length - 1)];
    const cp1x = (p1[0] + (p2[0] - p0[0]) * T).toFixed(1);
    const cp1y = (p1[1] + (p2[1] - p0[1]) * T).toFixed(1);
    const cp2x = (p2[0] - (p3[0] - p1[0]) * T).toFixed(1);
    const cp2y = (p2[1] - (p3[1] - p1[1]) * T).toFixed(1);
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function buildChart(daily, days) {
  const W = 600, H = 180;
  const pad = { top: 18, right: 18, bottom: 32, left: 38 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const n = days.length;

  const highs = daily.temperature_2m_max.slice(0, n).map(toDisplay);
  const lows  = daily.temperature_2m_min.slice(0, n).map(toDisplay);

  const tMin = Math.min(...lows)  - 3;
  const tMax = Math.max(...highs) + 3;

  const xOf = i => pad.left + (i / (n - 1)) * plotW;
  const yOf = t => pad.top  + (1 - (t - tMin) / (tMax - tMin)) * plotH;

  const highPts = highs.map((t, i) => [xOf(i), yOf(t)]);
  const lowPts  = lows.map( (t, i) => [xOf(i), yOf(t)]);

  // Grid lines — ~4 evenly spaced horizontal rules
  const range = tMax - tMin;
  const step  = Math.max(5, Math.round(range / 4 / 5) * 5);
  let gridSvg = '';
  for (let t = Math.ceil(tMin / step) * step; t <= tMax; t += step) {
    const y = yOf(t).toFixed(1);
    gridSvg += `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="#f1f5f9" stroke-width="1"/>`;
    gridSvg += `<text x="${pad.left - 5}" y="${(+y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#64748b">${t}°</text>`;
  }

  // Dots
  const dots = (pts, fill) => pts.map(([x, y]) =>
    `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${fill}" stroke="white" stroke-width="2"/>`
  ).join('');

  // Day labels
  const labelsSvg = days.map((d, i) =>
    `<text x="${xOf(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="#64748b">${d}</text>`
  ).join('');

  // Invisible hit-areas (one vertical band per day)
  const hitsSvg = days.map((d, i) => {
    const cx = xOf(i);
    const bw = plotW / (n - 1);
    const x1 = i === 0     ? pad.left      : cx - bw / 2;
    const x2 = i === n - 1 ? W - pad.right : cx + bw / 2;
    return `<rect class="chart-hit" data-i="${i}" x="${x1.toFixed(1)}" y="0" width="${(x2 - x1).toFixed(1)}" height="${H}" fill="transparent"/>`;
  }).join('');

  const svgHtml = `
    <svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="tip-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.08"/>
        </filter>
      </defs>
      <g>${gridSvg}</g>
      <path d="${curvePath(lowPts)}"  fill="none" stroke="#cbd5e1" stroke-width="2"   stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${curvePath(highPts)}" fill="none" stroke="#db2777" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <g>${dots(lowPts,  '#cbd5e1')}</g>
      <g>${dots(highPts, '#db2777')}</g>
      <g>${labelsSvg}</g>
      <line class="chart-crosshair"
            x1="0" y1="${pad.top}" x2="0" y2="${pad.top + plotH}"
            stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>
      <g class="chart-tip" visibility="hidden">
        <rect class="tip-bg" rx="7" fill="white" filter="url(#tip-shadow)"/>
        <text class="tip-day"  font-size="10"                  fill="#64748b"/>
        <text class="tip-high" font-size="13" font-weight="700" fill="#be185d"/>
        <text class="tip-low"  font-size="12"                  fill="#64748b"/>
      </g>
      <g>${hitsSvg}</g>
    </svg>`;

  return { svgHtml, highPts, lowPts, highs, lows, xOf, pad, W, plotH };
}

function wireChartHover({ highPts, lowPts, highs, lows, xOf, pad, W, plotH }, days) {
  const svg = resultsEl.querySelector('.chart-svg');
  if (!svg) return;

  const crosshair = svg.querySelector('.chart-crosshair');
  const tipGroup  = svg.querySelector('.chart-tip');
  const tipBg     = svg.querySelector('.tip-bg');
  const tipDay    = svg.querySelector('.tip-day');
  const tipHigh   = svg.querySelector('.tip-high');
  const tipLow    = svg.querySelector('.tip-low');

  const TIP_W = 84, TIP_H = 56;

  const hide = () => {
    crosshair.setAttribute('visibility', 'hidden');
    tipGroup.setAttribute('visibility', 'hidden');
  };

  svg.querySelectorAll('.chart-hit').forEach(rect => {
    rect.addEventListener('mouseenter', () => {
      const i  = +rect.dataset.i;
      const x  = xOf(i);

      // Crosshair
      crosshair.setAttribute('x1', x.toFixed(1));
      crosshair.setAttribute('x2', x.toFixed(1));
      crosshair.setAttribute('y2', (pad.top + plotH).toFixed(1));
      crosshair.setAttribute('visibility', 'visible');

      // Content
      tipDay.textContent  = days[i];
      tipHigh.textContent = `↑ ${highs[i]}${unitLabel()}`;
      tipLow.textContent  = `↓ ${lows[i]}${unitLabel()}`;

      // Position: flip left when near the right edge
      const tipX = x + 10 + TIP_W > W - pad.right ? x - TIP_W - 10 : x + 10;
      const tipY = Math.max(pad.top, highPts[i][1] - TIP_H - 8);

      tipBg.setAttribute('x',      tipX.toFixed(1));
      tipBg.setAttribute('y',      tipY.toFixed(1));
      tipBg.setAttribute('width',  TIP_W);
      tipBg.setAttribute('height', TIP_H);

      tipDay.setAttribute('x',  (tipX + 10).toFixed(1));
      tipDay.setAttribute('y',  (tipY + 15).toFixed(1));
      tipHigh.setAttribute('x', (tipX + 10).toFixed(1));
      tipHigh.setAttribute('y', (tipY + 32).toFixed(1));
      tipLow.setAttribute('x',  (tipX + 10).toFixed(1));
      tipLow.setAttribute('y',  (tipY + 48).toFixed(1));

      tipGroup.setAttribute('visibility', 'visible');
    });

    rect.addEventListener('mouseleave', hide);
  });

  svg.addEventListener('mouseleave', hide);
}

// ─────────────────────────────────────────────────────────────────────────────

function resetToHome() {
  lastWeatherData = null;
  input.value = '';

  // Stop particles and fade back to the default sky gradient
  if (bgRafId) { cancelAnimationFrame(bgRafId); bgRafId = null; }
  clearTimeout(bgFlashTimer);
  bgParticles = [];
  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  currentBgType = null;
  const idleBg =
    'radial-gradient(ellipse 60% 46% at 82% 46%, rgba(236, 72, 153, 0.24), transparent 72%), ' +
    'radial-gradient(ellipse 55% 42% at 8% 78%, rgba(99, 102, 241, 0.20), transparent 72%), ' +
    '#fafbfc';
  crossfadeBg(idleBg);
  document.body.classList.toggle('bg-dark', isDarkGradient(idleBg));

  showPlaceholder();
  input.focus();
}

function saveRecentSearch(name, country) {
  recentSearches = [
    { name, country },
    ...recentSearches.filter(s => s.name.toLowerCase() !== name.toLowerCase()),
  ].slice(0, 3);
  localStorage.setItem('recentSearches', JSON.stringify(recentSearches));
}

function recentCardHTML({ name, country }) {
  const pin = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  return `
    <button class="recent-card" data-city="${name}">
      ${pin}
      <span class="rc-name">${name}</span>
      <span class="rc-country">${country}</span>
    </button>`;
}

function showPlaceholder() {
  const cities = recentSearches.length > 0 ? recentSearches : DEFAULT_CITIES;
  const label  = recentSearches.length > 0 ? 'Recent searches' : 'Explore cities';

  resultsEl.innerHTML = `
    <div class="recent-searches">
      <p class="recent-label">${label}</p>
      <div class="recent-cards">
        ${cities.map(recentCardHTML).join('')}
      </div>
    </div>`;

  resultsEl.querySelectorAll('.recent-card').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.city;
      search(btn.dataset.city);
    });
  });
}

function windDirLabel(deg) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function dayName(dateStr) {
  // Parse as local date to avoid UTC-offset day shifts
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', { weekday: 'short' });
}

function formatHour(timeStr) {
  const h = parseInt(timeStr.split('T')[1], 10);
  return `${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`;
}

function buildHourlyStrip(hourly, currentTime) {
  // current_weather.time has minutes (e.g. "2026-07-04T07:15"); hourly slots are on the hour
  const currentHour = currentTime.slice(0, 13); // "2026-07-04T07"
  const start = Math.max(0, hourly.time.findIndex(t => t.startsWith(currentHour)));
  const end   = Math.min(hourly.time.length, start + 24);

  const cards = [];
  for (let i = start; i < end; i++) {
    const isNow  = i === start;
    const temp   = toDisplay(hourly.temperature_2m[i]);
    const code   = hourly.weathercode[i];
    const precip = hourly.precipitation_probability?.[i] ?? 0;
    const delay  = ((i - start) * 0.022).toFixed(3);

    cards.push(`
      <article class="hourly-card${isNow ? ' hourly-card--now' : ''}" style="animation-delay:${delay}s">
        <span class="hourly-time">${isNow ? 'Now' : formatHour(hourly.time[i])}</span>
        <div class="hourly-icon">${makeIcon(code)}</div>
        <span class="hourly-temp">${temp}°</span>
        <span class="hourly-precip">${precip >= 10 ? `${precip}%` : ''}</span>
      </article>`);
  }

  return `<section class="hourly" aria-label="Hourly forecast">${cards.join('')}</section>`;
}

function showWeather(data) {
  lastWeatherData = data;
  if (!data.phrase) data.phrase = weatherPhrase(data.weathercode);
  saveRecentSearch(data.name, data.country);
  updateBackground(WMO_ICON[data.weathercode] ?? 'cloudy');
  const { name, country, temperature, weathercode, windspeed, winddirection, daily, hourly, currentTime, phrase } = data;
  const { label } = wmoCondition(weathercode);

  const days = daily.time.map(dayName);

  const forecastCards = daily.time.map((dateStr, i) => {
    const high = toDisplay(daily.temperature_2m_max[i]);
    const low  = toDisplay(daily.temperature_2m_min[i]);
    return `
      <article class="forecast-card">
        <h3 class="forecast-day">${dayName(dateStr)}</h3>
        <div class="forecast-icon">${makeIcon(daily.weathercode[i])}</div>
        <p class="forecast-temps">
          <span class="high">${high}°</span>
          <span class="low">${low}°</span>
        </p>
      </article>`;
  }).join('');

  const chart       = buildChart(daily, days);
  const hourlyStrip = hourly ? buildHourlyStrip(hourly, currentTime) : '';

  const currentHour = currentTime ? currentTime.slice(0, 13) : null;
  const hourStart   = currentHour ? Math.max(0, hourly.time.findIndex(t => t.startsWith(currentHour))) : 0;
  const humidity    = hourly?.relative_humidity_2m?.[hourStart] ?? null;

  resultsEl.innerHTML = `
    <article class="weather-card">
      <h2 class="weather-city">${name}, ${country}</h2>
      <p class="weather-phrase">${phrase}</p>
      <div class="weather-icon">${makeIcon(weathercode)}</div>
      <p class="weather-temp">${toDisplay(temperature)}${unitLabel()}</p>
      <p class="weather-description">${label}</p>
      ${humidity !== null ? `<p class="weather-humidity"><svg width="12" height="12" viewBox="0 0 24 24" fill="#60a5fa" aria-hidden="true"><path d="M12 2C6 10 4 14 4 16a8 8 0 0 0 16 0c0-2-2-6-8-14z"/></svg>${humidity}% humidity</p>` : ''}
      <div class="wind-info">
        <svg class="wind-compass" viewBox="0 0 64 64" style="--wd:${winddirection}deg">
          <circle cx="32" cy="32" r="26" fill="none" stroke="#e2e8f0" stroke-width="1.5"/>
          <text x="32" y="11"  text-anchor="middle" font-size="7" font-weight="700" fill="#64748b">N</text>
          <text x="32" y="57"  text-anchor="middle" font-size="7" font-weight="700" fill="#64748b">S</text>
          <text x="56" y="35"  text-anchor="middle" font-size="7" font-weight="700" fill="#64748b">E</text>
          <text x="8"  y="35"  text-anchor="middle" font-size="7" font-weight="700" fill="#64748b">W</text>
          <g class="compass-needle">
            <polygon points="32,12 29,20 35,20" fill="#3b82f6"/>
            <line x1="32" y1="20" x2="32" y2="32" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round"/>
            <line x1="32" y1="32" x2="32" y2="50" stroke="#cbd5e1" stroke-width="2.5" stroke-linecap="round"/>
          </g>
          <circle cx="32" cy="32" r="3" fill="white" stroke="#cbd5e1" stroke-width="1.5"/>
        </svg>
        <div class="wind-details">
          <span class="wind-speed">${windspeed}<span class="wind-unit"> km/h</span></span>
          <span class="wind-dir-label">${windDirLabel(winddirection)}</span>
        </div>
      </div>
    </article>
    ${hourlyStrip}
    <h2 class="section-label">Weekly Forecast</h2>
    <section class="forecast" aria-label="5-day forecast">
      ${forecastCards}
    </section>
    <section class="chart-section" aria-label="Temperature trend">
      ${chart.svgHtml}
    </section>
  `;

  wireChartHover(chart, days);
}
