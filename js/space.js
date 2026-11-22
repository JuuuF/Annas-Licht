// The 3D map: Earth in the centre, real star positions around it, and the light of a lifetime as a growing sphere.
import { bodies, moonPath, orbitPoints, orbits, sun, vec } from './astro.js';
import { milky, mistSprite } from './sky.js';
import { catColor, LS, placeLabels, shootingStar, starColor, weight, YEAR } from './util.js';

// c: the point the camera looks at and turns around (light-years, Earth = 0), tc: where it is gliding to,
// focus: an object to stay with (a star, a planet, a moment on the lifeline)
export const cam = { yaw: 0.7, pitch: 0.5, scale: 0, target: 0, c: [0, 0, 0], tc: [0, 0, 0], focus: null, touched: 0, ease: 0.12 };
// where something is right now: a moment sits on the lifeline at the distance its light has travelled
export function posOf(o, t) {
  if (o.v) return o.v;
  if (!o._t) return [0, 0, 0];
  const when = o._e ? (o._t + Math.min(o._e, t)) / 2 : o._t;
  return [0, 0, Math.max(0, (t - when) / YEAR)];
}
// move the view sideways by a number of screen pixels
export function panBy(dx, dy) {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), k = 1 / cam.scale;
  const right = [cy, -sy, 0], up = [sy * sp, cy * sp, cp];
  cam.focus = null;
  cam.tc = cam.tc.map((c, i) => Math.max(-150, Math.min(150, c - dx * k * right[i] + dy * k * up[i])));
  cam.c = [...cam.tc];
}
const SPIN = 0.036;            // radians per second of the slow turning (a full turn in about three minutes)
export const atHome = () =>!cam.focus && Math.hypot(...cam.tc) < 1e-9;
export const fit = (ly, W, H) => Math.min(W, H) * 0.4 / ly;
export const clampScale = s => Math.min(1.2e10, Math.max(1.5, s));

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// distance rings on the reference plane
const RINGS = [[LS, '1 Lichtsekunde'], [60 * LS, '1 Lichtminute'], [600 * LS, '10 Lichtminuten'], [3600 * LS, '1 Lichtstunde'],
  [36000 * LS, '10 Lichtstunden'], [86400 * LS, '1 Lichttag'], [7 * 86400 * LS, '1 Lichtwoche'], [1 / 12, '1 Lichtmonat'], [1, '1 Lichtjahr'], [5, '5 Lichtjahre']];
const dust = Array.from({ length: 2600 }, (_, i) => {
  const r = n => Math.abs((Math.sin(i * 127.1 + n * 311.7) * 43758.5453) % 1);
  return [vec(r(1) * 360, Math.asin(2 * r(2) - 1) * 180 / Math.PI), 0.1 + 0.3 * r(3)];
});
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a); return a.map(v => v / l); };

