// Interface: canvas interaction, floating panels, moments, accounts.
import { bodies, sunAltitude, updateBodies, vec } from './astro.js';
import { createLife } from './life.js';
import { photoTime } from './phototime.js';
import { drawSky, loadWeather, lookAt, skyCam, starAltAz, weather, weatherAt } from './sky.js';
import { atHome, cam, clampScale, drawSpace, fit, panBy } from './space.js';
import * as store from './store.js';
import { AU, CATS, LS, WEIGHTS, YEAR, applyCats, catColor, dateInput, dur, esc, fmtDate, fmtDist, fmtWhen, num, parseWhen, partial, pickPicture, readDate, readTime, readWhen, showDate, timeInput, weight } from './util.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const S = { calm: matchMedia('(prefers-reduced-motion: reduce)').matches, t: Date.now(), offset: 0, view: 'space', sel: null, hover: null, stars: [], sky: null, items: [], birth: 0, death: 0, skyT: null };
// #sternschnuppe: one shooting star every 2 to 6 seconds, to look at them - read before the first picture, and again when the address changes
const meteorPace = () => { S.meteors = location.hash.includes('sternschnuppe') ? 2 : 0; };
meteorPace(); addEventListener('hashchange', meteorPace);
const cv = $('#view'), ctx = cv.getContext('2d');
let W = 0, H = 0, hits = [], ticks = 0, cost = 0;
const PROBE = location.hash.includes('messen'), LOCAL = /^(localhost|127\.)/.test(location.hostname);
// the way back: every jump along a link remembers where it came from (a star, a moment, a chosen time, the "Heute" list).
// Opening anything any other way starts afresh.
let trail = [], following = false;

// ---------- model ----------
function rebuild() {
  const p = store.state.person;
  applyCats(store.state.cats);
  S.birth = parseWhen(p.birth); S.death = parseWhen(p.death);
  const fixed = [
    { id: 'birth', title: 'Erstes Licht', date: p.birth, cat: 'freude', text: 'Der erste Augenblick ihres Lebens.', fixed: true, vis: 'public' },
    { id: 'death', title: 'Letztes Licht', date: p.death, cat: 'sonst', text: 'Der letzte Augenblick ihres Lebens. Auch dieses Licht reist weiter - hinter ihm folgt alles, was von ihr bleibt.', fixed: true, vis: 'public' },
  ];
  const selId = S.sel?.id;
  S.items = [...fixed, ...store.state.items].map(i => ({
    ...i, _t: parseWhen(i.date, i.period ? 'start' : 'mid'), _e: i.period ? (i.end ? parseWhen(i.end, 'end') : S.death) : null,
  })).map(i => (Number.isFinite(i._t) ? i : { ...i, _t: S.birth })).sort((a, b) => a._t - b._t);      // a date that cannot be read must not upset the order of all the others
  if (selId) S.sel = S.items.find(i => i.id === selId) || null;
  renderAll();
}
const litStars = () => { const a = (S.t - S.death) / YEAR, b = (S.t - S.birth) / YEAR; return S.stars.filter(s => s.d >= a && s.d <= b); };
function ageYears(at) {
  const b = new Date(S.birth), a = new Date(at);
  let y = a.getFullYear() - b.getFullYear();
  if (a.getMonth() < b.getMonth() || (a.getMonth() === b.getMonth() && a.getDate() < b.getDate())) y--;
  return y;
}
function age(at, verb = 'ist') {
  const y = ageYears(at);
  if (y >= 1) return `Anna ${verb} ${y} ${y === 1 ? 'Jahr' : 'Jahre'} alt.`;
  const m = Math.floor((at - S.birth) / YEAR * 12);
  return m < 1 ? `Anna ${verb} gerade erst geboren.` : `Anna ${verb} ${m} ${m === 1 ? 'Monat' : 'Monate'} alt.`;
}
// her age at a moment; when only the month or the year is known, that can be one of two ages
function itemAge(i) {
  if (!partial(i.date)) return age(i._t, 'war');
  const a = ageYears(Math.max(S.birth, parseWhen(i.date, 'start'))), b = ageYears(Math.min(S.death, parseWhen(i.date, 'end')));
  return a === b || a < 1 ? age(i._t, 'war') : `Anna war ${a} oder ${b} Jahre alt.`;
}
const inLife = at => at >= S.birth && at <= S.death;
function spanWhere(i, at) {
  const into = at - i._t, total = i._e - i._t;
  const part = total > 1.5 * YEAR ? `das ${Math.floor(into / YEAR) + 1}. Jahr` : into < total / 3 ? 'gerade erst begonnen' : into > total * 2 / 3 ? 'schon fast vorbei' : 'mittendrin';
  return part + (i.end ? `, zu Ende in ${dur(i._e - at)}` : '');
}

// ---------- canvas ----------
function frame() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(cv.clientWidth * dpr) || cv.height !== Math.round(cv.clientHeight * dpr)) {
    cv.width = Math.round(cv.clientWidth * dpr); cv.height = Math.round(cv.clientHeight * dpr);
  }
  W = cv.clientWidth; H = cv.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.setLineDash([]);
  S.t = Date.now() + S.offset * YEAR;
  // on phones an open sheet covers the lower part: keep the middle of the map in the part that stays visible
  // keep the middle of the map in the part of the screen that is not covered by a sheet or a card
  const small = innerWidth <= 760, sheet = small && $$('.panel').find(p => !p.hidden), card = $$('#yearcard, #journey').find(c => !c.hidden);
  const top = small ? 176 : 30, bottom = sheet ? sheet.offsetHeight : card ? H - card.getBoundingClientRect().top : 122;
  const want = top + Math.max(120, H - top - bottom) / 2;
  S.cy = (S.cy ?? want) + (want - (S.cy ?? want)) * 0.15;
  updateBodies(S.t);
  runAnim();
  frame.n = (frame.n || 0) + 1;
  if (frame.n % 30 === 1) keepClear();
  const t0 = performance.now();
  try { hits = (S.view === 'space' ? drawSpace : drawSky)(ctx, W, H, S); } catch (e) { if (!frame.warned) { frame.warned = true; console.error(e); } }   // one faulty picture must not stop all the following ones
  if (PROBE) { cost = cost * 0.9 + (performance.now() - t0) * 0.1; document.title = `${cost.toFixed(1)} ms, ${S.stars.length}, ${S.items.length}`; }   // "#messen": how long one picture takes to draw
  $('#homeBtn').hidden = atHome();
  if (S.view === 'space') { $('#thumb').style.top = scaleY(Math.min(W, H) * 0.4 / cam.scale) + 'px'; if (++ticks % 90 === 1) layoutScale(); }
  requestAnimationFrame(frame);
}
// Where the page's own text lies on top of the map: the headline and its lines, the buttons, the view switch, the names on the ruler.
// Names drawn on the map keep out of these places, so the two never run into each other. Measured every half second.
function keepClear() {
  const out = [], pad = 4, add = r => { if (r.width && r.height) out.push([r.left - pad, r.top - pad, r.width + 2 * pad, r.height + 2 * pad]); };
  for (const el of $$('#head h1, #lead')) {            // the text itself, line by line, not the whole width of its box
    if (!el.getClientRects().length) continue;
    const range = document.createRange(); range.selectNodeContents(el);
    for (const r of range.getClientRects()) add(r);
  }
  for (const el of $$('#head button, #views button, #zoom button')) for (const r of el.getClientRects()) add(r);
  S.avoid = out;
}
// what is under the pointer: the nearest point within reach, a name plate it is on (with a few pixels to spare, more for fingers),
// or the bar of a span of time: right on it, it wins over what lies behind it (a name plate drawn over it still comes first);
// beside it, the distance counts three times, so that it does not catch the lifeline next to it
function pick(x, y, reach = 20) {
  let best = null;
  const on = (r, m) => x > r[0] - m && x < r[0] + r[2] + m && y > r[1] - m && y < r[1] + r[3] + m;
  const along = ([x1, y1, x2, y2]) => {
    const dx = x2 - x1, dy = y2 - y1, k = Math.min(1, Math.max(0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
    const e = Math.hypot(x1 + k * dx - x, y1 + k * dy - y);
    return e <= 2.5 ? 0.5 : 3 * e;
  };
  for (const h of hits) {
    const d = h.rect ? (on(h.rect, reach / 5) ? 0 : Infinity) : h.seg ? along(h.seg) : Math.hypot(h.x - x, h.y - y);
    if (d < reach) { reach = d; best = h.o; }
  }
  return best;
}
// fly to something and look at it up close; the camera then turns and zooms around it instead of the Earth
function flyTo(o) {
  if (!o) return;
  const room = o.kind === 'body' ? Math.max(o.d * 0.6, 4 * LS) : o._e ? Math.max(4, (Math.min(o._e, S.t) - o._t) / YEAR * 0.75) : o.kind === 'star' ? 6 : 4;
  cam.focus = o; cam.target = clampScale(fit(room, W, H)); cam.touched = performance.now();
}
function goHome() { cam.focus = null; cam.tc = [0, 0, 0]; cam.touched = performance.now(); }

// ---------- camera moves that run by themselves ----------
// steps one after the other: { dur (ms), start(), step(p from 0 to 1), end() }; soft: a touch, the mouse wheel or a key ends it where it is
let anim = null;
const ease = p => p * p * (3 - 2 * p);
const lerpLog = (a, b, e) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * e);       // zooming feels even on a logarithmic scale
function play(steps, soft = false) { anim = { steps, i: 0, t0: performance.now(), soft }; steps[0].start?.(); }
function runAnim() {                                   // called before every picture
  while (anim) {
    const s = anim.steps[anim.i], p = Math.min(1, (performance.now() - anim.t0) / s.dur);
    s.step(p);
    if (p < 1) return;
    s.end?.();
    if (++anim.i >= anim.steps.length) { anim = null; return; }
    anim.t0 = performance.now(); anim.steps[anim.i].start?.();
  }
}
function stopAnim() { if (anim?.soft) { anim = null; cam.tc = [...cam.c]; cam.target = cam.scale; cam.touched = performance.now(); } }
addEventListener('pointerdown', stopAnim, true); addEventListener('wheel', stopAnim, { capture: true, passive: true }); addEventListener('keydown', stopAnim, true);
// the camera exactly here, no gliding; turning: let the slow turning of the map go on meanwhile
const steer = (c, scale, turning = false) => { cam.focus = null; cam.c = [...c]; cam.tc = [...c]; cam.scale = cam.target = scale; if (!turning) cam.touched = performance.now(); };

// The opening flight (7.5 s): out from the Earth past the Moon, the planets and the nearest stars; up her lifeline,
// past the moments of her life, to her first light; then back out until her whole light is in view.
const earthView = () => clampScale(fit(2.4 * LS, W, H));
function openingFlight() {
  if (S.view !== 'space' || S.calm) return;
  const dOut = (S.t - S.birth) / YEAR, all = clampScale(fit(Math.max(dOut, 20) * 1.08, W, H)), near = clampScale(fit(8, W, H)), home = earthView();
  const T = 7.5, part = (a, b, t) => ease(Math.min(1, Math.max(0, (t - a) / (b - a))));
  // The way back out is planned on the screen: her first light rises steadily from the middle to its place at the top of
  // the sphere while the zoom opens, and the Earth comes up steadily from below into the middle - nothing moves one way
  // and then back. It begins while the way up is still slowing down, so that the camera never stands still.
  // The turning is the map's own slow turning: it sets in gently at the start and simply goes on after the flight.
  const top = dOut * all;                              // how far above the middle her first light ends up, in pixels
  cam.touched = -1e9;                                  // "untouched for long": the page's clock starts at 0 when it is opened
  play([{ dur: T * 1000, step: p => {
    const t = p * T, out = part(0, 1.95, t), up = part(1.35, 4.95, t), back = part(4.43, T, t);
    const scale = Math.exp(Math.log(home) + (Math.log(near) - Math.log(home)) * out + (Math.log(all) - Math.log(near)) * back);
    steer([0, 0, dOut * up - top * back / scale], scale, true);
    cam.pitch = 0.5 - 0.09 * (1 - Math.cos(2 * Math.PI * p));            // looking a little more from the side on the way, smoothly in and out
  } }], true);
}
const pointers = new Map();
let moved = 0, pinch = 0, mid = null;
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('pointerdown', e => { if (J.on && !J.paused) { clearTimeout(J.timer); J.held = true; $('#journey').classList.add('paused'); }   // while someone looks around, the journey waits
  try { cv.setPointerCapture(e.pointerId); } catch { /* some browsers refuse for synthetic or stale pointers */ }
  pointers.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; pinch = 0; mid = null; cam.touched = performance.now(); });
cv.addEventListener('pointermove', e => {
  const prev = pointers.get(e.pointerId);
  if (!prev) { S.hover = pick(e.clientX, e.clientY); cv.classList.toggle('point', !!S.hover); return; }
  const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  moved += Math.abs(dx) + Math.abs(dy); cam.touched = performance.now();
  const sky = S.view === 'sky';
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()], dist = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (pinch && sky) skyCam.zoom = skyCam.tzoom = skyCam.tzoom * dist / pinch;
    else if (pinch) { cam.scale = cam.target = clampScale(cam.target * dist / pinch); panBy(m[0] - mid[0], m[1] - mid[1]); }   // two fingers: zoom and move
    pinch = dist; mid = m;
  } else if (!sky && (e.shiftKey || e.buttons & 6)) {    // shift or right mouse button: move sideways
    panBy(dx, dy);
  } else if (sky) {                                  // grab the sky and pull it
    const k = 57.3 / skyCam.S;
    skyCam.az = skyCam.taz = (skyCam.taz - dx * k / Math.max(0.25, Math.cos(skyCam.alt * Math.PI / 180)) + 360) % 360;
    skyCam.alt = skyCam.talt = Math.min(89.9, Math.max(skyCam.min, skyCam.talt + dy * k));
  } else {
    cam.yaw += dx * 0.006;
    cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch + dy * 0.006));
  }
});
const release = e => {
  if (pointers.delete(e.pointerId) && moved < 8 && e.type === 'pointerup') {
    const o = pick(e.clientX, e.clientY, e.pointerType === 'mouse' ? 20 : 30);
    if (o) select(o); else deselect();           // a tap on empty sky lets go of whatever was selected
  }
  pinch = 0; mid = null;
  if (J.on && J.held && !pointers.size) { J.held = false; arm(); }      // let go: the station gets its full time again, then the journey moves on
};
cv.addEventListener('pointerup', release); cv.addEventListener('pointercancel', release);
cv.addEventListener('pointerleave', () => { S.hover = null; });
cv.addEventListener('wheel', e => {
  e.preventDefault(); cam.ease = 0.12;
  if (J.on && !J.paused) arm();
  if (S.view === 'space') { cam.target = clampScale(cam.target * Math.exp(-e.deltaY * 0.0016)); cam.touched = performance.now(); }
  else skyCam.tzoom *= Math.exp(-e.deltaY * 0.0012);
}, { passive: false });
cv.addEventListener('dblclick', e => { if (S.view === 'space') flyTo(pick(e.clientX, e.clientY)); });

