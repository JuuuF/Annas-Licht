// The sky above Neumünster as you would see it standing there: you look around from the ground.
// Which of the stars you can see tonight are watching Anna right now?
import { NMS, altaz, lstDeg, sunMoon } from './astro.js';
import { YEAR, placeLabels, shootingStar, starColor } from './util.js';

const RAD = Math.PI / 180;
// az/alt: where you look (degrees), t*: where the view is gliding to, zoom: 1 = 70° field of view (top to bottom),
// min: lowest allowed gaze - the horizon never rises above the lower edge of the picture
export const skyCam = { az: 180, alt: 30, taz: 180, talt: 0, zoom: 1, tzoom: 1, S: 300, min: 0 };
export const weather = { on: false, hours: null, now: null, failed: false };

export const starAltAz = (s, when) => altaz(s.ra, s.dec, lstDeg(when, NMS.lon), NMS.lat);
export function lookAt(s, when) {
  const [alt, az] = starAltAz(s, when);
  if (alt < 2) return false;
  skyCam.taz = az; skyCam.talt = alt;
  return true;
}

// ---- weather: cloud cover and wind from Open-Meteo (free, no key) ----
export async function loadWeather() {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${NMS.lat}&longitude=${NMS.lon}`
      + '&hourly=cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,wind_direction_10m&past_days=1&forecast_days=2&timeformat=unixtime');
    const h = (await r.json()).hourly;
    weather.hours = h.time.map((t, i) => ({ t: t * 1000, all: h.cloud_cover[i], low: Math.max(h.cloud_cover_low[i], h.cloud_cover_mid[i]),
      high: h.cloud_cover_high[i], wind: h.wind_speed_10m[i], dir: h.wind_direction_10m[i] }));
    weather.failed = false;
  } catch { weather.failed = true; }
}
// the forecast hour closest to a moment, or null if we have no data for it
export function weatherAt(when) {
  if (!weather.hours) return null;
  let best = null;
  for (const h of weather.hours) if (!best || Math.abs(h.t - when) < Math.abs(best.t - when)) best = h;
  return best && Math.abs(best.t - when) < 45 * 6e4 ? best : null;
}

// ---- clouds: soft puffs on a flat layer above the observer. The amount matches the real cloud cover,
//      the shapes are an illustration (nobody can tell us the real shapes). ----
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
function smooth(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const field = (i, j) => smooth(i / 4.5, j / 4.5) * 0.5 + smooth(i / 1.7, j / 1.7) * 0.32 + hash(i, j) * 0.18;
const quant = [];
for (let i = 0; i < 70; i++) for (let j = 0; j < 70; j++) quant.push(field(i, j));
quant.sort((a, b) => a - b);

// small pre-drawn soft discs: far cheaper than a gradient per star or cloud
const sprites = new Map();
function sprite(key, stops) {
  if (!sprites.has(key)) {
    const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    stops.forEach(([at, color]) => g.addColorStop(at, color));
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    sprites.set(key, c);
  }
  return sprites.get(key);
}
const halo = color => sprite('star' + color, [[0, '#fff'], [.12, color], [.3, color + '55'], [1, color + '00']]);
export const mistSprite = () => sprite('mist', [[0, 'rgba(190,205,235,1)'], [.5, 'rgba(170,190,230,.45)'], [1, 'rgba(160,180,225,0)']]);
const puffNight = () => sprite('puffN', [[0, 'rgba(96,104,134,1)'], [.5, 'rgba(84,92,122,.55)'], [1, 'rgba(70,78,108,0)']]);
const puffDay = () => sprite('puffD', [[0, 'rgba(250,250,252,1)'], [.5, 'rgba(232,236,244,.6)'], [1, 'rgba(220,226,238,0)']]);

// soft patches along the galactic plane, brighter towards the centre of the galaxy (Sagittarius) and in Cygnus
const GP = [192.859, 27.128, 122.932].map(v => v * RAD);
export const milky = [];
for (let l = 0; l < 360; l += 2) for (let k = 0; k < 2; k++) {
  const b = (hash(l, k) - 0.5) * (hash(l, k + 7) < 0.3 ? 16 : 8) * RAD, L = l * RAD;
  const dec = Math.asin(Math.sin(b) * Math.sin(GP[1]) + Math.cos(b) * Math.cos(GP[1]) * Math.cos(GP[2] - L));
  const ra = GP[0] + Math.atan2(Math.cos(b) * Math.sin(GP[2] - L), Math.sin(b) * Math.cos(GP[1]) - Math.cos(b) * Math.sin(GP[1]) * Math.cos(GP[2] - L));
  const centre = Math.cos(L) * 0.5 + 0.5, cygnus = Math.exp(-(((l - 75) / 22) ** 2));
  const m = [ra / RAD, dec / RAD, 5 + hash(l, k + 3) * 6, 0.035 + 0.05 * centre ** 2 + 0.03 * cygnus + 0.02 * hash(l, k + 5)];
  m.dir = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  milky.push(m);
}

// ---- constellations ----
// The figures everybody knows are always drawn faintly; all others appear when you look their way.
const KNOWN = new Set(['UMa', 'UMi', 'Ori', 'Cas', 'Cyg', 'Lyr', 'Aql', 'Leo', 'Tau', 'Gem', 'CMa', 'Peg', 'And', 'Per', 'Aur', 'Boo', 'Sco', 'Vir']);
const focus = new Map();            // constellation id -> 0...1, how much it is "looked at" (eased over time)
let art = null;                      // drawings of the figures, tied to three stars each (see tools/build_art.py)
const pictures = new Map();
if (typeof fetch === 'function' && typeof document !== 'undefined') fetch('data/art.json').then(r => r.json()).then(a => { art = a; }).catch(() => { art = {}; });
function picture(id) {
  if (!art?.[id]) return null;
  if (!pictures.has(id)) { const im = new Image(); im.src = art[id].f; pictures.set(id, im); }
  const im = pictures.get(id);
  return im.complete && im.naturalWidth ? im : null;
}

const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const clamp01 = v => Math.min(1, Math.max(0, v));

export function drawSky(ctx, W, H, S) {
  const t = S.t, when = S.skyT ?? Date.now(), hits = [], labels = [];
  const dOut = (t - S.birth) / YEAR, dIn = Math.max(0, (t - S.death) / YEAR);
  const lst = lstDeg(when, NMS.lon), cx = W / 2, cy = H / 2;

  // The picture is made the way planetarium programs make it (stereographic): shapes keep their proportions everywhere,
  // also near the edges of a wide screen, where an ordinary camera picture pulls everything apart. The price is a horizon
  // that is very slightly curved.
  const base = H / 4 / Math.tan(17.5 * RAD);            // 70° from top to bottom at zoom 1
  skyCam.tzoom = Math.min(2.3, Math.max(0.62, skyCam.tzoom));
  skyCam.min = 2 * Math.atan(Math.max(0, H / 2 - 172) / (2 * base * skyCam.tzoom)) / RAD;
  skyCam.talt = Math.min(89.9, Math.max(skyCam.min, skyCam.talt));
  skyCam.zoom += (skyCam.tzoom - skyCam.zoom) * 0.15;
  skyCam.alt += (skyCam.talt - skyCam.alt) * 0.15;
  skyCam.az = (skyCam.az + ((skyCam.taz - skyCam.az + 540) % 360 - 180) * 0.15 + 360) % 360;
  const Sc = skyCam.S = base * skyCam.zoom;
  const a0 = skyCam.alt * RAD, z0 = skyCam.az * RAD;
  const f = [Math.cos(a0) * Math.sin(z0), Math.cos(a0) * Math.cos(z0), Math.sin(a0)];       // forward (east, north, up)
  const r = [Math.cos(z0), -Math.sin(z0), 0];
  const u = [-Math.sin(a0) * Math.sin(z0), -Math.sin(a0) * Math.cos(z0), Math.cos(a0)];
  // a unit direction -> screen; `cut` = how far to the side or behind us something may be
  const Pd = (d, cut = -0.25) => {
    const zc = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    if (zc < cut) return null;
    const k = 2 * Sc / (1 + zc);
    return [cx + (d[0] * r[0] + d[1] * r[1]) * k, cy - (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) * k, zc, 0, k];
  };
  const dir = (alt, az) => [Math.cos(alt * RAD) * Math.sin(az * RAD), Math.cos(alt * RAD) * Math.cos(az * RAD), Math.sin(alt * RAD)];
  const P = (alt, az, cut) => Pd(dir(alt, az), cut);
  // a place on the celestial sphere -> screen; `low` = how far below the horizon it may be
  const star = (ra, dec, low = -3) => { const [alt, az] = altaz(ra, dec, lst, NMS.lat); const p = alt > low ? P(alt, az) : null; if (p) p[3] = alt; return p; };
  const seen = p => p && p[0] > -30 && p[0] < W + 30 && p[1] > -30 && p[1] < H + 30;

  // ---- the light of the day: Sun, Moon, and what they do to the sky ----
  const sm = sunMoon(when);
  const [sunAlt, sunAz] = altaz(sm.sun[0], sm.sun[1], lst, NMS.lat), [moonAlt, moonAz] = altaz(sm.moon[0], sm.moon[1], lst, NMS.lat);
  const night = clamp01((-sunAlt - 2) / 10);             // 1 = fully dark, 0 = the Sun is (almost) up
  const day = clamp01((sunAlt + 5) / 10);                // 1 = broad daylight
  const dusk = clamp01(1 - Math.abs(sunAlt + 1) / 9);    // the glow around sunrise and sunset
  const moonGlow = moonAlt > 0 ? sm.lit * night * 0.5 : 0;
  const top = mix(mix([2, 4, 11], [16, 26, 48], moonGlow), [38, 100, 186], day);
  const low = mix(mix(mix([16, 26, 48], [30, 44, 74], moonGlow), [150, 196, 236], day), [226, 142, 96], dusk * 0.55);
  const hy = Math.min(H * 3, cy + 2 * Sc * Math.tan(a0 / 2));        // where the horizon crosses the middle of the picture
  const sky = ctx.createLinearGradient(0, hy - 1.1 * H, 0, hy);
  sky.addColorStop(0, rgb(top)); sky.addColorStop(.6, rgb(mix(top, low, 0.3))); sky.addColorStop(1, rgb(low));
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

  const mist = mistSprite();
  if (night > 0.05) for (const [ra, dec, size, alpha] of milky) {
    const p = star(ra, dec);
    if (!p || p[3] < -2) continue;
    const px = Math.min(p[4], 3 * Sc) * size * RAD;
    if (p[0] < -px || p[0] > W + px || p[1] < -px || p[1] > H + px) continue;
    ctx.globalAlpha = alpha * 1.15 * night * Math.min(1, 0.25 + p[3] / 30);
    ctx.drawImage(mist, p[0] - px, p[1] - px, 2 * px, 2 * px);
  }
  ctx.globalAlpha = 1;

  // a faint grid makes the dome readable: circles of equal height, lines towards the zenith
  ctx.strokeStyle = `rgba(${day > 0.5 ? '255,255,255' : '120,150,210'},.07)`; ctx.lineWidth = 1;
  for (const alt of [15, 30, 45, 60, 75]) { ctx.beginPath(); let pen = false; for (let az = 0; az <= 360; az += 3) { const p = P(alt, az); if (p) { pen ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); } pen = !!p; } ctx.stroke(); }
  for (let az = 0; az < 360; az += 22.5) { ctx.beginPath(); let pen = false; for (let alt = 0; alt <= 90; alt += 5) { const p = P(alt, az); if (p) { pen ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); } pen = !!p; } ctx.stroke(); }

  // ---- constellations come forward when you look at them ----
  const starFade = 0.1 + 0.9 * night;
  if (S.sky) {
    const wide = Math.min(1.35, Math.max(0.6, 1 / skyCam.zoom)), near = Math.cos(15 * wide * RAD), far = Math.cos(33 * wide * RAD);
    for (const [id, name, ra, dec, lines] of S.sky.cons) {
      const [alt, az] = altaz(ra, dec, lst, NMS.lat), d = dir(alt, az), cos = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
      let want = clamp01((cos - far) / (near - far));
      want = alt < -12 ? 0 : want * want * (3 - 2 * want);
      const now = (focus.get(id) || 0) + (want - (focus.get(id) || 0)) * 0.07;
      focus.set(id, now);
      const strength = (KNOWN.has(id) ? 0.3 + 0.7 * now : now) * (0.2 + 0.8 * night);
      if (strength < 0.02 || cos < 0) continue;
      // the drawing of the figure, stretched onto its three anchor stars
      const im = now > 0.03 && night > 0.1 ? picture(id) : null;
      if (im) {
        const [A, B, C] = art[id].a, p = [A, B, C].map(q => star(q[2], q[3], -40));
        if (p[0] && p[1] && p[2]) {
          const du1 = B[0] - A[0], dv1 = B[1] - A[1], du2 = C[0] - A[0], dv2 = C[1] - A[1], det = du1 * dv2 - du2 * dv1;
          const ax = ((p[1][0] - p[0][0]) * dv2 - (p[2][0] - p[0][0]) * dv1) / det, cxx = ((p[2][0] - p[0][0]) * du1 - (p[1][0] - p[0][0]) * du2) / det;
          const bx = ((p[1][1] - p[0][1]) * dv2 - (p[2][1] - p[0][1]) * dv1) / det, dx = ((p[2][1] - p[0][1]) * du1 - (p[1][1] - p[0][1]) * du2) / det;
          if (Math.abs(ax) + Math.abs(cxx) + Math.abs(bx) + Math.abs(dx) < 12 * Math.max(W, H)) {
            ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = now * 0.5 * night;
            ctx.transform(ax, bx, cxx, dx, p[0][0] - ax * A[0] - cxx * A[1], p[0][1] - bx * A[0] - dx * A[1]);
            ctx.drawImage(im, 0, 0, 1, 1);
            ctx.restore();
          }
        }
      }
      ctx.strokeStyle = `rgba(74,128,200,${0.85 * strength})`; ctx.lineWidth = 1.1 + 0.7 * now;
      ctx.beginPath();
      for (const line of lines) {
        let prev = null;
        for (const [lra, ldec] of line) {
          const p = star(lra, ldec);
          if (prev && p && (seen(prev) || seen(p))) { ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]); }
          prev = p;
        }
      }
      ctx.stroke();
      const p = alt > 6 ? P(alt, az) : null;
      if (seen(p)) labels.push({ x: p[0], y: p[1], text: name, color: `rgb(${mix([120, 165, 225], [200, 222, 250], now).join(',')})`,
        font: `${Math.round(14 + 3 * now)}px "Source Sans 3", system-ui, sans-serif`, prio: 5 + 20 * now, alpha: Math.min(1, strength * 1.6) });
    }
    const grow = Math.min(1.8, Math.max(0.8, Math.sqrt(skyCam.zoom)));
    for (const s of S.sky.stars) {
      const p = star(s[0], s[1]);
      if (!seen(p) || p[3] < 0) continue;
      ctx.globalAlpha = Math.min(1, 0.4 + p[3] / 22) * starFade;       // dimmer in the haze near the horizon, washed out by daylight
      const hr = Math.min(17, Math.max(1.6, (5.4 - s[2]) * 2.1)) * grow;
      ctx.drawImage(halo(starColor(s[3])), p[0] - hr, p[1] - hr, 2 * hr, 2 * hr);
      if (s[5] && s[2] < 1.6 && night > 0.4 && !(s[4] && s[4] <= dOut && s[4] >= dIn)) labels.push({ x: p[0], y: p[1] + 20, text: s[5], color: 'rgba(225,230,240,.8)', font: '12.5px "Source Sans 3", system-ui, sans-serif', prio: 6 });
    }
    ctx.globalAlpha = 1;
  }

  // ---- Sun and Moon ----
  const bloom = (p, radius, color, alpha) => {
    const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], radius);
    g.addColorStop(0, `rgba(${color},${alpha})`); g.addColorStop(.25, `rgba(${color},${alpha * 0.35})`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p[0], p[1], radius, 0, 7); ctx.fill();
  };
  const sunP = sunAlt > -4 ? P(sunAlt, sunAz) : null;
  if (sunP && sunP[0] > -Sc && sunP[0] < W + Sc) {
    bloom(sunP, Sc * 0.75, sunAlt < 6 ? '255,190,120' : '255,244,214', 0.55);
    bloom(sunP, Sc * 0.16, '255,250,235', 0.95);
    ctx.fillStyle = '#fffdf2'; ctx.beginPath(); ctx.arc(sunP[0], sunP[1], Math.max(6, Sc * 0.0046 * 2.5), 0, 7); ctx.fill();
    labels.push({ x: sunP[0], y: sunP[1] + Math.max(6, Sc * 0.0116) + 18, text: 'Sonne', color: 'rgba(255,255,255,.85)', font: '13px "Source Sans 3", system-ui, sans-serif', prio: 60 });
  }
  const moonP = moonAlt > -2 ? P(moonAlt, moonAz) : null;
  if (seen(moonP)) {
    const rm = Math.max(8, Sc * 0.0045 * 3);            // drawn three times its true size, so that the phase can be read
    // the lit side faces the Sun: find that direction on the screen
    const dm = dir(moonAlt, moonAz), ds = dir(sunAlt, sunAz), dot = dm[0] * ds[0] + dm[1] * ds[1] + dm[2] * ds[2];
    const q = Pd(dm.map((c, i) => c + 0.02 * (ds[i] - dot * c)), 0.05) || moonP;
    bloom(moonP, rm * (3 + 9 * sm.lit), '214,224,245', 0.1 + 0.3 * sm.lit * (0.3 + 0.7 * night));
    ctx.save(); ctx.translate(moonP[0], moonP[1]); ctx.rotate(Math.atan2(q[1] - moonP[1], q[0] - moonP[0]));
    ctx.fillStyle = rgb(mix([24, 28, 42], low, day * 0.85)); ctx.beginPath(); ctx.arc(0, 0, rm, 0, 7); ctx.fill();       // the unlit part
    ctx.fillStyle = '#f3f0e4'; ctx.beginPath(); ctx.arc(0, 0, rm, -Math.PI / 2, Math.PI / 2);
    ctx.ellipse(0, 0, rm * Math.abs(1 - 2 * sm.lit), rm, 0, Math.PI / 2, -Math.PI / 2, sm.lit < 0.5); ctx.fill();
    ctx.restore();
    labels.push({ x: moonP[0], y: moonP[1] + rm + 16, text: `Mond, ${Math.round(sm.lit * 100)} %`, color: 'rgba(235,238,245,.85)', font: '13px "Source Sans 3", system-ui, sans-serif', prio: 60 });
  }

  // the stars that can see her - only those visible to the naked eye
  for (const s of S.stars) {
    if (s.mag > 6) continue;
    const p = star(s.ra, s.dec);
    if (!seen(p) || p[3] < 0) continue;
    const lit = s.d <= dOut && s.d >= dIn, rad = Math.max(1.8, 3.6 - 0.5 * s.mag);
    const on = S.sel === s || S.hover === s || (S.sel?.kind === 'year' && Math.abs(s.d - (t - S.sel._t) / YEAR) < 0.75);
    if (lit) {
      const glow = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], rad * 5.5);
      glow.addColorStop(0, 'rgba(255,215,150,.7)'); glow.addColorStop(1, 'rgba(255,215,150,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p[0], p[1], rad * 5.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffe9c4'; ctx.beginPath(); ctx.arc(p[0], p[1], rad, 0, 7); ctx.fill();
      labels.push({ x: p[0], y: p[1] - rad - 7, text: `${s.n} (${new Date(t - s.d * YEAR).getFullYear()})`, color: '#ffe3b5',
        font: '13px EB Garamond, Georgia, serif', prio: on ? 100 : 30 - s.mag, force: on });
    } else if (on) labels.push({ x: p[0], y: p[1] - rad - 7, text: s.n, prio: 100, force: true });
    if (on) { ctx.strokeStyle = '#f3c98b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p[0], p[1], rad + 9, 0, 7); ctx.stroke(); }
    hits.push({ x: p[0], y: p[1], o: s });
  }

  // clouds drift with the real wind
  const wx = weather.on ? weatherAt(when) : null;
  if (wx) {
    const puff = day > 0.5 ? puffDay() : puffNight();
    const sec = performance.now() / 1000, wd = (wx.dir + 180) * RAD, speed = wx.wind / 3600 * 3;      // km per second, a little faster than reality
    for (const [cover, h, cell, alpha, seed] of [[wx.high, 9, 2.6, 0.35, 900], [wx.low, 2, 0.6, 0.8, 0]]) {
      if (cover < 3) continue;
      const limit = quant[Math.min(quant.length - 1, Math.floor(cover / 100 * quant.length))];
      const ox = Math.sin(wd) * speed * sec, oy = Math.cos(wd) * speed * sec;
      const si = Math.floor(ox / cell), sj = Math.floor(oy / cell), fx = ox - si * cell, fy = oy - sj * cell, n = 40;
      ctx.globalAlpha = alpha;
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
        const v = field(i - si + seed, j - sj + seed);
        if (v > limit) continue;
        const x = i * cell + fx, y = j * cell + fy, dist = Math.hypot(x, y, h);
        const p = Pd([x / dist, y / dist, h / dist]);
        if (!p) continue;
        const size = Math.min(p[4], 4 * Sc) * cell * (0.9 + (limit - v) * 2.5) / dist;
        if (p[0] < -size || p[0] > W + size || p[1] < -size || p[1] > H + size) continue;
        ctx.drawImage(puff, p[0] - size, p[1] - size, 2 * size, 2 * size);
      }
    }
    ctx.globalAlpha = 1;
  }

  // now and then a shooting star above the horizon - in front of the clouds, so that one can be caught on a cloudy night too; faint by day
  if (!S.calm) shootingStar(ctx, W, H, { every: S.meteors || 60, alpha: 0.3 + 0.7 * night, floor: Math.min(H, hy) - 40 });

  // haze above the horizon, then a dark line of trees and fields
  if (hy < H + 0.4 * W) {
    const haze = ctx.createLinearGradient(0, hy - 90, 0, hy), hz = mix([60, 85, 130], [215, 228, 242], day).join(',');
    haze.addColorStop(0, `rgba(${hz},0)`); haze.addColorStop(1, `rgba(${hz},.3)`);
    ctx.fillStyle = haze; ctx.fillRect(0, hy - 90, W, 90);
    ctx.beginPath(); ctx.moveTo(-10, H + 10);
    let lastX = -10;
    for (let d = -88; d <= 88; d += 0.5) {
      const az = skyCam.az + d, trees = 0.35 + 1.5 * smooth(az / 6, 3) + 0.9 * smooth(az / 1.1, 9) * smooth(az / 9, 5);
      const p = P(trees, az, -0.1);
      if (!p) continue;
      ctx.lineTo(p[0], p[1]); lastX = p[0];
    }
    ctx.lineTo(Math.max(lastX, W + 10), H + 10); ctx.closePath();
    ctx.fillStyle = rgb(mix([3, 4, 10], [26, 38, 28], day)); ctx.fill();
  }
  ctx.textAlign = 'center';
  ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'].forEach((name, i) => {
    const p = P(0, i * 45);
    if (!seen(p)) return;
    ctx.font = i % 2 ? '600 13px "Source Sans 3", system-ui, sans-serif' : '600 19px "Source Sans 3", system-ui, sans-serif'; ctx.fillStyle = i % 2 ? 'rgba(210,104,96,.75)' : '#d86a62';
    ctx.fillText(name, p[0], p[1] + 28);
  });

  placeLabels(ctx, labels, 1e9, S.avoid);
  if (day > 0.3) {
    ctx.font = '13px "Source Sans 3", system-ui, sans-serif'; ctx.fillStyle = 'rgba(235,238,245,.9)'; ctx.textAlign = 'center';
    ctx.fillText('Am Tag überstrahlt die Sonne die Sterne - sie stehen trotzdem genau dort.', cx, H - 196);
  }
  return hits;
}