// the colours of her light from the middle of the ball (0) to its rim (1)
function glowColors(vis) {
  const stops = [[0, 243, 201, 139, 0.2], [0.55, 240, 185, 150, 0.1], [0.9, 236, 172, 165, 0.1 + 0.07 * vis], [1, 233, 165, 173, 0.1 + 0.24 * vis]];
  const lut = new Uint8ClampedArray(256 * 4);
  for (let k = 0, s = 0; k < 256; k++) {
    const t = k / 255;
    while (t > stops[s + 1][0]) s++;
    const [ta, ...a] = stops[s], [tb, ...b] = stops[s + 1], f = (t - ta) / (tb - ta);
    for (let m = 0; m < 4; m++) lut[k * 4 + m] = (a[m] + (b[m] - a[m]) * f) * (m === 3 ? 255 : 1);
  }
  return lut;
}
// The glow of her light, brighter towards the rim. A canvas gradient can only draw circles, but a ball seen off-centre is an ellipse
// on the screen, and from close by an open curve. So the colour is worked out from the angle between each line of sight and the
// direction of the Earth, on a coarse grid that the browser smooths as it stretches it over the ball (the caller clips it to the outline).
let glowCv = null, glowImg = null;
function glow(ctx, pts, W, H, F, cx, cy, u, sOut, sIn, vis) {
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
  if (x1 - x0 < 1 || y1 - y0 < 1) return;
  const cell = Math.max(2, Math.max(x1 - x0, y1 - y0) / 160), gw = Math.ceil((x1 - x0) / cell), gh = Math.ceil((y1 - y0) / cell);
  const cw = (x1 - x0) / gw, ch = (y1 - y0) / gh;
  if (!glowCv) glowCv = document.createElement('canvas');
  if (!glowImg || glowImg.width !== gw || glowImg.height !== gh) { glowCv.width = gw; glowCv.height = gh; glowImg = glowCv.getContext('2d').createImageData(gw, gh); }
  const cosOut = Math.sqrt(1 - sOut * sOut), cosIn = Math.sqrt(1 - sIn * sIn), tanOut = sOut / cosOut, tanIn = sIn / cosIn;
  const lut = glowColors(vis), px = glowImg.data;
  for (let j = 0, n = 0; j < gh; j++) {
    const y = -(y0 + (j + 0.5) * ch - cy) / F;
    for (let i = 0; i < gw; i++, n += 4) {
      const x = (x0 + (i + 0.5) * cw - cx) / F;
      const c = (x * u[0] + y * u[1] + u[2]) / Math.sqrt(x * x + y * y + 1);       // cosine of the angle between this line of sight and the Earth
      const t = c <= cosOut ? 1 : c >= cosIn ? 0 : (Math.sqrt(1 - c * c) / c - tanIn) / (tanOut - tanIn);
      const k = Math.round(t * 255) * 4;
      px[n] = lut[k]; px[n + 1] = lut[k + 1]; px[n + 2] = lut[k + 2]; px[n + 3] = lut[k + 3];
    }
  }
  glowCv.getContext('2d').putImageData(glowImg, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(glowCv, 0, 0, gw, gh, x0, y0, x1 - x0, y1 - y0);
}

export function drawSpace(ctx, W, H, S) {
  const t = S.t, cx = W / 2, cy = S.cy ?? H / 2, hits = [], labels = [];
  const dOut = (t - S.birth) / YEAR, dIn = Math.max(0, (t - S.death) / YEAR);
  if (!cam.scale) cam.scale = cam.target = fit(Math.max(dOut, 20) * 1.08, W, H);
  cam.scale = Math.exp(Math.log(cam.scale) + (Math.log(cam.target) - Math.log(cam.scale)) * cam.ease);
  if (Math.abs(Math.log(cam.target / cam.scale)) < 0.01) cam.ease = 0.12;
  if (cam.focus) cam.tc = [...posOf(cam.focus, t)];
  cam.c = cam.c.map((c, i) => (Math.abs(cam.tc[i] - c) * cam.scale < 0.05 ? cam.tc[i] : c + (cam.tc[i] - c) * 0.1));
  // the slow turning of the map: once nobody has touched it for 5 seconds it starts, gently, over 2.5 seconds; a touch stops it at once,
  // "Drehung anhalten" lets it slow down gently over 2 seconds. Measured in time, not in pictures, so it turns equally fast on every screen.
  const clock = performance.now(), dt = Math.min(0.1, (clock - (cam.last || clock)) / 1000);
  cam.last = clock;
  cam.spin = clock - cam.touched < 5000 || S.hover || S.calm ? 0 : S.still ? Math.max(0, (cam.spin || 0) - dt / 2) : Math.min(1, (cam.spin || 0) + dt / 2.5);
  cam.yaw += SPIN * cam.spin * cam.spin * (3 - 2 * cam.spin) * dt;
  const sc = cam.scale, F = 1.05 * Math.max(W, H);     // small F = strong perspective
  const cyaw = Math.cos(cam.yaw), syaw = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const rot = v => {
    const x = v[0] * cyaw - v[1] * syaw, y = v[0] * syaw + v[1] * cyaw;
    return [x, v[2] * cp + y * sp, y * cp - v[2] * sp];            // right, up, depth - the camera looks down from the north
  };
  // -> [screen x, screen y, perspective factor] or null if behind the viewer
  const proj = v => {
    const [x, up, depth] = rot([v[0] - cam.c[0], v[1] - cam.c[1], v[2] - cam.c[2]]);
    const f = F / (F + depth * sc);
    return f > 0 && f < 8 ? [cx + x * sc * f, cy - up * sc * f, f, depth] : null;
  };
  // depth cues: what is far away gets smaller and dimmer
  const shade = p => Math.min(1, Math.max(0.28, (p[2] - 0.6) / 0.45));
  const grow = p => Math.min(2.2, Math.max(0.55, p[2]));
  const onScreen = p => p && p[0] > -40 && p[0] < W + 40 && p[1] > -40 && p[1] < H + 40;
  // keep: optional test which points of the line to draw
  const path = (pts, close, keep) => {
    ctx.beginPath();
    let pen = false;
    for (const v of pts) {
      const p = proj(v);
      if (!p || (keep && !keep(v))) { pen = false; continue; }
      pen ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
      pen = true;
    }
    if (close && pen) ctx.closePath();
  };
  const circle = (r, plane = 0, n = 120) => Array.from({ length: n + 1 }, (_, i) => {
    const a = i / n * 2 * Math.PI, c = r * Math.cos(a), s = r * Math.sin(a);
    return plane === 0 ? [c, s, 0] : plane === 1 ? [c, 0, s] : [0, c, s];
  });

  ctx.clearRect(0, 0, W, H);

  // the real sky far behind everything
  const FB = 0.8 * Math.max(W, H);
  const far = (dir, size, alpha, color) => {
    const [x, up, depth] = rot(dir);
    if (depth < 0.08) return;
    const px = cx + x / depth * FB, py = cy - up / depth * FB;
    if (px < 0 || px > W || py < 0 || py > H) return;
    ctx.globalAlpha = alpha; ctx.fillStyle = color;
    ctx.fillRect(px - size / 2, py - size / 2, size, size);
  };
  const mist = mistSprite();                           // the Milky Way as a landmark far behind everything
  for (const m of milky) {
    const [x, up, depth] = rot(m.dir);
    if (depth < 0.15) continue;
    const px = cx + x / depth * FB, py = cy - up / depth * FB, size = FB * m[2] * Math.PI / 180 / depth;
    if (px < -size || px > W + size || py < -size || py > H + size) continue;
    ctx.globalAlpha = m[3] * 0.9; ctx.drawImage(mist, px - size, py - size, 2 * size, 2 * size);
  }
  for (const [dir, a] of dust) far(dir, 1.1, a, '#fff');
  if (S.sky) for (const s of S.sky.stars) far(s.dir, Math.max(1, 2.8 - s[2] * 0.4), 0.5, starColor(s[3]));
  ctx.globalAlpha = 1;
  if (!S.calm) shootingStar(ctx, W, H, { every: S.meteors || 60 });      // now and then, far behind everything

  // ---- the light of her lifetime ----
  const o = proj([0, 0, 0]);
  // the eye itself (in light-years, Earth = 0): in front of the point it looks at, as far as the perspective asks for
  const E = F / sc, eye = [cam.c[0] - E * syaw * cp, cam.c[1] - E * cyaw * cp, cam.c[2] + E * sp];
  const camDist = Math.hypot(...eye);                  // how far the camera is from the Earth: once it is inside a sphere, that sphere has no outline any more
  const outside = r => Math.min(1, Math.max(0, (camDist / r - 1) / 0.4));      // 1 = seen from afar, 0 = the camera touches the sphere
  // The outline of a sphere around the Earth as the eye really sees it: the circle where the lines of sight just touch the sphere.
  // Seen straight on that is a circle around the Earth; off to the side it is an ellipse, and from close by part of it lies behind the eye.
  // That part is replaced by a wide arc far outside the picture. Returns screen points, or null when the sphere is not in view.
  const rc = rot([-cam.c[0], -cam.c[1], -cam.c[2]]), u = unit([rc[0], rc[1], rc[2] + E]);      // direction of the Earth from the eye: right, up, ahead
  const pv = unit(cross(u, Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), qv = cross(u, pv);
  const Z = 0.2, FAR = F * Math.sqrt(1 - Z * Z) / Z;   // lines of sight more sideways than this are left out: they land far outside the picture
  const seenAt = d => [cx + F * d[0] / d[2], cy - F * d[1] / d[2]];
  const outline = r => {
    if (!(r > 0) || r >= camDist) return null;
    const s = r / camDist, c = Math.sqrt(1 - s * s), n = 180;
    const dirs = Array.from({ length: n }, (_, i) => { const a = i / n * 2 * Math.PI, ca = s * Math.cos(a), sa = s * Math.sin(a); return [0, 1, 2].map(k => c * u[k] + ca * pv[k] + sa * qv[k]); });
    const ahead = dirs.map(d => d[2] >= Z);
    if (ahead.every(Boolean)) return dirs.map(seenAt);
    if (!ahead.some(Boolean)) return u[2] >= c ? Object.assign([[-2, -2], [W + 2, -2], [W + 2, H + 2], [-2, H + 2]], { full: true }) : null;   // all around the view, or nowhere in it
    const first = ahead.findIndex((a, i) => a && !ahead[(i + n - 1) % n]), pts = [];
    let i = first;
    while (ahead[i % n]) pts.push(seenAt(dirs[i++ % n]));
    const cut = (a, b) => unit(a.map((v, k) => v + (b[k] - v) * (Z - a[2]) / (b[2] - a[2])));
    const A = cut(dirs[(i - 1) % n], dirs[i % n]), B = cut(dirs[(first + n - 1) % n], dirs[first]);
    // from where the outline leaves the view to where it comes back: round the outside of the picture, on the side that belongs to the sphere
    const a0 = Math.atan2(A[1], A[0]), L = Math.sqrt(1 - Z * Z);
    let span = ((Math.atan2(B[1], B[0]) - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const mid = a0 + span / 2;
    if (L * (Math.cos(mid) * u[0] + Math.sin(mid) * u[1]) + Z * u[2] < c) span -= 2 * Math.PI;
    pts.push(seenAt(A));
    for (let k = 0, m = Math.ceil(Math.abs(span) / 0.08); k <= m; k++) pts.push([cx + FAR * Math.cos(a0 + span * k / m), cy - FAR * Math.sin(a0 + span * k / m)]);
    pts.push(seenAt(B));
    return pts;
  };
  const poly = pts => { ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.closePath(); };
  // a closed line in space, added to the current path as a shape on the screen; what lies behind the eye is cut off, so it stays right up close
  const loop = pts => {
    const near = E * 1e-3, out = [];
    const at = pts.map(v => { const q = rot([v[0] - cam.c[0], v[1] - cam.c[1], v[2] - cam.c[2]]); return [q[0], q[1], q[2] + E]; });
    at.forEach((a, i) => {
      const b = at[(i + 1) % at.length];
      if (a[2] >= near) out.push(a);
      if ((a[2] >= near) !== (b[2] >= near)) out.push(a.map((v, k) => v + (b[k] - v) * (near - a[2]) / (b[2] - a[2])));
    });
    if (out.length > 2) poly(out.map(seenAt));
    return out.length > 2;
  };
  // the circle of a sphere that faces the viewer and contains the lifeline: every moment on the line lies exactly on its own circle
  const face = r => Array.from({ length: 145 }, (_, i) => { const a = i / 144 * 2 * Math.PI, c = r * Math.cos(a); return [c * cyaw, -c * syaw, r * Math.sin(a)]; });
  const facing = r => v => v[0] * eye[0] + v[1] * eye[1] + v[2] * eye[2] > r * r;     // on the side of a sphere the eye can see
  const twoPass = (pts, r, color, back, front, width = 1) => {    // hidden half faint, visible half clear
    const near = facing(r);
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.globalAlpha = back; path(pts, false, v => !near(v)); ctx.stroke();
    ctx.globalAlpha = front; path(pts, false, near); ctx.stroke();
    ctx.globalAlpha = 1;
  };
  if (dOut > 0) {
    const vis = outside(dOut), visIn = outside(Math.max(dIn, 1e-12));
    const ground = circle(dOut);
    if (vis > 0.02 && ground.every(proj)) { ctx.globalAlpha = vis; ctx.fillStyle = 'rgba(243,201,139,.055)'; path(ground, true); ctx.fill(); ctx.globalAlpha = 1; }   // the plane all stalks stand on
    const hole = camDist > dIn ? outline(dIn) : null;  // the light that left after her death is not part of her life
    if (camDist > dOut) {                                // seen from outside: a glowing ball, brighter towards its rim
      const out = outline(dOut);
      if (out) {
        ctx.save(); ctx.beginPath(); poly(out); if (hole) poly(hole); ctx.clip('evenodd');
        glow(ctx, out, W, H, F, cx, cy, u, dOut / camDist, dIn / camDist, vis);
        ctx.restore();
        // the rim of the ball fades away as one comes close; the circle through the lifeline stays
        if (vis > 0.02 && !out.full) { ctx.globalAlpha = vis * 0.45; ctx.lineWidth = 1; ctx.strokeStyle = 'rgb(243,201,139)'; ctx.beginPath(); poly(out); ctx.stroke(); ctx.globalAlpha = 1; }
      }
    } else {                                             // inside her light: it is simply all around, with no edge
      const deep = Math.min(1, Math.max(0, (camDist / dOut - 0.6) / 0.4));
      ctx.fillStyle = `rgba(242,196,146,${0.11 + 0.09 * deep})`;
      ctx.beginPath(); ctx.rect(-2, -2, W + 4, H + 4); if (hole) poly(hole); ctx.fill('evenodd');
    }
    ctx.strokeStyle = 'rgba(243,201,139,.8)'; ctx.lineWidth = 1.5; path(face(dOut)); ctx.stroke();
    if (dIn * sc > 3) { ctx.strokeStyle = 'rgba(243,201,139,.55)'; ctx.lineWidth = 1.2; path(face(dIn)); ctx.stroke(); }
    // great circles make the sphere readable as a sphere
    if (vis > 0.02) for (const plane of [0, 1, 2]) twoPass(circle(dOut, plane), dOut, 'rgb(243,201,139)', 0.07 * vis, (plane ? 0.3 : 0.45) * vis, plane ? 1 : 1.4);
    if (dIn * sc > 30 && visIn > 0.02) for (const plane of [0, 1, 2]) twoPass(circle(dIn, plane), dIn, 'rgb(243,201,139)', 0.07 * visIn, 0.3 * visIn);
  }

  // ---- rings on the reference plane: distance = years ago ----
  const ringList = [...RINGS];
  for (let k = 10; k <= 100; k += 10) ringList.push([k, `${k} Lichtjahre (${new Date(t - k * YEAR).getFullYear()})`]);
  for (const [d, text] of ringList) {
    const px = d * sc;
    if (px < 26 || px > 2.5 * Math.max(W, H)) continue;
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; path(circle(d)); ctx.stroke();
    const a = -cam.yaw + Math.PI / 2 * 0.25, p = proj([d * Math.cos(a), d * Math.sin(a), 0]);       // label where the ring is closest to the viewer's right
    const q = proj([d * Math.cos(-cam.yaw - Math.PI / 2), d * Math.sin(-cam.yaw - Math.PI / 2), 0]);
    const at = onScreen(q) ? q : p;
    if (onScreen(at)) labels.push({ x: at[0], y: at[1] + 14, text, color: 'rgba(169,164,184,.85)', font: '11px "Source Sans 3", system-ui, sans-serif', prio: 1 });
  }
  const oort = 0.8 * sc, cloud = oort > 60 && oort < 3 * Math.max(W, H) ? outline(0.8) : null;
  if (cloud && !cloud.full) {
    ctx.setLineDash([3, 6]); ctx.strokeStyle = 'rgba(160,190,230,.25)';
    ctx.beginPath(); poly(cloud); ctx.stroke(); ctx.setLineDash([]);
    const top = cloud.reduce((a, b) => (b[1] < a[1] ? b : a));
    if (onScreen(top)) labels.push({ x: top[0], y: top[1] - 6, text: 'Oortsche Wolke', color: 'rgba(160,190,230,.7)', font: '11px "Source Sans 3", system-ui, sans-serif', prio: 2 });
  }

  // ---- solar system ----
  for (const orb of orbits) {
    const px = orb.a * sc;
    if (px < 10 || px > 30 * Math.max(W, H)) continue;
    ctx.strokeStyle = orb.name === 'Erde' ? 'rgba(140,180,255,.3)' : 'rgba(255,255,255,.13)'; ctx.lineWidth = 1;
    path(orbitPoints(orb.name, t).map(p => [p[0] + sun[0], p[1] + sun[1], p[2] + sun[2]])); ctx.stroke();
  }
  if (bodies[0].d * sc > 25 && bodies[0].d * sc < 30 * Math.max(W, H)) { ctx.strokeStyle = 'rgba(255,255,255,.13)'; path(moonPath(t)); ctx.stroke(); }
  for (const b of bodies) {
    const p = proj(b.v);
    if (!onScreen(p) || b.d * sc < 5) continue;
    const on = S.sel === b || S.hover === b, isSun = b.name === 'Sonne';
    if (isSun) {
      const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 16);
      g.addColorStop(0, 'rgba(255,236,170,.9)'); g.addColorStop(1, 'rgba(255,236,170,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p[0], p[1], 16, 0, 7); ctx.fill();
    }
    ctx.fillStyle = isSun ? '#ffe9a8' : b.name.startsWith('Voyager') ? '#bfe3d4' : '#c9d2ee';
    ctx.beginPath(); ctx.arc(p[0], p[1], on ? 5 : isSun ? 4.5 : 3, 0, 7); ctx.fill();
    if (on) { ctx.strokeStyle = '#f3c98b'; ctx.beginPath(); ctx.arc(p[0], p[1], 10, 0, 7); ctx.stroke(); }
    labels.push({ x: p[0], y: p[1] - 9, text: b.name, prio: on ? 100 : 30, force: on });
    hits.push({ x: p[0], y: p[1], o: b });
  }

  // ---- stars ----
  const yearD = S.sel?._t && !S.sel._e ? (t - S.sel._t) / YEAR : -9;
  const now = performance.now() / 1000;       // a chosen time: the stars its light is passing right now stand out
  for (const s of S.stars) {
    const p = proj(s.v);
    if (!p) continue;
    const lit = s.d <= dOut && s.d >= dIn, on = S.sel === s || S.hover === s || Math.abs(s.d - yearD) < 0.75;
    if (!onScreen(p) || s.d * sc < 5) continue;
    const foot = proj([s.v[0], s.v[1], 0]);
    const sh = shade(p);
    if (foot && sc * s.d > 30) {
      ctx.globalAlpha = sh; ctx.lineWidth = 1;
      ctx.strokeStyle = lit ? 'rgba(243,201,139,.3)' : 'rgba(255,255,255,.12)';
      if (s.v[2] < 0) ctx.setLineDash([2, 3]);                     // below the plane
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(foot[0], foot[1]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(foot[0] - 1, foot[1] - 1, 2, 2);
      ctx.globalAlpha = 1;
    }
    const r = Math.min(5, Math.max(1.5, 3.5 - 0.42 * s.mag)) * grow(p);
    if (lit) {
      const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 4.5);
      g.addColorStop(0, `rgba(255,225,170,${0.5 * sh * (0.8 + 0.2 * Math.sin(now * 1.7 + s.ra))})`); g.addColorStop(1, 'rgba(255,225,170,0)');      // a gentle twinkle
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p[0], p[1], r * 4.5, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = (lit ? 1 : 0.55) * sh; ctx.fillStyle = starColor(s.ci);
    ctx.beginPath(); ctx.arc(p[0], p[1], on ? r + 1.5 : r, 0, 7); ctx.fill();
    if (s.hz) { ctx.strokeStyle = 'rgba(150,225,180,.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p[0], p[1], r + 3.5, 0, 7); ctx.stroke(); }
    ctx.globalAlpha = 1;
    if (on) { ctx.strokeStyle = '#f3c98b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p[0], p[1], r + 8, 0, 7); ctx.stroke(); }
    const year = lit ? ` (${new Date(t - s.d * YEAR).getFullYear()})` : '';
    labels.push({ x: p[0], y: p[1] - r - 6, text: s.n + year, color: lit ? 'rgba(255,240,215,.95)' : 'rgba(200,205,225,.6)',
      alpha: on ? 1 : Math.max(0.4, sh), font: `${Math.round(Math.min(14, Math.max(10, 11.5 * p[2])))}px "Source Sans 3", system-ui, sans-serif`,
      prio: on ? 100 : (lit ? 20 : 8) + (s.hz ? 3 : 0) - s.mag * 0.8 + p[2] * 6, force: on, soft: true });
    hits.push({ x: p[0], y: p[1], o: s });
  }

  // ---- her lifeline: every moment at the distance its light has reached ----
  const up = d => [0, 0, d];
  // a straight piece of line, cut where it passes behind the eye (up close one end often is): its two ends on the screen, or null
  const seg = (a, b) => {
    const depth = v => rot([v[0] - cam.c[0], v[1] - cam.c[1], v[2] - cam.c[2]])[2], lim = -0.85 * E;     // proj() leaves out what is nearer than E / 8
    const da = depth(a), db = depth(b), cut = (p, q, dp, dq) => p.map((v, k) => v + (q[k] - v) * (lim - dp) / (dq - dp));
    if (da < lim && db < lim) return null;
    const pa = proj(da < lim ? cut(a, b, da, db) : a), pb = proj(db < lim ? cut(b, a, db, da) : b);
    return pa && pb ? [pa, pb] : null;
  };
  const line = dOut > 0 && seg(up(dIn), up(dOut));
  if (line) {
    for (const [color, width] of [['rgba(243,201,139,.22)', 7], ['rgba(255,236,200,.95)', 2]]) {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(line[0][0], line[0][1]); ctx.lineTo(line[1][0], line[1][1]); ctx.stroke();
    }
  }
  // spans of time run in lanes beside the line: a span takes the first lane that is free when it begins
  const laneOf = new Map(), lanes = [];
  for (const it of S.items) {
    if (!it._e || it._t > t) continue;
    let lane = lanes.findIndex(end => end <= it._t);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = it._e; laneOf.set(it, lane);
  }
  // A scale along the line: decades, years, quarters, months and, very close up, days. Each kind of mark fades in
  // once its marks are far enough apart on the screen, and gets its name a little later. Measured where each mark is,
  // so the near end of a line seen in perspective can show months while the far end only shows years.
  if (line) {
    const STEP = [10, 5, 1, 1 / 4, 1 / 12, 10 / 365.25, 1 / 365.25], LEN = [5, 4.5, 4, 3.5, 3, 2.5, 2];     // years between two marks of a kind, half length
    const last = Math.min(S.death, t), spans = [...laneOf].map(([it, lane]) => [it._t, it._e, lane]);
    const mark = (T, level, text) => {
      if (T <= S.birth || T > last) return;
      const d = (t - T) / YEAR, p = proj(up(d)), q = proj(up(d + 1 / sc));
      if (!p || !q || !onScreen(p)) return;
      const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy), gap = l * sc * STEP[level];      // pixels to the next mark of this kind
      if (gap < 5 || !l) return;
      const nx = -dy / l * LEN[level], ny = dx / l * LEN[level];         // across the line
      ctx.globalAlpha = Math.min(1, (gap - 5) / 12); ctx.lineWidth = level ? 1 : 1.5;
      ctx.beginPath(); ctx.moveTo(p[0] - nx, p[1] - ny); ctx.lineTo(p[0] + nx, p[1] + ny); ctx.stroke();
      if (gap < 30) return;
      const beside = spans.reduce((n, s) => (s[0] <= T && T <= s[1] ? Math.max(n, s[2] + 1) : n), 0);       // to the right, past the spans running then
      labels.push({ x: p[0] + 7 + 7 * beside, y: p[1] + 4, text, align: 'left', color: 'rgba(255,236,200,.85)', alpha: Math.min(1, (gap - 30) / 20),
        font: `${level ? 400 : 600} 11px "Source Sans 3", system-ui, sans-serif`, prio: 27.5 - level / 2 });      // above most star names, below moments and spans
    };
    // a piece of the line between two times: is it in the picture, and is it longer than `px`?
    const roomy = (T0, T1, px) => {
      if (T1 <= S.birth || T0 > last) return false;
      const s = seg(up((t - T0) / YEAR), up((t - T1) / YEAR));
      return !!s && Math.max(s[0][0], s[1][0]) > 0 && Math.min(s[0][0], s[1][0]) < W && Math.max(s[0][1], s[1][1]) > 0 && Math.min(s[0][1], s[1][1]) < H &&
        Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) > px;
    };
    ctx.strokeStyle = 'rgb(255,236,200)';
    for (let y = new Date(S.birth).getFullYear(); y <= new Date(last).getFullYear(); y++) {
      mark(new Date(y, 0, 1).getTime(), y % 10 ? (y % 5 ? 2 : 1) : 0, String(y));
      if (!roomy(new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime(), 15)) continue;      // the months only where there is room for them
      for (let m = 0; m < 12; m++) {
        const T = new Date(y, m, 1).getTime(), days = new Date(y, m + 1, 0).getDate();
        if (m) mark(T, m % 3 ? 4 : 3, `${MONTHS[m]} ${y}`);
        if (roomy(T, new Date(y, m + 1, 1).getTime(), 2 * days)) for (let day = 2; day <= days; day++) mark(new Date(y, m, day).getTime(), day % 10 ? 6 : 5, `${day}. ${MONTHS[m]} ${y}`);
      }
    }
    ctx.globalAlpha = 1;
  }
  const sel = S.sel && S.sel._t ? S.sel : null;
  if (sel) {
    const d1 = (t - sel._t) / YEAR, d0 = Math.max(0, (t - (sel._e ?? sel._t)) / YEAR);
    if (d1 > 0) {
      ctx.fillStyle = catColor(sel.cat) + '26'; ctx.strokeStyle = catColor(sel.cat); ctx.lineWidth = 1.3;
      if (sel._e) {                                      // the band between its two rings, tilted with them
        ctx.beginPath();
        if (loop(face(d1))) { if (d0 * sc > 0.5) loop(face(d0)); ctx.fill('evenodd'); }
      }
      ctx.setLineDash([5, 5]); path(face(d1)); ctx.stroke();
      if (sel._e && d0 * sc > 3) { path(face(d0)); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.5; path(circle(d1)); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  for (const it of S.items) {
    if (it._t > t) continue;
    const d = (t - it._t) / YEAR, on = S.sel === it || S.hover === it, color = catColor(it.cat);
    if (it._e) {                                         // a span of time: a coloured band beside the lifeline
      const dEnd = Math.max(0, (t - it._e) / YEAR);
      const [a, b] = seg(up(d), up(dEnd)) || [];
      if (!a || Math.hypot(a[0] - b[0], a[1] - b[1]) < 3) continue;
      const off = 7 + laneOf.get(it) * 7, w = weight(it);
      ctx.strokeStyle = color; ctx.lineCap = 'round';
      if (w >= 4) { ctx.lineWidth = 13; ctx.globalAlpha = w > 4 ? 0.22 : 0.14; ctx.beginPath(); ctx.moveTo(a[0] + off, a[1]); ctx.lineTo(b[0] + off, b[1]); ctx.stroke(); }    // a soft light along the important ones
      ctx.lineWidth = on ? 6 : 4; ctx.globalAlpha = on ? 1 : 0.8;
      ctx.beginPath(); ctx.moveTo(a[0] + off, a[1]); ctx.lineTo(b[0] + off, b[1]); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineCap = 'butt';
      const m = [(a[0] + b[0]) / 2 + off, (a[1] + b[1]) / 2];
      if (onScreen(m)) labels.push({ o: it, x: m[0] + 10, y: m[1] + 4, text: it.title, align: 'left', color: '#fff', box: color, glow: w > 4 && color, font: 'italic 13px EB Garamond, Georgia, serif', prio: on ? 100 : 28 + 4 * w, force: on });
      hits.push({ seg: [a[0] + off, a[1], b[0] + off, b[1]], o: it });     // the whole bar can be clicked, also when its middle is out of the picture
      continue;
    }
    const p = proj(up(d));
    if (!onScreen(p) || d * sc < 4) continue;
    const w = it.photoOnly ? 0.4 : weight(it), q = (on ? 2 : 0) + 4.3 + 0.9 * w;      // moments are diamonds with a name plate - the more a moment matters, the larger
    const diamond = r => { ctx.beginPath(); ctx.moveTo(p[0], p[1] - r); ctx.lineTo(p[0] + r, p[1]); ctx.lineTo(p[0], p[1] + r); ctx.lineTo(p[0] - r, p[1]); ctx.closePath(); };
    if (w >= 4) {                                        // "sehr wichtig" and the events of a life shine in their colour; a life event also gets a second outline
      const R = q * (w > 4 ? 3.4 : 2.6), g = ctx.createRadialGradient(p[0], p[1], q * 0.5, p[0], p[1], R);
      g.addColorStop(0, color + (w > 4 ? '70' : '48')); g.addColorStop(1, color + '00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p[0], p[1], R, 0, 7); ctx.fill();
      if (w > 4) { diamond(q + 4.5); ctx.strokeStyle = color; ctx.globalAlpha = 0.8; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1; }
    }
    diamond(q);
    ctx.fillStyle = it.id === 'death' ? '#1b1630' : color; ctx.fill();
    ctx.strokeStyle = on ? '#fff' : it.id === 'death' ? color : 'rgba(255,255,255,.85)'; ctx.lineWidth = on ? 2.5 : 1.5; ctx.stroke();
    labels.push({ o: it, x: p[0] - 13 - (w > 4 ? 3 : 0), y: p[1] + 4, text: it.title, align: 'right', color: '#fff', box: on ? '#fff' : color, glow: w > 4 && color,
      font: `${w >= 4 ? 500 : 400} ${Math.round(11.5 + 0.9 * w)}px EB Garamond, Georgia, serif`, prio: on ? 100 : it.photoOnly ? 9 : 36 + 5 * w, force: on, soft: !!it.photoOnly });
    hits.push({ x: p[0], y: p[1], o: it });
  }

  // a chosen time that is not one of the stored moments (a point picked on the strip, a birthday of the journey)
  if (sel && !S.items.includes(sel)) {
    const p = proj(up((t - sel._t) / YEAR));
    if (onScreen(p)) {
      ctx.strokeStyle = '#f3c98b'; ctx.lineWidth = 2; ctx.fillStyle = '#1b1630';
      ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, 7); ctx.fill(); ctx.stroke();
      labels.push({ x: p[0] - 14, y: p[1] + 4, text: sel.title, align: 'right', color: '#fff', box: '#f3c98b', font: '14px EB Garamond, Georgia, serif', prio: 100, force: true });
    }
  }

  // Earth
  if (o) {
    ctx.fillStyle = '#9cc4ff'; ctx.beginPath(); ctx.arc(o[0], o[1], 3.5, 0, 7); ctx.fill();
    labels.push({ x: o[0], y: o[1] + 17, text: 'Erde', prio: 90, color: '#cfe0ff' });
  }
  placeLabels(ctx, labels, Math.round(W * H / 11000), S.avoid);
  for (const l of labels) if (l.o && l.rect) hits.push({ rect: l.rect, o: l.o });       // the name plates of the moments can be clicked too
  return hits;
}