// ---- the ruler of distances: the named views sit where they belong, from the Moon up to her whole life ----
const VMAX = Math.log10(150), VMIN = Math.log10(1.3 * LS), scaleEl = $('#scale');
function viewRadius(z) {                               // how many light-years fit between the middle and the edge of the picture
  const dOut = (S.t - S.birth) / YEAR, dIn = Math.max((S.t - S.death) / YEAR, 2e-4);
  return z === 'life' ? Math.max(dOut, 20) * 1.08 : z === 'near' ? 13 : z === 'last' ? dIn * 1.5 : z === 'solar' ? 33 * AU : 2.4 * LS;
}
const scaleY = r => Math.min(1, Math.max(0, (VMAX - Math.log10(r)) / (VMAX - VMIN))) * scaleEl.clientHeight;
function layoutScale() { for (const b of $$('button', scaleEl)) b.style.top = scaleY(viewRadius(b.dataset.zoom)) + 'px'; }
$$('#zoom [data-zoom]').forEach(b => b.onclick = () => {
  cam.touched = performance.now(); cam.ease = 0.12; goHome();
  if (b.dataset.zoom !== 'home') cam.target = clampScale(fit(viewRadius(b.dataset.zoom), W, H));
});
function scaleDrag(e) {
  const r = scaleEl.getBoundingClientRect(), y = Math.min(r.height, Math.max(0, e.clientY - r.top));
  cam.target = clampScale(fit(10 ** (VMAX - y / r.height * (VMAX - VMIN)), W, H)); cam.ease = 0.2; cam.touched = performance.now();
}
// zooming by dragging works on the line only (the names jump to their view when tapped); the rest of the ruler lets touches through to the map
const track = $('#track');
track.addEventListener('pointerdown', e => { track.setPointerCapture(e.pointerId); scaleDrag(e); });
track.addEventListener('pointermove', e => { if (track.hasPointerCapture(e.pointerId)) scaleDrag(e); });
addEventListener('resize', layoutScale);

// the slow turning of the map can be switched off, to look at one arrangement in peace
try { S.still = localStorage.getItem('annas-licht-drehung') === 'aus'; } catch { /* ignore */ }
const spinText = () => { $('#spin').textContent = S.still ? 'Drehung starten' : 'Drehung anhalten'; };
$('#spin').onclick = () => { S.still = !S.still; cam.touched = 0; try { localStorage.setItem('annas-licht-drehung', S.still ? 'aus' : 'an'); } catch { /* ignore */ } spinText(); };
spinText();

function setView(v) {
  S.view = v; S.hover = null;
  document.body.classList.toggle('sky', v === 'sky');
  $$('#views [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('#zoom').hidden = v !== 'space'; $('#skybar').hidden = v !== 'sky';
  if (v !== 'space' && J.on) stopJourney();
  $('#hint').textContent = v === 'space' ? 'Ziehen dreht. Mausrad oder zwei Finger zoomen. Doppelklick fliegt hin. Umschalt-Taste oder zwei Finger verschieben.'
    : 'Ziehen, um dich umzuschauen. Golden leuchten die Sterne, die Anna in diesem Moment sehen - mit dem Jahr, das dort gerade zu sehen ist.';
  if (v === 'sky' && S.sel?.kind === 'star') lookAt(S.sel, S.skyT ?? Date.now());
  $('#hint').style.opacity = 1; setTimeout(() => { $('#hint').style.opacity = 0; }, 9000);
}
$$('#views [data-view]').forEach(b => b.onclick = () => switchView(b.dataset.view));

// The way between the two views. To the night sky: down to the Earth, through a short darkness, then standing in Neumünster
// looking straight up, and the gaze lowers to the horizon. Back: the gaze rises, and the map opens again out of the Earth,
// to where it was left. `then` runs at the moment the view changes (e.g. to pick a star there).
let spaceWas = null, skyWas = null;
function switchView(v, then) {
  if (S.view === v) { then?.(); return; }
  if (anim && !anim.soft) return;                      // already on the way
  if (S.calm || !W) { setView(v); then?.(); return; }
  stopAnim();
  const fade = $('#fade'), home = clampScale(fit(1.5 * LS, W, H)), UP = 89.9, WIDE = 0.62;
  const dark = o => { fade.style.opacity = Math.min(1, Math.max(0, o)); };
  if (v === 'sky') {
    const c0 = [...cam.c], s0 = cam.scale;
    spaceWas = { c: [...cam.c], tc: [...cam.tc], focus: cam.focus, scale: cam.target };
    let rest;
    play([
      { dur: 1100, step: p => { const e = ease(p); steer(c0.map(x => x * (1 - e)), lerpLog(s0, home, e)); dark((p - 0.55) / 0.45); } },
      { dur: 1800, start: () => {
          if (skyWas) { skyCam.talt = skyWas.alt; skyCam.tzoom = skyWas.zoom; }
          setView('sky'); then?.();
          rest = { alt: skyCam.talt, zoom: skyCam.tzoom };
        }, step: p => {
          const e = ease(p);
          skyCam.zoom = skyCam.tzoom = WIDE + (rest.zoom - WIDE) * e;
          skyCam.alt = skyCam.talt = UP + (Math.max(rest.alt, skyCam.min) - UP) * e;
          dark(1 - p / 0.35);
        } },
    ]);
  } else {
    const a0 = skyCam.alt, z0 = skyCam.zoom;
    const back = spaceWas || { c: [0, 0, 0], tc: [0, 0, 0], focus: null, scale: clampScale(fit(Math.max((S.t - S.birth) / YEAR, 20) * 1.08, W, H)) };
    skyWas = { alt: skyCam.talt, zoom: skyCam.tzoom };
    play([
      { dur: 900, step: p => { const e = ease(p); skyCam.alt = skyCam.talt = a0 + (UP - a0) * e; skyCam.zoom = skyCam.tzoom = z0 + (WIDE - z0) * e; dark((p - 0.45) / 0.55); } },
      // out of the Earth: quick at first (still in the dark), then slowing down over a long way, so that it comes to rest gently
      { dur: 2600, start: () => { setView('space'); then?.(); },
        step: p => { const e = 1 - (1 - p) ** 4; steer(back.c.map(x => x * e), lerpLog(home, back.scale, e)); dark(1 - p / 0.25); },
        end: () => { cam.focus = back.focus; cam.tc = [...back.tc]; } },
    ]);
  }
}

// night sky clock: minutes after noon of the "current" evening
const noon = () => { const d = new Date(); if (d.getHours() < 9) d.setDate(d.getDate() - 1); d.setHours(12, 0, 0, 0); return d.getTime(); };
function setSkyTime(min) {
  S.skyT = min == null ? null : noon() + min * 6e4;
  const d = new Date(S.skyT ?? Date.now());
  $('#skytime').value = Math.round((d - noon()) / 6e4);
  $('#skywhen').textContent = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) + ', '
    + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  cloudInfo();
}
function cloudInfo() {
  const w = weatherAt(S.skyT ?? Date.now());
  $('#clouds').classList.toggle('on', weather.on);
  $('#cloudinfo').textContent = weather.failed ? 'Die Wetterdaten sind gerade nicht erreichbar.'
    : !weather.hours ? '' : !w ? 'Für diese Uhrzeit gibt es keine Wettervorhersage.'
    : `Bewölkung über Neumünster: ${Math.round(w.all)} %.${weather.on ? ' Wolkenformen sind nachempfunden.' : ''} Wetterdaten: Open-Meteo`;
}
$('#clouds').onclick = () => { weather.on = !weather.on; try { localStorage.setItem('annas-licht-clouds', weather.on ? 'an' : 'aus'); } catch { /* ignore */ } cloudInfo(); };
// the sky box folds away; on phones it starts folded so it is not in the way
const foldSky = closed => { $('#skybar').classList.toggle('closed', closed); $('#skytoggle').setAttribute('aria-expanded', String(!closed)); };
$('#skytoggle').onclick = () => foldSky(!$('#skybar').classList.contains('closed'));
foldSky(innerWidth <= 1100);

$('#skytime').oninput = e => setSkyTime(+e.target.value);
$('#skynow').onclick = () => setSkyTime(null);

// ---------- panels ----------
const panel = id => $('#p-' + id);
function openPanel(id) {
  if (id !== 'detail' && !following) trail = [];
  const p = panel(id), small = innerWidth <= 760;
  for (const other of $$('.panel')) if (other !== p && (small || (p.classList.contains('left') && other.classList.contains('left')))) other.hidden = true;
  p.hidden = false; syncDock();
}
const closePanel = id => { if (id === 'detail' && !following) trail = []; panel(id).hidden = true; syncDock(); };
const syncDock = () => { $$('#dock [data-panel]').forEach(b => b.classList.toggle('on', !panel(b.dataset.panel).hidden)); document.body.classList.toggle('leftopen', $$('.panel.left').some(p => !p.hidden)); };
$$('#dock [data-panel]').forEach(b => b.onclick = () => (panel(b.dataset.panel).hidden ? openPanel(b.dataset.panel) : closePanel(b.dataset.panel)));
for (const p of $$('.panel')) {
  $('.x', p).onclick = () => closePanel(p.id.slice(2));
  const head = $('header', p);
  head.addEventListener('pointerdown', e => {                      // drag panels around on large screens
    if (innerWidth <= 760 || e.target.closest('button')) return;
    const r = p.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    const move = m => Object.assign(p.style, { left: Math.max(0, Math.min(innerWidth - 80, m.clientX - ox)) + 'px', top: Math.max(0, Math.min(innerHeight - 50, m.clientY - oy)) + 'px', right: 'auto', bottom: 'auto', transform: 'none' });
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', () => head.removeEventListener('pointermove', move), { once: true });
  });
}
// A question in the page's own look. (The browser's own confirm() names its buttons "OK" and "Abbrechen",
// and "Abbrechen" would mean the opposite of the form's button of that name.)  -> true for yes
let answer = null;
function ask(text, yes, no) {
  const el = $('#ask');
  answer?.(false);
  $('#askText').textContent = text; $('[data-a="1"]', el).textContent = yes; $('[data-a="0"]', el).textContent = no;
  el.hidden = false; $('[data-a="0"]', el).focus();
  return new Promise(resolve => { answer = v => { el.hidden = true; answer = null; resolve(v); }; });
}
$$('#ask [data-a]').forEach(b => b.onclick = () => answer?.(b.dataset.a === '1'));
$('#ask').onclick = e => { if (e.target.id === 'ask') answer?.(false); };      // a tap beside the question: keep editing
// leaving a form for a moment or for photos: only asks when something was entered or changed (form.dirty)
const LEAVE = ['Änderungen verwerfen? Was du hier eingetragen hast, geht dabei verloren.', 'Verwerfen', 'Weiter bearbeiten'];
const mayLeave = async form => !form.dirty?.() || ask(...LEAVE);
// Closing the moments while a form is open there counts as "Abbrechen", however it is closed (×, dock, Escape, another panel).
// "Weiter bearbeiten" brings the form back. A form that is still saving stays, so that its outcome can be seen.
new MutationObserver(async () => {
  const p = panel('moments'), f = $('form', p);
  if (!p.hidden || !f || $('button.primary', f)?.disabled || answer) return;
  if (await mayLeave(f)) { if ($('form', p) === f) renderMoments(); } else openPanel('moments');
}).observe(panel('moments'), { attributes: true, attributeFilter: ['hidden'] });
function deselect() {
  if (!S.sel || J.on) return;
  S.sel = null; $('#yearcard').hidden = true; closePanel('detail'); renderDetail(); shareHash();
}
// selecting a moment in the 3D view also makes it the point the view turns around
function select(o) { if (!following) trail = []; if (J.on) stopJourney(); $('#yearcard').hidden = true; S.sel = o; shareHash();
  if (S.view === 'space' && o?._t && o.kind !== 'year') { cam.focus = o; cam.touched = performance.now(); } if (S.view === 'sky' && o?.kind === 'star') lookAt(o, S.skyT ?? Date.now()); renderDetail(); openPanel('detail'); }

// the address bar always names what is selected, so a link to a star or a moment can be passed on
function shareHash() {
  const o = S.sel, part = !o ? '' : o.kind === 'star' || o.kind === 'body' ? 'sel=' + encodeURIComponent(o.n || o.name) : o.id ? 'm=' + o.id : '';
  history.replaceState(null, '', location.pathname + location.search + (part ? '#' + (S.view === 'sky' ? 'himmel&' : '') + part : ''));
}
async function shareLink(title) {
  const url = location.href, text = `Annas Licht - ${title}`;
  try { if (navigator.share) await navigator.share({ title: 'Annas Licht', text, url }); else { await navigator.clipboard.writeText(url); return 'Link kopiert'; } } catch { /* cancelled */ }
  return null;
}

// ---------- the picture frame: the photos of all moments, in random order, one after another ----------
// seen: the last pictures shown, at: the one on show. Going back steps through them; going on steps forward again and,
// at the newest, picks a new one. While the mouse rests on the frame, the picture stays (held).
const pics = { el: $('#frame'), pool: [], timer: 0, key: '', off: false, now: null, seen: [], at: -1, due: 0, left: 0, held: false, token: 0 };
function photoUrl(path) {
  if (!urls.has(path)) urls.set(path, store.photoBytes(path).then(b => URL.createObjectURL(new Blob([b], { type: 'image/jpeg' }))));
  return urls.get(path);
}
const PICTURE_SECONDS = 16, KEEP_SEEN = 12;
// -> false if the photo cannot be loaded
async function showPicture(pic) {
  clearTimeout(pics.timer);
  const token = ++pics.token;                            // a slow photo must not take the place of one asked for after it
  const [a, b] = $$('.pic', pics.el), show = a.classList.contains('on') ? b : a, hide = show === a ? b : a;
  try {
    const url = await photoUrl(pic.path), imgs = $$('img', show);
    if (token !== pics.token) return true;
    for (const img of imgs) img.src = url;
    await Promise.all(imgs.map(img => img.decode?.().catch(() => {})));
    if (token !== pics.token) return true;
    show.classList.add('on'); hide.classList.remove('on');
    pics.now = pic.item; pics.el.hidden = false;
    pics.el.classList.toggle('first', pics.at <= 0);
    $('figcaption', pics.el).textContent = `${pic.item.title === 'Fotos' ? '' : pic.item.title + ', '}${pic.item.date.slice(0, 4)}`;
  } catch { return false; }
  const bar = $('.bar', pics.el);                        // the line at the bottom shows how long this picture stays
  bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = `fill ${PICTURE_SECONDS}s linear forwards`;
  pics.left = PICTURE_SECONDS * 1000;
  if (pics.held) bar.style.animationPlayState = 'paused';
  else { pics.due = Date.now() + pics.left; pics.timer = setTimeout(nextPicture, pics.left); }
  return true;
}
async function nextPicture() {
  clearTimeout(pics.timer);
  if (pics.off || !pics.pool.length) { pics.el.hidden = true; return; }
  if (pics.at < pics.seen.length - 1) pics.at++;         // after going back: forward again through what was shown
  else { pics.seen = [...pics.seen, pickPicture(pics)].slice(-KEEP_SEEN); pics.at = pics.seen.length - 1; }
  if (await showPicture(pics.seen[pics.at])) { pics.fails = 0; return; }
  pics.seen.splice(pics.at--, 1);                        // a photo that cannot be loaded (yet): forget it and go straight on
  pics.fails = (pics.fails || 0) + 1;
  pics.timer = setTimeout(nextPicture, pics.fails >= pics.pool.length ? 60000 : 600);
}
function prevPicture() {
  if (pics.at > 0) showPicture(pics.seen[--pics.at]);
}
// the mouse on the frame holds the picture; the bar stops with it and goes on from there
function holdPicture(on) {
  if (on === pics.held) return;
  pics.held = on;
  const bar = $('.bar', pics.el);
  clearTimeout(pics.timer);
  if (on) pics.left = Math.max(0, pics.due - Date.now());
  else if (!pics.off && pics.pool.length) { pics.due = Date.now() + pics.left; pics.timer = setTimeout(nextPicture, pics.left); }
  bar.style.animationPlayState = on ? 'paused' : 'running';
}
pics.el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') holdPicture(true); });
pics.el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') holdPicture(false); });
setInterval(() => { if (pics.held && !pics.el.matches(':hover')) holdPicture(false); }, 1500);   // the frame may vanish under the mouse without a "leave"
// called whenever the moments change (also after logging in or out)
function fillFrame() {
  pics.death = S.death;
  const pool = S.items.flatMap(i => (i.photos || []).map(path => ({ path, item: i })));
  const key = pool.map(p => p.path).join('|');
  if (key === pics.key) { for (const p of pics.pool) p.item = S.items.find(i => i.id === p.item.id) || p.item; return; }
  Object.assign(pics, { pool, key, recent: [], seen: [], at: -1 });
  nextPicture();
}
pics.el.onclick = e => {
  if (e.target.closest('.x')) { pics.off = true; pics.el.hidden = true; clearTimeout(pics.timer); return; }
  if (e.target.closest('.prev')) return prevPicture();
  if (e.target.closest('.next')) return nextPicture();
  if (pics.now) select(S.items.find(i => i.id === pics.now.id) || pics.now);
};

// ---------- a chosen time on the lifeline strip ----------
const monthYear = t => new Date(t).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
const life = createLife($('#life canvas'), S, {
  onYear: selectYear,
  onItem: i => { select(i); if (S.view === 'space') flyTo(i); },
  label: t => `${new Date(t).getFullYear()}, ${ageYears(t)} ${ageYears(t) === 1 ? 'Jahr' : 'Jahre'}`,
});
function selectYear(time) {
  if (J.on) stopJourney();
  const y = { kind: 'year', _t: time, cat: 'freude', title: monthYear(time) };
  if (S.view === 'space') {                          // travel along the lifeline to that time, like the guided journey does
    cam.focus = y; cam.touched = performance.now();
    const close = fit(8, W, H);
    if (cam.target < close * 0.6 || cam.target > close * 6) cam.target = clampScale(close);
  }
  S.sel = y; closePanel('detail'); renderYear();
}
function renderYear() {
  const y = S.sel, el = $('#yearcard');
  if (y?.kind !== 'year') { el.hidden = true; return; }
  const d = (S.t - y._t) / YEAR;
  const seen = S.stars.map(s => [Math.abs(s.d - d), s]).sort((a, b) => a[0] - b[0]);
  const close = seen.filter(x => x[0] < 0.75).slice(0, 4), star = starLink;
  const spans = S.items.filter(i => i._e && i._t <= y._t && y._t <= i._e);
  const near = S.items.filter(i => !i._e && Math.abs(i._t - y._t) < YEAR).sort((a, b) => Math.abs(a._t - y._t) - Math.abs(b._t - y._t)).slice(0, 2);
  el.innerHTML = `<button class="x" aria-label="Schließen">×</button><h3>${monthYear(y._t)}</h3>
    <p>${age(y._t, 'ist')} Das Licht dieser Tage ist jetzt <b>${fmtDist(d)}</b> entfernt.</p>
    <p>${close.length ? `Gerade zu sehen von ${close.map(x => star(x[1])).join(', ')}.`
      : `Kein Stern dieser Karte sieht gerade genau diese Wochen - am nächsten ist ${star(seen[0][1])}.`}</p>
    ${spans.length || near.length ? `<p class="muted">${[...spans.map(i => `${itemLink(i)} (${spanWhere(i, y._t)})`), ...near.map(i => `${itemLink(i)} (${dur(i._t - y._t)} ${i._t < y._t ? 'davor' : 'danach'})`)].join('; ')}</p>` : ''}
    ${S.view === 'space' ? '<div class="row"><button id="yfly">Näher heran</button><button id="yhome">Ganzes Leben zeigen</button></div>' : ''}`;
  el.hidden = false;
  $('.x', el).onclick = () => { S.sel = null; el.hidden = true; life.draw(); };
  bindLinks(el);
  if ($('#yfly')) $('#yfly').onclick = () => flyTo(y);
  if ($('#yhome')) $('#yhome').onclick = () => $('#zoom [data-zoom=life]').click();
}

// ---------- the guided journey through her life ----------
const J = { on: false, list: [], i: 0, paused: false, timer: 0 };
if (LOCAL) window.__J = J;      // for testing on the own computer
function stations() {
  const list = S.items.filter(i => i._t <= S.t);
  if (list.length < 8) {                       // few moments so far: her round birthdays give the journey its rhythm
    for (let n = 10; n <= 50; n += 10) {
      const b = new Date(S.birth), d = new Date(b.getFullYear() + n, b.getMonth(), b.getDate(), 12).getTime();
      if (d < S.death && d <= S.t && !list.some(i => Math.abs(i._t - d) < YEAR / 2)) list.push({ id: 'auto' + n, auto: true, title: `${n}. Geburtstag`, date: new Date(d).toISOString().slice(0, 10), _t: d, cat: 'freude' });
    }
    list.sort((a, b) => a._t - b._t);
  }
  return [...list, { finale: true }];      // not called "end": time spans carry an end date under that name
}
function startJourney(from = 0) {
  if (S.view !== 'space') setView('space');
  $$('.panel').forEach(p => { p.hidden = true; }); syncDock();
  Object.assign(J, { on: true, list: stations(), i: from, paused: false, failed: [] });
  document.body.classList.add('journey'); $('#play').textContent = 'Reise beenden';
  showStation();
}
function stopJourney() {
  clearTimeout(J.timer); J.on = false;
  document.body.classList.remove('journey'); $('#journey').hidden = true; $('#play').textContent = 'Ihr Leben erleben';
}
// starts (or restarts) the clock of the station on show
function arm() {
  clearTimeout(J.timer);
  const el = $('#journey'), bar = $('.bar', el);
  el.classList.toggle('paused', J.paused);
  if (bar) bar.innerHTML = J.secs ? `<i style="animation-duration:${J.secs}s"></i>` : '';
  if (J.on && J.secs && !J.paused) J.timer = setTimeout(() => { J.i++; showStation(); }, J.secs * 1000);
}
// one moment that cannot be shown must not end the journey: it is skipped
function showStation() {
  try { drawStation(); } catch (e) {
    console.error(e);
    (J.failed ||= []).push(`${J.list[J.i]?.title || '?'}: ${e?.message || e}`);
    if (J.i < J.list.length - 1) { J.i++; showStation(); } else stopJourney();
  }
}
function drawStation() {
  clearTimeout(J.timer);
  const o = J.list[J.i], el = $('#journey'), n = J.list.length;
  let h, secs;
  if (o.finale) {
    goHome(); S.sel = null;
    cam.target = clampScale(fit(Math.max((S.t - S.birth) / YEAR, 20) * 1.08, W, H));
    h = `<div class="jbody"><div><p class="meta">In diesem Augenblick</p><h3>Ihr Licht reist weiter</h3>
      <p>Jeder dieser Momente ist noch unterwegs. Gerade jetzt sehen ${litStars().length} Sterne dieser Karte Anna - jeder an einem anderen Tag ihres Lebens -, und mit jeder Sekunde kommen 299.792 Kilometer hinzu.</p>
      <p class="muted">Nichts davon geht verloren.</p>${J.failed?.length ? `<p class="fine">${J.failed.length} ${J.failed.length === 1 ? 'Moment konnte' : 'Momente konnten'} nicht gezeigt werden (${esc(J.failed.slice(0, 3).join('; '))}). Bitte diese Zeile weitergeben.</p>` : ''}</div></div>`;
    secs = 0;
  } else {
    S.sel = o; cam.focus = o; cam.touched = performance.now();
    cam.target = clampScale(fit(o._e ? Math.max(8, (Math.min(o._e, S.t) - o._t) / YEAR * 0.8) : 8, W, H));
    const d = (S.t - o._t) / YEAR, by = S.stars.map(s => [Math.abs(s.d - d), s]).sort((a, b) => a[0] - b[0])[0], next = S.stars.find(s => s.d > d);
    const where = o._e ? `Das Licht dieser Zeit füllt den Raum zwischen <b>${fmtDist(Math.max(0, (S.t - o._e) / YEAR))}</b> und <b>${fmtDist(d)}</b> Entfernung.`
      : by && by[0] < 0.75 ? `Dieses Licht ist jetzt <b>${fmtDist(d)}</b> entfernt - gerade bei <b>${esc(by[1].n)}</b>.`
        : `Dieses Licht ist jetzt <b>${fmtDist(d)}</b> entfernt${next ? ` und erreicht in ${dur((next.d - d) * YEAR)} <b>${esc(next.n)}</b>` : ''}.`;
    const ph = o.photos || [];
    // the whole photo, never cut off; beside it the same photo, zoomed in and blurred, fills the space
    h = `<div class="jbody">${ph.length ? `<figure><div class="shot"><img class="blur" data-photo="${esc(ph[0])}" alt="" aria-hidden="true"><img data-photo="${esc(ph[0])}" alt=""></div>${ph.length > 1 ? `<div class="thumbs">${ph.slice(1, 5).map(p => `<img data-photo="${esc(p)}" alt="">`).join('')}</div><small>${ph.length} Fotos - antippen zum Durchblättern</small>` : ''}</figure>` : ''}
      <div><p class="meta">${J.i + 1} von ${n - 1}, ${range(o)}${inLife(o._t) && o.id !== 'birth' ? `, ${itemAge(o).replace(/^Anna war /, '').replace(/ alt\.$/, '')}` : ''}</p>
      <h3>${esc(o.title)}</h3>${o.text ? `<p class="jtext">${esc(o.text)}</p>` : ''}<p>${where}</p></div></div>`;
    secs = Math.min(26, (8 + (o.text || '').length / 28 + ph.length * 3) * (0.7 + 0.1 * weight(o)));      // more time for what matters more
  }
  el.innerHTML = `<div class="bar">${secs ? `<i style="animation-duration:${secs}s"></i>` : ''}</div>${h}
    <div class="row"><button data-j="prev" ${J.i ? '' : 'disabled'}>Zurück</button>
      ${o.finale ? '<button data-j="again">Noch einmal</button>' : `<button data-j="pause">${J.paused ? 'Abspielen' : 'Pause'}</button><button data-j="next" class="primary">Weiter</button>`}
      ${o.finale || o.auto ? '' : '<button data-j="more">Ganz ansehen</button>'}<button class="x" aria-label="Reise beenden">×</button></div>`;
  el.classList.toggle('paused', J.paused); el.hidden = false; hydrate(el); life.draw();
  const shot = $('.shot', el), pic = shot?.lastElementChild;           // the picture takes the photo's own shape, as far as there is room
  if (pic) pic.onload = () => { shot.style.aspectRatio = `${pic.naturalWidth} / ${pic.naturalHeight}`; };
  $('.x', el).onclick = stopJourney;
  $$('[data-j]', el).forEach(b => b.onclick = () => {
    const a = b.dataset.j;
    if (a === 'prev') { J.i--; showStation(); }
    else if (a === 'next') { J.i++; showStation(); }
    else if (a === 'again') { J.i = 0; J.paused = false; showStation(); }
    else if (a === 'pause') { J.paused = !J.paused; showStation(); }
    else if (a === 'more') { stopJourney(); select(o); }
  });
  J.secs = secs; J.held = false; arm();
}
$('#play').onclick = () => (J.on ? stopJourney() : startJourney());

// ---------- a short welcome for first-time visitors (again from "Über diese Seite", or with #willkommen) ----------
let afterWelcome = null;                                 // what happens once it is closed: the opening glide waits for it
function showWelcome() { $('#welcome').hidden = false; $('#welcomeGo').focus(); }
function closeWelcome(then) {
  $('#welcome').hidden = true;
  afterWelcome?.(); afterWelcome = null;
  if (then) openPanel(then);
}
$('#welcomeGo').onclick = () => closeWelcome();
$('#welcomeMore').onclick = () => closeWelcome('about');
$('#welcome').onclick = e => { if (e.target.id === 'welcome') closeWelcome(); };      // a tap beside the card
$('#welcomeAgain').onclick = showWelcome;

addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select')) return;
  if (e.key === 'Escape') { if (answer) answer(false); else if (!$('#welcome').hidden) closeWelcome(); else if (!$('#lightbox').hidden) $('#lightbox').hidden = true; else if (J.on) stopJourney(); else { $$('.panel').forEach(p => { p.hidden = true; }); syncDock(); } }
  if (!J.on) return;
  if (e.key === 'ArrowRight' && J.i < J.list.length - 1) { J.i++; showStation(); }
  if (e.key === 'ArrowLeft' && J.i > 0) { J.i--; showStation(); }
  if (e.key === ' ') { e.preventDefault(); J.paused = !J.paused; showStation(); }
});

// photos are fetched (and decrypted) on demand
const urls = new Map();
function hydrate(root) {
  for (const img of $$('img[data-photo]', root)) {
    const path = img.dataset.photo;
    (urls.get(path) || urls.set(path, store.photoBytes(path).then(b => URL.createObjectURL(new Blob([b], { type: 'image/jpeg' })))).get(path))
      .then(u => { img.src = u; }, () => { img.alt = 'Das Foto wird gerade noch veröffentlicht.'; });
    img.onclick = e => {
      if (!img.src || img.closest('#thumbs') || (img.closest('.wall'))) return;
      e.stopPropagation();
      const main = img.classList.contains('blur') ? img.nextElementSibling : img;      // the blurred copy behind a photo opens the photo itself
      const set = $$('img[data-photo]:not(.blur)', img.closest('.photos, .jbody') || root).filter(i => i.src);
      showPhoto(set.map(i => i.src), Math.max(0, set.indexOf(main)));
    };
  }
}
const LB = { list: [], i: 0 };
function showPhoto(list, i) {
  Object.assign(LB, { list, i: (i + list.length) % list.length });
  if (J.on && !J.paused) { J.paused = true; clearTimeout(J.timer); $('#journey').classList.add('paused'); const b = $('#journey [data-j=pause]'); if (b) b.textContent = 'Abspielen'; }   // looking at photos pauses the journey
  $('#lightbox img').src = LB.list[LB.i]; $('#lbcount').textContent = `${LB.i + 1} von ${list.length}`;
  $('#lightbox').classList.toggle('single', list.length < 2); $('#lightbox').hidden = false;
}
const lbImg = $('#lightbox img');
function lbStep(step) {                                // the next photo slides in from the side it comes from
  if (LB.list.length < 2) return;
  showPhoto(LB.list, LB.i + step);
  lbImg.animate?.([{ transform: `translateX(${step * 48}px)`, opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' });
}
// swiping: the photo follows the finger sideways; let go far enough and the next one comes, otherwise it springs back
let swipe = null, swiped = false;
$('#lightbox').addEventListener('pointerdown', e => {
  swiped = false;                                      // (a finger's swipe is not followed by a click, so this is reset here and not only there)
  if (!e.target.closest('button')) swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
$('#lightbox').addEventListener('pointermove', e => {
  if (!swipe || e.pointerId !== swipe.id || LB.list.length < 2) return;
  const dx = e.clientX - swipe.x;
  if (Math.abs(dx) > 8) { swiped = true; lbImg.style.transition = 'none'; lbImg.style.transform = `translateX(${dx}px)`; }
});
const endSwipe = e => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  swipe = null; lbImg.style.transition = 'transform .18s'; lbImg.style.transform = '';
  if (e.type === 'pointerup' && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { lbImg.style.transition = 'none'; lbStep(dx < 0 ? 1 : -1); }
};
$('#lightbox').addEventListener('pointerup', endSwipe); $('#lightbox').addEventListener('pointercancel', endSwipe);
$('#lightbox').onclick = e => {
  if (swiped) { swiped = false; return; }             // the end of a swipe is not a tap
  const step = e.target.closest('[data-lb]')?.dataset.lb;
  if (step && +step) lbStep(+step);
  else if (step === '0' || e.target.tagName !== 'IMG') $('#lightbox').hidden = true;
};
addEventListener('keydown', e => {
  if ($('#lightbox').hidden) return;
  if (e.key === 'ArrowRight') { e.stopImmediatePropagation(); lbStep(1); }
  if (e.key === 'ArrowLeft') { e.stopImmediatePropagation(); lbStep(-1); }
}, true);
// the saved picture gets the dark background of the page (the map itself is drawn on a see-through sheet) and a small signature
$('#savePic').onclick = () => {
  const out = Object.assign(document.createElement('canvas'), { width: cv.width, height: cv.height }), c = out.getContext('2d'), k = cv.width / cv.clientWidth;
  c.fillStyle = getComputedStyle(document.body).backgroundColor || '#070912'; c.fillRect(0, 0, out.width, out.height);
  c.drawImage(cv, 0, 0);
  c.font = `${Math.round(15 * k)}px EB Garamond, Georgia, serif`; c.textAlign = 'right'; c.fillStyle = 'rgba(233,229,220,.75)';
  c.fillText(`Annas Licht, ${fmtDate(S.t)}`, out.width - 18 * k, out.height - 16 * k);
  out.toBlob(blob => Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `annas-licht-${new Date().toISOString().slice(0, 10)}.png` }).click());
};
const lock = i => (i.vis === 'private' ? '<span class="tag">nur Familie &amp; Freunde</span>' : '');
// photos whose day nobody remembers only claim their month or year
const range = i => (i._e ? `${fmtWhen(i.date)} - ${i.end ? fmtWhen(i.end) : 'zuletzt'}` : i.approx ? (i.date.endsWith('-07-01') ? `im Jahr ${i.date.slice(0, 4)}` : `im ${monthYear(parseWhen(i.date))}`) : fmtWhen(i.date));

// a moment or a star named in a text: a link that opens it
const itemLink = i => `<a data-item="${esc(i.id)}" tabindex="0">${esc(i.title)}</a>`;
const starLink = s => `<a data-star="${esc(s.n)}" tabindex="0">${esc(s.n)}</a>`;
function bindLinks(root) {
  for (const a of $$('a[data-item], a[data-star]', root)) {
    const open = e => {
      e.preventDefault(); e.stopPropagation();
      const o = a.dataset.item ? S.items.find(i => i.id === a.dataset.item) : S.stars.find(s => s.n === a.dataset.star);
      if (o) follow(o, a.closest('#p-soon') ? { panel: 'soon', title: '„Heute bei Anna“' } : S.sel);
    };
    a.onclick = open; a.onkeydown = e => { if (e.key === 'Enter') open(e); };
  }
}
const along = fn => { following = true; try { fn(); } finally { following = false; } };
// a star chosen in a list or by a link: open it, and on the map also fly there and look at it up close
function showStar(s) { select(s); if (s?.kind === 'star' && S.view === 'space') flyTo(s); }
const choose = o => (o?.kind === 'star' ? showStar(o) : select(o));
function follow(o, from) {
  if (from && from !== o) trail = [...trail.slice(-40), from];
  along(() => choose(o));
}
function goBack() {
  const from = trail.pop();
  if (!from) return;
  along(() => {
    if (from.panel) { S.sel = null; shareHash(); closePanel('detail'); renderDetail(); openPanel(from.panel); }
    else if (from.kind === 'year') selectYear(from._t);
    else choose(from.id ? S.items.find(i => i.id === from.id) || from : from);     // a moment may have been edited since
  });
}
const backButton = () => {
  const from = trail.at(-1);
  return from ? `<p style="margin-top:0"><button id="back" style="padding:4px 10px;font-size:13px">Zurück zu ${esc(from.n || from.name || from.title)}</button></p>` : '';
};

// ---------- detail ----------
function renderDetail() {
  const o = S.sel, el = $('#p-detail .body'), t = S.t;
  life.draw();
  if (o?.kind === 'year') return renderYear();
  if (!o) { $('#p-detail h2').textContent = 'Auswahl'; el.innerHTML = '<p class="muted">Tippe auf einen Stern oder einen Moment.</p>'; return; }
  $('#p-detail h2').textContent = o.n || o.name || o.title;
  let h = '';
  if (o._t) {                                                         // a moment or a span of time
    const d = (t - o._t) / YEAR, dEnd = o._e ? Math.max(0, (t - o._e) / YEAR) : d;
    h += `<p><span class="tag">${esc((CATS[o.cat] || CATS.sonst)[0])}</span>${lock(o)}</p><p>${range(o)}</p>`;
    if (store.canEdit(o)) h += '<p><button id="editSel" class="primary">Diesen Moment bearbeiten</button></p>';
    else if (o.fixed && store.state.session?.role === 'admin') h += '<p><button id="editBase">Datum ändern</button></p>';
    if (inLife(o._t)) h += `<p>${itemAge(o)}</p>`;
    if (o.text) h += `<p>${esc(o.text).replace(/\n/g, '<br>')}</p>`;
    if (d <= 0) h += '<p class="muted">Dieser Moment liegt von hier aus gesehen noch in der Zukunft.</p>';
    else if (o._e) {
      const seen = S.stars.filter(s => s.d <= d && s.d >= dEnd);
      h += `<p>Das Licht dieser Zeit füllt gerade die Kugelschale zwischen <b>${fmtDist(dEnd)}</b> und <b>${fmtDist(d)}</b> Entfernung.</p>`;
      if (seen.length) h += `<p>Diese Zeit ist jetzt zu sehen von: ${seen.slice(0, 12).map(starLink).join(', ')}${seen.length > 12 ? ' und weiteren' : ''}.</p>`;
    } else {
      h += `<p>Das Licht dieses Augenblicks ist jetzt <b>${fmtDist(d)}</b> von der Erde entfernt.</p>`;
      const past = S.stars.filter(s => s.d <= d).pop(), next = S.stars.find(s => s.d > d);
      if (past) h += `<p>Zuletzt erreichte es <b>${starLink(past)}</b> - vor ${dur((d - past.d) * YEAR)}.</p>`;
      if (next) h += `<p>Als Nächstes kommt es bei <b>${starLink(next)}</b> an - in ${dur((next.d - d) * YEAR)}.</p>`;
    }
    if (d > 0 && S.view === 'space') h += '<p><button id="fly">Näher ansehen</button></p>';
    if (o.by) h += `<p class="muted">Hinzugefügt von ${esc(o.by)}</p>`;
    if (o.vis === 'public') h += '<p><button id="share">Link teilen</button></p>';
    // the photos come last, so that nothing is hidden below them
    if (o.photos?.length) h += `<div class="photos big" style="margin-top:14px">${o.photos.map(p => `<figure><img data-photo="${esc(p)}" alt=""></figure>`).join('')}</div>`;
  } else {                                                            // a star, a planet, a probe
    const d = o.d, seen = t - d * YEAR, star = o.kind === 'star';
    h += `<p class="muted">${star && o.con ? `Sternbild ${esc(o.con)}, ` : ''}${fmtDist(d)} entfernt</p>`;
    if (o.hz) h += `<p>Um diesen Stern kreist ${o.hz.length > 1 ? `mehr als ein Planet` : 'ein Planet'} in der lebensfreundlichen Zone (${esc(o.hz.join(', '))})${o.pl > o.hz.length ? ` - insgesamt kennt man dort ${o.pl} Planeten` : ''}.</p>`;
    else if (o.pl) h += `<p>Um diesen Stern ${o.pl === 1 ? 'kreist ein bekannter Planet' : `kreisen ${o.pl} bekannte Planeten`}.</p>`;
    if (seen < S.birth) {
      h += `<p>Annas erstes Licht ist noch auf dem Weg hierher. Es kommt in <b>${dur(S.birth - seen)}</b> an - am ${fmtDate(S.birth + d * YEAR)}.</p>`;
    } else if (seen > S.death) {
      h += `<p>Annas Licht ist hier schon vorbeigezogen - ihr letztes Licht kam am ${fmtDate(S.death + d * YEAR)} an. Es reist weiter hinaus zu den Sternen.</p>`;
    } else {
      h += `<p>Von hier aus gesehen ist auf der Erde jetzt der <b>${fmtDate(seen)}</b>. ${age(seen)}</p>`;
      const spans = S.items.filter(i => i._e && i._t <= seen && seen <= i._e);
      for (const i of spans) h += `<p>Dort läuft gerade <b>${itemLink(i)}</b>: ${spanWhere(i, seen)}.</p>`;
      const soon = S.items.find(i => i._e && i._t > seen);
      if (soon) h += `<p>Demnächst beginnt dort <b>${itemLink(soon)}</b> - in ${dur(soon._t - seen)}.</p>`;
      const ev = S.items.filter(i => !i._e && !i.photoOnly), prev = ev.filter(i => i._t <= seen).pop(), next = ev.find(i => i._t > seen);
      if (prev) h += `<p>Zuletzt hier angekommen: ${itemLink(prev)} - vor ${dur(seen - prev._t)}.</p>`;
      if (next) h += `<p>Als Nächstes zu sehen: <b>${itemLink(next)}</b> - in ${dur(next._t - seen)}.</p>`;
      if (star) h += `<p class="muted">Und das Licht, das heute Nacht von ${esc(o.n)} bei uns ankommt, ist an genau diesem Tag dort aufgebrochen.</p>`;
    }
    if (star && S.view === 'sky') {
      const [alt, az] = starAltAz(o, S.skyT ?? Date.now());
      h += alt > 2 ? `<p>Steht gerade ${Math.round(alt)}° hoch im ${['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'][Math.round(az / 45) % 8]}.</p>`
        : '<p class="muted">Steht zu dieser Uhrzeit unter dem Horizont.</p>';
    }
    if (S.view === 'space') h += '<p><button id="fly">Näher ansehen</button></p>';
    if (star) h += o.mag <= 6
      ? `<p><button id="toSky">${S.view === 'sky' ? 'Im Weltraum zeigen' : 'Am Nachthimmel zeigen'}</button> <span class="muted">mit bloßem Auge sichtbar</span></p>`
      : '<p class="muted">Zu lichtschwach für das bloße Auge.</p>';
    h += '<p><button id="share">Link teilen</button></p>';
  }
  el.innerHTML = backButton() + h; hydrate(el); bindLinks(el);
  if ($('#back', el)) $('#back', el).onclick = goBack;
  if ($('#toSky')) $('#toSky').onclick = () => switchView(S.view === 'sky' ? 'space' : 'sky', renderDetail);
  if ($('#editSel')) $('#editSel').onclick = () => editItem(o);
  if ($('#editBase')) $('#editBase').onclick = () => { openPanel('login'); $('#person')?.scrollIntoView(); };
  if ($('#fly')) $('#fly').onclick = () => flyTo(o);
  if ($('#share')) $('#share').onclick = async e => { const done = await shareLink(o.n || o.name || o.title); if (done) e.target.textContent = done; };
}

// ---------- arrivals ----------
function arrivals() {
  const out = [];
  // the day of arrival only means something when the day is known
  for (const i of S.items) if (!i.photoOnly && !partial(i.date)) for (const s of S.stars) out.push({ i, s, at: i._t + s.d * YEAR, text: `${i._e ? 'Beginn: ' : ''}${i.title} erreicht ${s.n}` });
  return out;
}
function renderSoon() {
  const t = S.t, all = arrivals(), el = $('#p-soon .body');
  const row = (a, w) => `<li data-star="${esc(a.s.n)}"><span class="swatch" style="background:${catColor(a.i.cat)}"></span><div><span class="when">${w} ${dur(a.at - t)}</span><br>${a.i._e ? 'Beginn: ' : ''}${itemLink(a.i)} erreicht ${esc(a.s.n)}</div></li>`;
  const next = all.filter(a => a.at > t).sort((a, b) => a.at - b.at).slice(0, 8);
  const last = all.filter(a => a.at <= t).sort((a, b) => b.at - a.at).slice(0, 4);
  // tonight: the three highest naked-eye stars that are watching her right now
  const night = S.skyT ?? Date.now();
  const up = litStars().filter(s => s.mag <= 4.5).map(s => [starAltAz(s, night)[0], s]).filter(x => x[0] > 15).sort((a, b) => b[0] - a[0]).slice(0, 3);
  const tonight = up.map(([, s]) => `<li data-sky="${esc(s.n)}"><span class="dot lit"></span><div>${esc(s.n)}<small>sieht gerade den ${fmtDate(t - s.d * YEAR)} - ${age(t - s.d * YEAR).replace(/\.$/, '')}</small></div></li>`).join('');
  // anniversaries within the next 30 days
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const days = S.items.filter(i => !i._e && !i.photoOnly && !partial(i.date) && i._t < today.getTime()).map(i => {
    const d = new Date(i._t), next = new Date(today.getFullYear(), d.getMonth(), d.getDate(), 12);
    if (next < today) next.setFullYear(next.getFullYear() + 1);
    return { i, inDays: Math.round((next - today) / 864e5), years: next.getFullYear() - d.getFullYear() };
  }).filter(a => a.inDays <= 30 && a.years >= 1).sort((a, b) => a.inDays - b.inDays);
  const annRow = a => `<li data-id="${esc(a.i.id)}"><span class="swatch" style="background:${catColor(a.i.cat)}"></span><div><span class="when">${a.inDays === 0 ? 'Heute' : a.inDays === 1 ? 'Morgen' : `In ${a.inDays} Tagen`}</span><br>
    ${a.i.id === 'birth' ? `Annas ${a.years}. Geburtstag` : `${esc(a.i.title)} - ${a.inDays === 0 ? 'heute' : 'dann'} vor ${a.years} ${a.years === 1 ? 'Jahr' : 'Jahren'}`}</div></li>`;
  $('#dock [data-panel=soon]').classList.toggle('dot', days.some(a => a.inDays === 0) || next.some(a => a.at - t < 864e5));
  el.innerHTML = `${tonight ? `<h3 style="margin-top:0">Heute Nacht am Himmel</h3><ul class="list">${tonight}</ul>` : ''}
    ${days.length ? `<h3>Jahrestage</h3><ul class="list">${days.map(annRow).join('')}</ul>` : ''}
    <h3>Wo ihr Licht demnächst ankommt</h3><ul class="list">${next.map(a => row(a, 'in')).join('')}</ul>
    <h3>Gerade angekommen</h3><ul class="list">${last.map(a => row(a, 'vor')).join('') || '<li class="muted">Noch nichts.</li>'}</ul>
    <p><button id="ics">Als Kalender speichern</button></p>
    <p class="fine">Lädt die Ankünfte der nächsten zwei Jahre als Kalender-Datei herunter - zum Öffnen im Handy- oder Computer-Kalender.</p>`;
  $$('li[data-star]', el).forEach(li => li.onclick = () => showStar(S.stars.find(s => s.n === li.dataset.star)));
  $$('li[data-sky]', el).forEach(li => li.onclick = () => switchView('sky', () => select(S.stars.find(s => s.n === li.dataset.sky))));
  $$('li[data-id]', el).forEach(li => li.onclick = () => select(S.items.find(i => i.id === li.dataset.id)));
  bindLinks(el);
  $('#ics').onclick = () => {
    const now = Date.now(), z = n => String(n).padStart(2, '0'), day = d => `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}`;
    const ev = arrivals().filter(a => a.at > now && a.at < now + 2 * YEAR).sort((a, b) => a.at - b.at).map(a => {
      const d = new Date(a.at), e = new Date(a.at + 864e5);
      return `BEGIN:VEVENT\r\nUID:${a.i.id}-${a.s.n.replace(/\W/g, '')}@annas-licht\r\nDTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d+/g, '')}\r\nDTSTART;VALUE=DATE:${day(d)}\r\nDTEND;VALUE=DATE:${day(e)}\r\nSUMMARY:Annas Licht: ${a.text.replace(/[,;]/g, ' ')}\r\nEND:VEVENT\r\n`;
    });
    const blob = new Blob([`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Annas Licht//DE\r\n${ev.join('')}END:VCALENDAR\r\n`], { type: 'text/calendar' });
    Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'annas-licht.ics' }).click();
  };
}

// ---------- moments: list + form ----------
let momentsTab = 'list', momentsFind = '', momentsSort = 'time';
let momentsCat = '';                 // show only one theme ('' = all)
let momentsRev = false;               // false: oldest event first / newest entry first; true: the other way round
try { momentsSort = localStorage.getItem('annas-licht-sortierung') || 'time'; momentsRev = localStorage.getItem('annas-licht-umgekehrt') === '1'; } catch { /* ignore */ }
function renderMoments() {
  const el = $('#p-moments .body'), can = store.canWrite();
  const withPhotos = S.items.filter(i => i.photos?.length), find = momentsFind.trim().toLowerCase();
  const themeOf = i => (CATS[i.cat] ? i.cat : 'sonst');
  if (momentsCat && !CATS[momentsCat]) momentsCat = '';
  const shown = S.items.filter(i => (!momentsCat || themeOf(i) === momentsCat) && (!find || (i.title + ' ' + (i.text || '') + ' ' + i.date.slice(0, 4)).toLowerCase().includes(find)));
  // in the order things happened, or the newest entries first
  if (momentsSort === 'added') shown.sort((a, b) => (b.updated || '').localeCompare(a.updated || '') || a._t - b._t);
  if (momentsRev) shown.reverse();
  const dirText = momentsSort === 'time' ? (momentsRev ? 'neueste zuerst' : 'älteste zuerst') : (momentsRev ? 'älteste Einträge zuerst' : 'neueste Einträge zuerst');
  const sorter = S.items.length > 3 ? `<div class="tabs" style="margin-top:4px"><span class="muted" style="font:13px var(--sans);align-self:center">Reihenfolge:</span>
    <button data-sort="time" class="${momentsSort === 'time' ? 'on' : ''}">wann es geschah</button><button data-sort="added" class="${momentsSort === 'added' ? 'on' : ''}">zuletzt hinzugefügt</button></div>
    <label style="margin:-4px 0 10px">Thema<select id="catFilter"><option value="">Alle Themen (${S.items.length})</option>${Object.entries(CATS).map(([k, [n]]) => `<option value="${k}" ${k === momentsCat ? 'selected' : ''}>${esc(n)} (${S.items.filter(i => themeOf(i) === k).length})</option>`).join('')}</select></label>
    <p style="margin:-6px 0 8px"><button id="sortDir" style="padding:4px 10px;font-size:13px" title="Reihenfolge umkehren">${dirText} - umkehren</button></p>` : '';
  const tools = `${withPhotos.length ? `<div class="tabs"><button data-tab="list" class="${momentsTab === 'list' ? 'on' : ''}">Alle Momente</button><button data-tab="wall" class="${momentsTab === 'wall' ? 'on' : ''}">Fotos (${withPhotos.reduce((n, i) => n + i.photos.length, 0)})</button></div>` : ''}
    ${S.items.length > 6 && momentsTab === 'list' ? `<input type="text" id="find" placeholder="Suchen - z. B. Hochzeit oder 1998" value="${esc(momentsFind)}" style="margin-bottom:8px">` : ''}`;
  if (momentsTab === 'wall' && withPhotos.length) {
    el.innerHTML = tools + `<div class="photos wall">${withPhotos.flatMap(i => i.photos.map(p => `<figure data-id="${esc(i.id)}"><img data-photo="${esc(p)}" alt="" loading="lazy"><figcaption>${i.date.slice(0, 4)}, ${esc(i.title)}</figcaption></figure>`)).join('')}</div>`;
    hydrate(el);
    $$('figure[data-id]', el).forEach(f => { $('img', f).onclick = () => select(S.items.find(i => i.id === f.dataset.id)); });
    $$('[data-tab]', el).forEach(b => b.onclick = () => { momentsTab = b.dataset.tab; renderMoments(); });
    return;
  }
  momentsTab = 'list';
  // the invitation to add memories is only for those not logged in; an account that may only look does not hear of other accounts
  el.innerHTML = (can ? '<p class="row"><button class="primary" id="add">Einen Moment hinzufügen</button><button id="addPhotos">Nur Fotos hinzufügen</button></p>'
    : store.state.session ? '' : '<p class="muted">Wer Anna kannte, kann hier eigene Erinnerungen hinzufügen - dafür bitte unten auf „Anmelden“ tippen.</p>')
    + tools + sorter + (shown.length ? '' : '<p class="muted">Zu dieser Auswahl gibt es keine Momente.</p>') + `<ul class="list">${shown.map(i => `<li data-id="${esc(i.id)}"><span class="swatch ${i._e ? 'span' : ''}" style="background:${catColor(i.cat)}"></span>
      <div style="flex:1">${esc(i.title)} ${lock(i)}<small><span class="tag" style="color:${catColor(i.cat)}">${esc(CATS[themeOf(i)][0])}</span>${range(i)}${i.photos?.length ? `, ${i.photos.length} Foto${i.photos.length > 1 ? 's' : ''}` : ''}</small></div>
      ${store.canEdit(i) ? `<button data-edit="${esc(i.id)}" style="padding:4px 10px;font-size:13px">Bearbeiten</button>` : ''}</li>`).join('')}</ul>`;
  $$('li[data-id]', el).forEach(li => li.onclick = () => select(S.items.find(i => i.id === li.dataset.id)));
  $$('[data-tab]', el).forEach(b => b.onclick = () => { momentsTab = b.dataset.tab; renderMoments(); });
  $$('[data-sort]', el).forEach(b => b.onclick = () => { momentsSort = b.dataset.sort; try { localStorage.setItem('annas-licht-sortierung', momentsSort); } catch { /* ignore */ } renderMoments(); });
  if ($('#catFilter')) $('#catFilter').onchange = e => { momentsCat = e.target.value; renderMoments(); };
  if ($('#sortDir')) $('#sortDir').onclick = () => { momentsRev = !momentsRev; try { localStorage.setItem('annas-licht-umgekehrt', momentsRev ? '1' : ''); } catch { /* ignore */ } renderMoments(); };
  $$('[data-edit]', el).forEach(b => b.onclick = e => { e.stopPropagation(); editItem(S.items.find(i => i.id === b.dataset.edit)); });
  if ($('#find')) $('#find').oninput = e => { momentsFind = e.target.value; renderMoments(); const f = $('#find'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); };
  if (can) { $('#add').onclick = () => editItem(null); $('#addPhotos').onclick = addPhotos; }
}

async function prepPhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }), k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));      // upright, as the camera meant it
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error(`Das Foto „${file.name}“ konnte nicht verarbeitet werden.`);
  return new Uint8Array(await blob.arrayBuffer());
}

function editItem(item) {
  openPanel('moments');
  const el = $('#p-moments .body'), i = item || { vis: 'private', cat: 'sonst', photos: [] };
  let keep = [...(i.photos || [])];
  const removed = [], fresh = [];        // fresh: newly picked files, collected over as many picks as one likes
  const [d0, t0] = (i.date || '').split('T'), [d1, t1] = (i.end || '').split('T');
  el.innerHTML = `<form>
    <label>Was ist passiert?<input type="text" name="title" required maxlength="80" value="${esc(i.title)}" placeholder="z. B. Unsere Hochzeit"></label>
    <div class="choice">
      <label><input type="radio" name="period" value="" ${i.period ? '' : 'checked'}><span>Ein Moment<small>ein bestimmter Tag</small></span></label>
      <label><input type="radio" name="period" value="1" ${i.period ? 'checked' : ''}><span>Ein Zeitraum<small>z. B. Schulzeit, ein Beruf, eine Reise</small></span></label>
    </div>
    <div class="two"><label><span data-l="from">Wann?</span>${dateInput('date', d0, true, 'TT.MM.JJJJ oder JJJJ')}</label>
      <label>Uhrzeit (wenn bekannt)${timeInput('time', t0)}</label></div>
    <div class="two" data-end><label>Bis wann?${dateInput('end', d1, false, 'TT.MM.JJJJ oder JJJJ')}</label>
      <label>Uhrzeit (wenn bekannt)${timeInput('endtime', t1)}</label></div>
    <p class="muted" style="margin:-6px 0 0">Tag und Monat dürfen fehlen: Nur das Jahr (1976) oder Monat und Jahr (08.1976) genügen.<span data-end> „Bis wann“ leer lassen, wenn der Zeitraum bis zuletzt andauerte.</span></p>
    <label>Thema<select name="cat">${Object.entries(CATS).map(([k, [n]]) => `<option value="${k}" ${k === (CATS[i.cat] ? i.cat : 'sonst') ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
    <label>Wie wichtig ist dieser Moment? <span id="impWord" style="color:var(--text)"></span>
      <input type="range" name="imp" min="1" max="5" step="1" value="${i.imp || 1}" style="accent-color:var(--gold)">
      <span style="display:flex;justify-content:space-between;font-size:12.5px"><span>eine Kleinigkeit</span><span>ein Lebensereignis</span></span></label>
    <label>Ein paar Worte dazu<textarea name="text" maxlength="4000" placeholder="Was möchtest du erzählen?">${esc(i.text)}</textarea></label>
    <label>Fotos hinzufügen - gern mehrere, auch nach und nach<input type="file" name="photos" accept="image/*" multiple></label>
    <p class="muted" id="photoHint" style="margin:-8px 0 0" hidden></p>
    <div class="photos" id="thumbs"></div>
    <div class="choice">
      <label><input type="radio" name="vis" value="private" ${i.vis !== 'public' ? 'checked' : ''}><span>Nur für Familie &amp; Freunde<small>verschlüsselt, nur mit Anmeldung sichtbar</small></span></label>
      <label><input type="radio" name="vis" value="public" ${i.vis === 'public' ? 'checked' : ''}><span>Für alle Besucher<small>öffentlich im Internet sichtbar</small></span></label>
    </div>
    <p class="status"></p>
    <div class="row"><button class="primary">Speichern</button><button type="button" id="cancel">Abbrechen</button>
      ${item ? '<button type="button" class="danger" id="del">Löschen</button>' : ''}</div>
  </form>`;
  const form = $('form', el), status = $('.status', el);
  const thumbs = () => {
    $('#thumbs').innerHTML = keep.map(p => `<figure><img data-photo="${esc(p)}" alt=""><button type="button" data-rm="${esc(p)}" aria-label="Foto entfernen">×</button></figure>`).join('')
      + fresh.map((f, n) => `<figure class="new"><img src="${f.url}" alt="" title="Neu - wird beim Speichern hochgeladen"><button type="button" data-rmnew="${n}" aria-label="Foto doch nicht hinzufügen">×</button></figure>`).join('');
    hydrate($('#thumbs'));
    $$('[data-rm]', el).forEach(b => b.onclick = () => { removed.push(b.dataset.rm); keep = keep.filter(p => p !== b.dataset.rm); thumbs(); });
    $$('[data-rmnew]', el).forEach(b => b.onclick = () => { URL.revokeObjectURL(fresh.splice(+b.dataset.rmnew, 1)[0].url); thumbs(); });
  };
  const toggle = () => $$('[data-end]', el).forEach(n => { n.hidden = !form.period.value; $('[data-l=from]', el).textContent = form.period.value ? 'Von wann?' : 'Wann?'; });
  $$('[name=period]', el).forEach(r => r.onchange = toggle);
  const impWord = () => { $('#impWord').textContent = '- ' + WEIGHTS[form.imp.value - 1]; };
  form.imp.oninput = impWord; impWord();
  // a chosen photo often knows when it was taken: from the camera's record or from its file name
  form.photos.onchange = async () => {
    const hint = $('#photoHint'), picked = [...form.photos.files];
    for (const file of picked) fresh.push({ file, url: URL.createObjectURL(file) });
    form.photos.value = ''; thumbs();
    for (const file of picked) {
      const got = await photoTime(file, S.birth, S.death).catch(() => null);
      if (!got) continue;
      const when = showDate(got.date) + (got.time ? `, ${got.time} Uhr` : '');
      const take = () => { form.date.value = showDate(got.date); if (got.time) form.time.value = got.time; hint.textContent = `Datum aus ${got.source} übernommen: ${when}. Bitte kurz prüfen.`; };
      hint.hidden = false;
      if (!form.date.value.trim()) take();
      else if (readDate(form.date.value) !== got.date) { hint.innerHTML = `Dieses Foto ist laut ${got.source} vom ${when}. <a>Dieses Datum übernehmen</a>`; $('a', hint).onclick = take; }
      else if (got.time && !form.time.value.trim()) { form.time.value = got.time; hint.textContent = `Uhrzeit aus ${got.source} übernommen: ${got.time} Uhr.`; }
      else hint.hidden = true;
      return;
    }
    hint.hidden = true;
  };
  thumbs(); toggle();
  const snapshot = () => JSON.stringify([[...new FormData(form)].filter(([k]) => k !== 'photos').map(([k, v]) => [k, String(v)]), fresh.length, removed.length]);
  const before = snapshot();
  form.dirty = () => snapshot() !== before;
  const busy = on => $$('button', form).forEach(b => { b.disabled = on; });
  const fail = e => { busy(false); status.className = 'status err'; status.textContent = 'Das hat leider nicht geklappt: ' + (e.message || e.name || 'unbekannter Fehler'); console.error(e); };
  $('#cancel').onclick = async () => { if (await mayLeave(form)) renderMoments(); };
  if (item) $('#del').onclick = async () => {
    if (!confirm(`„${item.title}“ wirklich löschen?`)) return;
    busy(true); status.textContent = 'Wird gelöscht ...';
    try { await store.deleteItem(item); S.sel = null; rebuild(); } catch (e) { fail(e); }
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const f = form, withTime = (d, t) => (d && t ? `${d}T${t}` : d), bad = m => { status.className = 'status err'; status.textContent = m; };
    const date = readWhen(f.date.value), time = readTime(f.time.value);
    const end = f.period.value ? readWhen(f.end.value) : '', endtime = f.period.value ? readTime(f.endtime.value) : '';
    if (!date || end === null) return bad('Bitte das Datum als Tag.Monat.Jahr eingeben, zum Beispiel 23.05.1998 - oder nur Monat und Jahr (05.1998) oder nur das Jahr (1998).');
    if (time === null || endtime === null) return bad('Bitte die Uhrzeit mit 24 Stunden eingeben, zum Beispiel 14:30.');
    if ((time && partial(date)) || (endtime && partial(end))) return bad('Eine Uhrzeit passt nur zu einem Datum mit Tag. Bitte den Tag ergänzen oder die Uhrzeit leer lassen.');
    if (end && parseWhen(withTime(end, endtime), 'end') < parseWhen(withTime(date, time), 'start')) return bad('Das Ende liegt vor dem Anfang.');
    busy(true); status.className = 'status'; status.textContent = 'Wird gespeichert ... das dauert einen Augenblick.';
    try {
      const photos = [];
      for (const { file } of fresh) photos.push(await prepPhoto(file));
      const { _t, _e, ...base } = i;
      const saved = await store.saveItem({
        ...base, title: f.title.value.trim(), date: withTime(date, time), period: !!f.period.value,
        end: withTime(end, endtime), photoOnly: !!base.photoOnly && f.title.value.trim() === 'Fotos', approx: !!base.approx && withTime(date, time) === base.date, cat: f.cat.value, imp: +f.imp.value, text: f.text.value.trim(), vis: f.vis.value, photos: keep,
      }, photos, removed);
      rebuild(); select(S.items.find(x => x.id === saved.id));
    } catch (err) { fail(err); }
  };
}

// ---------- photos without a story: each finds its place on the lifeline by its date ----------
// "23.05.1998", or just "05.1998" or "1998" when nobody remembers the day
function looseDate(text) {
  const s = text.trim(), full = readDate(s);
  if (full) return { date: full, approx: false };
  let m = /^(0?[1-9]|1[0-2])[.\/ -]((?:19|20)\d{2})$/.exec(s);
  if (m) return { date: `${m[2]}-${m[1].padStart(2, '0')}-15`, approx: true };
  m = /^((?:19|20)\d{2})$/.exec(s);
  return m ? { date: `${m[1]}-07-01`, approx: true } : null;
}
function addPhotos() {
  openPanel('moments');
  const el = $('#p-moments .body'), rows = [];          // { file, url, date (German text), time }
  el.innerHTML = `<form>
    <p>Fotos brauchen keine Geschichte. Jedes findet seinen Platz über das Datum - das wird, wenn möglich, aus dem Foto gelesen.</p>
    <label>Fotos auswählen - gern viele auf einmal<input type="file" name="photos" accept="image/*" multiple></label>
    <div id="rows"></div>
    <div class="choice">
      <label><input type="radio" name="vis" value="private" checked><span>Nur für Familie &amp; Freunde<small>verschlüsselt, nur mit Anmeldung sichtbar</small></span></label>
      <label><input type="radio" name="vis" value="public"><span>Für alle Besucher<small>öffentlich im Internet sichtbar</small></span></label>
    </div>
    <p class="status"></p>
    <div class="row"><button class="primary">Fotos speichern</button><button type="button" id="cancel">Abbrechen</button></div>
  </form>`;
  const form = $('form', el), status = $('.status', el);
  const draw = () => {
    $('#rows').innerHTML = rows.map((r, n) => `<div class="photorow"><img src="${r.url}" alt="">
      <label>${r.found ? 'Aufgenommen am' : 'Wann war das? Der Tag, der Monat oder nur das Jahr'}<input type="text" inputmode="numeric" data-n="${n}" value="${esc(r.date)}" placeholder="TT.MM.JJJJ oder nur JJJJ" autocomplete="off"></label>
      <button type="button" data-rm="${n}" aria-label="Foto doch nicht hinzufügen">×</button></div>`).join('');
    $$('#rows input', el).forEach(i => i.oninput = () => { rows[+i.dataset.n].date = i.value; rows[+i.dataset.n].time = ''; });
    $$('#rows [data-rm]', el).forEach(b => b.onclick = () => { URL.revokeObjectURL(rows.splice(+b.dataset.rm, 1)[0].url); draw(); });
  };
  form.photos.onchange = async () => {
    for (const file of [...form.photos.files]) {
      const got = await photoTime(file, S.birth, S.death).catch(() => null);
      rows.push({ file, url: URL.createObjectURL(file), date: got ? showDate(got.date) : '', time: got?.time || '', found: !!got });
    }
    form.photos.value = ''; draw();
  };
  form.dirty = () => rows.length > 0;
  $('#cancel').onclick = async () => { if (await mayLeave(form)) renderMoments(); };
  form.onsubmit = async e => {
    e.preventDefault();
    const bad = m => { status.className = 'status err'; status.textContent = m; };
    if (!rows.length) return bad('Bitte zuerst Fotos auswählen.');
    const days = new Map();                               // photos of the same day belong together
    for (const r of rows) {
      const d = looseDate(r.date);
      if (!d) return bad('Bitte bei jedem Foto ein Datum eintragen - notfalls nur das Jahr, zum Beispiel 1998.');
      if (parseWhen(d.date) < S.birth - 864e5 || parseWhen(d.date) > Date.now()) return bad(`Das Datum ${r.date} liegt außerhalb der Zeit, die diese Seite zeigt.`);
      if (!days.has(d.date)) days.set(d.date, { ...d, time: r.time, files: [] });
      days.get(d.date).files.push(r.file);
    }
    $$('button', form).forEach(b => { b.disabled = true; });
    status.className = 'status'; status.textContent = 'Wird gespeichert ... bei vielen Fotos dauert das einen Moment.';
    try {
      const vis = form.vis.value, entries = [];
      let joined = 0;
      for (const d of days.values()) {
        const newPhotos = [];
        for (const file of d.files) newPhotos.push(await prepPhoto(file));
        // a moment of that very day, with the same visibility, takes the photos in; otherwise they stand for themselves
        const host = d.approx ? null : S.items.find(i => !i._e && !i.fixed && i.date.slice(0, 10) === d.date && i.vis === vis && store.canEdit(i));
        if (host) { const { _t, _e, ...base } = host; entries.push({ item: base, newPhotos }); joined += d.files.length; }
        else entries.push({ item: { title: 'Fotos', date: d.time && !d.approx ? `${d.date}T${d.time}` : d.date, period: false, end: '', cat: 'sonst', imp: 1, text: '', vis, photos: [], photoOnly: true, approx: d.approx }, newPhotos });
      }
      await store.saveMany(entries);
      momentsTab = 'wall'; rebuild();
      if (joined) alert(`${joined} ${joined === 1 ? 'Foto wurde' : 'Fotos wurden'} zu einem Moment hinzugefügt, der am selben Tag stattfand.`);
    } catch (err) {
      $$('button', form).forEach(b => { b.disabled = false; });
      bad('Das hat leider nicht geklappt: ' + (err.message || err.name || 'unbekannter Fehler')); console.error(err);
    }
  };
}

// ---------- accounts ----------
const ROLES = { admin: 'Verwaltung', editor: 'Mitgestalten', viewer: 'Nur ansehen' };
// what an account can do, shown once logged in (the administration explains itself by its own sections)
const ROLE_CAN = {
  viewer: 'Mit diesem Zugang siehst du alle Erinnerungen und Fotos, auch die, die nur für Familie und Freunde sichtbar sind.',
  editor: 'Mit diesem Zugang siehst du alle Erinnerungen und Fotos, auch die, die nur für Familie und Freunde sichtbar sind. ' +
    'Unter „Momente“ kannst du eigene Momente und Fotos hinzufügen. Was du selbst eingetragen hast, kannst du dort später auch ändern oder löschen.',
};
// a password field with a button that shows what was typed, and hides it again
// (the button sits beside the label, not in it, so that its text does not become part of the field's name)
const pwField = (text, name, attrs) => `<div class="pw"><label>${text}<input type="password" name="${name}" ${attrs}></label><button type="button" class="show" aria-label="Passwort anzeigen">Anzeigen</button></div>`;
function bindPw(root) {
  $$('.pw .show', root).forEach(b => {
    const input = $('input', b.parentNode);
    b.onmousedown = e => e.preventDefault();             // the cursor stays in the field (and a phone keeps its keyboard)
    b.onclick = () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.textContent = show ? 'Verbergen' : 'Anzeigen'; b.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
    };
  });
}
function renderLogin() {
  const el = $('#p-login .body'), s = store.state.session, st = store.state;
  $('#loginBtn').textContent = s ? s.name : 'Anmelden';
  const act = async (statusEl, text, fn) => {
    statusEl.className = 'status'; statusEl.textContent = text;
    $$('button', el).forEach(b => { b.disabled = true; });
    try { await fn(); rebuild(); } catch (e) { $$('button', el).forEach(b => { b.disabled = false; }); statusEl.className = 'status err'; statusEl.textContent = e.message || e.name || 'Das hat leider nicht geklappt.'; console.error(e); }
  };
  if (!s && !st.users.users.length) {
    el.innerHTML = `<p>Diese Seite ist noch nicht eingerichtet. Mit dem ersten Zugang wird der Schlüssel erzeugt, der alle privaten Erinnerungen schützt.</p>
      <form method="post"><label>Dein Name<input type="text" name="name" required autocomplete="username"></label>
      ${pwField('Passwort (am besten ein ganzer Satz)', 'pass', 'required minlength="10" autocomplete="new-password"')}
      <label>GitHub-Zugriffstoken (nur „Contents: Read and write“ für dieses Repository)<input type="password" name="token" required autocomplete="off"></label>
      <p class="status"></p><button class="primary">Einrichten</button></form>`;
    bindPw(el);
    $('form', el).onsubmit = e => { e.preventDefault(); const f = e.target; act($('.status', el), 'Wird eingerichtet ...', () => store.setup(f.name.value, f.pass.value, f.token.value, true)); };
    return;
  }
  if (!s) {
    el.innerHTML = `<p>Mit einem Zugang siehst du alle Erinnerungen und Fotos und kannst eigene hinzufügen.</p>
      <form method="post"><label>Name<input type="text" name="name" required autocomplete="username"></label>
      ${pwField('Passwort', 'pass', 'required autocomplete="current-password"')}
      <label class="row" style="display:flex;color:var(--text)"><input type="checkbox" name="keep" checked> Auf diesem Gerät angemeldet bleiben</label>
      <p class="status"></p><button class="primary">Anmelden</button></form>
      <p class="fine">Du hast keinen Zugang? Wende dich bitte an die Familie.</p>`;
    bindPw(el);
    $('form', el).onsubmit = e => { e.preventDefault(); const f = e.target; act($('.status', el), 'Einen Moment ...', () => store.login(f.name.value, f.pass.value, f.keep.checked)); };
    return;
  }
  let h = `<p>Angemeldet als <b>${esc(s.name)}</b> <span class="tag">${ROLES[s.role] || ''}</span></p>${ROLE_CAN[s.role] ? `<p class="muted">${ROLE_CAN[s.role]}</p>` : ''}<p><button id="out">Abmelden</button></p>`;
  if (s.role === 'admin') {
    const p = st.person, [bd, bt] = p.birth.split('T'), [dd, dt] = p.death.split('T');
    h += `<h3>Zugänge</h3><ul class="list">${st.accounts.map(a => `<li style="cursor:default"><div style="flex:1">${esc(a.name)}<small>${ROLES[a.role] || ''}</small></div>
        ${a.id === s.id ? '' : `<button class="danger" data-rm="${esc(a.id)}">Entfernen</button>`}</li>`).join('')}</ul>
      <form id="newUser" method="post"><h3>Neuen Zugang anlegen</h3>
        <label>Name<input type="text" name="name" required autocomplete="off"></label>
        <label>Passwort<input type="text" name="pass" required minlength="8" autocomplete="off"></label>
        <label>Darf ...<select name="role"><option value="editor">Erinnerungen ansehen und hinzufügen</option><option value="viewer">Erinnerungen nur ansehen</option><option value="admin">alles verwalten</option></select></label>
        <p class="status"></p><button class="primary">Zugang anlegen</button></form>
      <form id="cats"><h3>Themen der Momente</h3>
        <p class="muted" style="margin-top:0">Name und Farbe ändern, die Reihenfolge mit den Pfeilen festlegen, neue Themen anlegen oder nicht gebrauchte entfernen. In dieser Reihenfolge erscheinen die Themen auch in der Auswahl beim Anlegen eines Moments.</p>
        <div id="catrows"></div>
        <p class="status"></p>
        <div class="row"><button type="button" id="catAdd">Thema hinzufügen</button><button class="primary">Themen speichern</button></div></form>
      <form id="person"><h3>Grunddaten</h3>
        ${p.placeholder ? '<p class="status err">Hier stehen noch Platzhalter - bitte die echten Daten eintragen.</p>' : ''}
        <div class="two"><label>Geboren am${dateInput('bd', bd, true)}</label><label>Uhrzeit${timeInput('bt', bt)}</label></div>
        <div class="two"><label>Letztes Licht am${dateInput('dd', dd, true)}</label><label>Uhrzeit${timeInput('dt', dt)}</label></div>
        <p class="status"></p><button class="primary">Grunddaten speichern</button></form>
      <form id="token" method="post"><h3>GitHub-Zugang erneuern</h3>
        <p class="muted" style="margin-top:0">Der Token, mit dem diese Seite speichert, läuft irgendwann ab; das Datum steht bei GitHub unter „Personal access tokens“. Danach kann niemand mehr speichern, ansehen geht weiter. Hier einen neuen Token eintragen (nur „Contents: Read and write“ für dieses Repository): Er gilt sofort für alle Zugänge, die speichern dürfen.</p>
        <label>Neuer Token<input type="password" name="token" required autocomplete="off"></label>
        <p class="status"></p><button class="primary">Token speichern</button></form>
      <p class="fine">Ein entfernter Zugang kann sich nicht mehr anmelden. Wer ganz sicher ausgesperrt werden soll, braucht zusätzlich einen neuen GitHub-Token.</p>`;
  }
  el.innerHTML = h;
  $('#out').onclick = async () => { await store.logout(); urls.clear(); rebuild(); };
  if (s.role !== 'admin') return;
  $$('[data-rm]', el).forEach(b => b.onclick = () => confirm('Diesen Zugang wirklich entfernen?') && act($('#newUser .status'), 'Wird entfernt ...', () => store.removeUser(b.dataset.rm)));
  $('#newUser').onsubmit = e => { e.preventDefault(); const f = e.target; act($('.status', f), 'Wird angelegt ...', () => store.addUser(f.name.value, f.pass.value, f.role.value)); };
  // themes: a working copy that is only written when "Themen speichern" is pressed
  const cats = Object.entries(CATS).map(([id, [name, color]]) => ({ id, name, color }));
  const used = id => S.items.filter(i => (CATS[i.cat] ? i.cat : 'sonst') === id).length;
  const drawCats = () => {
    $('#catrows').innerHTML = cats.map((c, n) => `<div class="catrow"><input type="color" data-n="${n}" value="${esc(c.color)}" aria-label="Farbe">
      <input type="text" data-n="${n}" value="${esc(c.name)}" maxlength="40" required aria-label="Name des Themas">
      <button type="button" class="mv up" data-mv="-1" data-n="${n}" ${n ? '' : 'disabled'} aria-label="Nach oben" title="Nach oben"></button>
      <button type="button" class="mv down" data-mv="1" data-n="${n}" ${n < cats.length - 1 ? '' : 'disabled'} aria-label="Nach unten" title="Nach unten"></button>
      ${c.id === 'sonst' ? '<span class="muted" style="font-size:12.5px">bleibt immer</span>' : `<button type="button" class="danger" data-n="${n}" title="${used(c.id) ? `${used(c.id)} Momente wechseln dann zu „Sonstiges“` : 'Wird nicht verwendet'}">Entfernen</button>`}</div>`).join('');
    $$('#catrows input', el).forEach(i => i.oninput = () => { cats[+i.dataset.n][i.type === 'color' ? 'color' : 'name'] = i.value; });
    $$('#catrows .mv', el).forEach(b => b.onclick = () => { const n = +b.dataset.n, m = n + +b.dataset.mv; [cats[n], cats[m]] = [cats[m], cats[n]]; drawCats(); });
    $$('#catrows button.danger', el).forEach(b => b.onclick = () => {
      const c = cats[+b.dataset.n], n = used(c.id);
      if (n && !confirm(`„${c.name}“ wird von ${n} ${n === 1 ? 'Moment' : 'Momenten'} verwendet. Diese gehören danach zu „Sonstiges“. Trotzdem entfernen?`)) return;
      cats.splice(+b.dataset.n, 1); drawCats();
    });
  };
  drawCats();
  $('#catAdd').onclick = () => { cats.push({ id: 't' + Math.random().toString(36).slice(2, 8), name: '', color: '#b9c7a0' }); drawCats(); $$('#catrows input[type=text]', el).pop().focus(); };
  $('#cats').onsubmit = e => {
    e.preventDefault();
    act($('#cats .status'), 'Wird gespeichert ...', () => store.setCats(cats.map(c => ({ id: c.id, name: c.name.trim(), color: c.color }))));
  };
  $('#token').onsubmit = e => { e.preventDefault(); const f = e.target; act($('.status', f), 'Wird geprüft und gespeichert ...', () => store.setToken(f.token.value)); };
  $('#person').onsubmit = e => {
    e.preventDefault(); const f = e.target, j = (d, t) => (t ? `${d}T${t}` : d), st2 = $('.status', f);
    const b = readDate(f.bd.value), d = readDate(f.dd.value), bt2 = readTime(f.bt.value), dt2 = readTime(f.dt.value);
    if (!b || !d || bt2 === null || dt2 === null || d < b) { st2.className = 'status err'; st2.textContent = 'Bitte Datum als 23.05.1998 und Uhrzeit als 14:30 eingeben.'; return; }
    act(st2, 'Wird gespeichert ...', () => store.setPerson({ name: 'Anna', birth: j(b, bt2), death: j(d, dt2) }));
  };
}

// ---------- time travel + live numbers ----------
$('#offset').oninput = e => { S.offset = +e.target.value; S.t = Date.now() + S.offset * YEAR; $('#when').textContent = S.offset ? fmtDate(S.t) : 'Jetzt'; renderDetail(); renderSoon(); };
$('#resetTime').onclick = () => { $('#offset').value = 0; $('#offset').oninput({ target: { value: 0 } }); };
function renderLead() {
  const dOut = (S.t - S.birth) / YEAR, lit = litStars().length;
  if (dOut <= 0) { $('#lead').textContent = 'Annas Licht hat seine Reise noch nicht begonnen.'; return; }
  const all = Math.round(0.00288 * 4 / 3 * Math.PI * (dOut ** 3 - Math.max(0, (S.t - S.death) / YEAR) ** 3) / 100) * 100;
  $('#lead').innerHTML = `Das Licht ihres Lebens erfüllt in diesem Augenblick eine Kugel mit einem Radius von <b>${num(dOut, 7)}</b> Lichtjahren.`
    + (all >= 100 ? `<span class="more"> Rund <b>${all.toLocaleString('de-DE')}</b> Sterne sehen sie gerade - ${lit} davon zeigt diese Karte, jeden an einem anderen Tag ihres Lebens.</span>` : '');
}
function renderAll() { fillFrame(); life.draw(); renderDetail(); renderSoon(); renderMoments(); renderLogin(); renderLead(); }

const DEMO = [['Einschulung', '1976-08-30', '', 'kindheit'], ['Schulzeit', '1976', '1989', 'kindheit'], ['Konfirmation', '1984-04-15', '', 'kindheit'],
  ['Tanzkurs', '1986', '', 'freude'], ['Abitur', '1989-06-16', '', 'kindheit'], ['Ausbildung', '1989-09', '1992-07', 'beruf'], ['Erste Begegnung', '1994-07-09', '', 'liebe'],
  ['Hochzeit', '1998-05-23T14:30', '', 'liebe'], ['Ehe', '1998-05-23', null, 'liebe'], ['Einzug ins Haus', '2004-10-01', '', 'liebe'], ['Reise ans Meer', '2015-08-12', '', 'freude'],
  ['Krankheit', '2023-03-01', null, 'krankheit']].map(([title, date, end, cat], n) => ({ id: 'demo' + n, title, date, end: end || '', period: end !== '', cat, vis: 'public', photos: title === 'Hochzeit' ? ['icon-512.png', 'icon-192.png', 'icon-180.png'] : [], imp: { Hochzeit: 5, 'Erste Begegnung': 5, Ehe: 5, Abitur: 4, 'Reise ans Meer': 4, Tanzkurs: 1, Konfirmation: 2 }[title],
  text: 'Ein Beispieltext, der nur beim Testen auf dem eigenen Rechner erscheint.' })).concat([
  { id: 'r1', title: 'Fotos', date: '1981-07-01', period: false, end: '', cat: 'sonst', imp: 1, text: '', vis: 'private', photos: ['media/gibtsnicht.bin'], photoOnly: true, approx: true, by: 'Papa', updated: '2026-11-21T08:00:00.000Z' },
  { id: 'r2', title: 'Fotos', date: '2012-05-15', period: false, end: '', cat: 'sonst', imp: 1, text: '', vis: 'private', photos: ['media/a.bin', 'media/b.bin'], photoOnly: true, approx: true, by: 'Papa', updated: '2026-11-21T08:10:00.000Z' },
  { id: 'r3', title: 'Konzert', date: '2019-11-22T20:00', period: false, end: '', cat: 'gibtsnichtmehr', imp: 2, text: 'Zeile eins\nZeile zwei', vis: 'private', photos: [], by: 'Papa', updated: '2026-11-21T08:20:00.000Z' }]);

// ---------- start ----------
async function init() {
  setView(location.hash.includes('himmel') ? 'sky' : 'space');
  setSkyTime(sunAltitude(Date.now()) < -6 ? null : 600);
  weather.on = true;                                   // clouds show unless someone switched them off
  try { weather.on = localStorage.getItem('annas-licht-clouds') !== 'aus'; } catch { /* ignore */ }
  const wx = () => loadWeather().then(cloudInfo);
  wx(); setInterval(wx, 30 * 6e4);
  requestAnimationFrame(frame);
  const [stars, sky] = await Promise.all([fetch('data/stars.json').then(r => r.json()), fetch('data/sky.json').then(r => r.json())]);
  S.stars = stars.map(s => ({ ...s, kind: 'star', v: vec(s.ra, s.dec, s.d) }));
  for (const s of sky.stars) s.dir = vec(s[0], s[1]);
  S.sky = sky;
  await store.load();
  await store.restore().then(() => store.state.session && store.load(true)).catch(e => console.error(e));
  if (LOCAL && location.hash.includes('demo')) store.state.items = DEMO;   // made-up moments for testing on the own computer
  rebuild();
  setInterval(renderLead, 200);
  setInterval(() => { if (!$('#p-soon').hidden) renderSoon(); }, 60000);
  let seen = true;
  try { seen = localStorage.getItem('annas-licht-seen'); localStorage.setItem('annas-licht-seen', '1'); } catch { /* private mode */ }
  const want = /p=(\w+)/.exec(location.hash)?.[1], pickName = /sel=([^&]+)/.exec(location.hash)?.[1];
  const z = /z=(\w+)/.exec(location.hash)?.[1];
  if (z) { $(`#zoom [data-zoom=${z}]`)?.click(); cam.scale = cam.target; }
  const rs = /reise=?(\d*)/.exec(location.hash);
  if (rs) { startJourney(+rs[1] || 0); J.paused = true; showStation(); cam.scale = cam.target; cam.c = [0, 0, (S.t - (S.sel?._t || S.t)) / YEAR]; }
  const yr = /jahr=(\d+)/.exec(location.hash)?.[1];
  if (yr) selectYear(new Date(+yr, 6, 1).getTime());
  const go = /go=([^&]+)/.exec(location.hash)?.[1];
  if (go) { const n = decodeURIComponent(go); flyTo(S.stars.find(s => s.n === n) || bodies.find(b => b.name === n) || S.items.find(i => i.title === n)); cam.scale = cam.target; cam.c = [...(cam.focus?.v || [0, 0, (S.t - (cam.focus?._t || S.t)) / YEAR])]; }
  if (want && panel(want)) openPanel(want);
  const mid = /\bm=(\w+)/.exec(location.hash)?.[1];
  if (mid && S.items.find(i => i.id === mid)) select(S.items.find(i => i.id === mid));
  // first visit: a short welcome; the opening flight starts once it is closed (#flug: the flight alone, #willkommen: both)
  const greet = !want && (!seen || location.hash.includes('willkommen'));
  // the flight greets someone coming to the page - not again on a reload, nor on back and forward, nor later in the same tab
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  let entering = !nav || nav.type === 'navigate';
  try { if (sessionStorage.getItem('annas-licht-flug')) entering = false; sessionStorage.setItem('annas-licht-flug', '1'); } catch { /* private mode: the reload check alone */ }
  if (S.view === 'space' && W && !S.calm && ((!location.hash && entering) || /willkommen|flug/.test(location.hash))) {
    steer([0, 0, 0], earthView());                     // the welcome is read with the Earth and the Moon behind it
    if (greet) afterWelcome = openingFlight; else openingFlight();
  }
  if (greet) showWelcome();
  if (pickName) select(S.stars.find(s => s.n === decodeURIComponent(pickName)) || bodies.find(b => b.name === decodeURIComponent(pickName)) || S.items.find(i => i.title === decodeURIComponent(pickName)));
}
init().catch(e => {
  console.error(e);
  $('#lead').textContent = 'Die Seite konnte nicht vollständig geladen werden. Bitte die Verbindung prüfen und neu laden.';
});
