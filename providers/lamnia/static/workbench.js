// Comparison workbench (spec 001 US6–US8, spec 002).
// All geometry is in canonical millimetres, y down; one SVG user unit = 1 mm.
import { api, STATIC } from "./kgl-data.js";

const COLORS = ["#d62728", "#1f77b4", "#2ca02c", "#9467bd", "#ff7f0e", "#17becf", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22"];
const PART_COLORS = { whole: "#000", blade: "#d62728", handle: "#1f77b4" };
const SVGNS = "http://www.w3.org/2000/svg";

// Layers that do not come from analyzers.
const BASE_LAYERS = [
  ["image", "open image", true],
  ["image_closed", "folded image", false],
  ["whole", "whole contour", false],
  ["blade", "blade contour", false],
  ["handle", "handle contour", false],
  ["landmarks", "tip, junction, pivot, butt", true],
  ["grid", "10 mm grid", true],
];

// Measurement table: [analyzer, value key, short header].
const COLUMNS = [
  ["extrema.dimensions", "length_along_handle_axis", "L"],
  ["extrema.dimensions", "height_across_handle_axis", "H"],
  ["extrema.dimensions", "handle_length_butt_to_junction", "handle L"],
  ["extrema.dimensions", "junction_tip_length", "junct→tip"],
  ["extrema.dimensions", "tip_offset_from_handle_axis", "tip offset"],
  ["axis.pivot_tip", "length", "pivot→tip"],
  ["axis.pivot_tip", "vs_handle_axis", "pivot→tip∠"],
  ["axis.butt_pivot", "length", "butt→pivot"],
  ["axis.butt_junction", "length", "butt→junct"],
  ["angle.relative", "blade_vs_handle", "blade∠"],
  ["angle.relative", "junction_tip_vs_handle", "tip∠"],
  ["extrema.dimensions", "blade_width", "blade W"],
  ["extrema.dimensions", "handle_width", "handle W"],
  ["area.centroid", "blade_area", "blade A"],
  ["area.centroid", "handle_area", "handle A"],
];

// Products (specs/014, docs/reference/03-products.md): one engine, a profile
// per product. The page says which (data-product); a published front without
// it is an Explorer.
const ALL_LAYOUTS = ["single", "rows", "columns", "grid", "overlay"];
const PROFILES = {
  backoffice: { layouts: ALL_LAYOUTS, start: "empty", align: true, numbers: "table" },
  explorer: { layouts: ALL_LAYOUTS, start: "empty", align: true, numbers: "table" },
  comparator: { layouts: ["rows", "overlay"], start: "random", align: false, numbers: "card" },
};
const PRODUCT = PROFILES[document.body.dataset.product] ? document.body.dataset.product : (STATIC ? "explorer" : "backoffice");
const P = PROFILES[PRODUCT];
const RANDOM_START = 3; // knives a Comparator opens on
const LAYOUTS = P.layouts;

// Defaults, every product alike (spec 010): rows, knives aligned on
// the pivot and levelled pivot→tip, open image with the principal and pivot
// axes, the points of interest and the grid, no contours, life size. A phone cannot show a knife at 1:1, so it starts at fit.
const NARROW = matchMedia("(max-width: 760px)").matches;
const DEFAULT_STATE = {
  layout: "rows", align: "pivot", orient: "pivot_tip", scale: NARROW ? "fit" : "physical", opacity: 0.5, single: 0, rotation: 0,
  layers: { ...Object.fromEntries(BASE_LAYERS.map(([k, , on]) => [k, on])), principal_axes: true, pivot_tip: true, butt_pivot: true },
};
// Layers a public product lists first; the others go under "more layers".
const CONSUMER_LAYERS = ["image", "image_closed", "whole", "landmarks", "principal_axes", "pivot_tip", "butt_pivot", "grid"];

// Permalinks (spec 004 R011): the address carries the knives (g) and every
// view setting, defaults included, so a link keeps its meaning if the
// defaults change. It wins over the stored state; the screen calibration
// stays out (it belongs to the screen, not to the view).
const VIEW = {
  layout: v => LAYOUTS.includes(v) && v,
  align: v => ["frame", "pivot", "junction", "tip", "butt"].includes(v) && v,
  orient: v => ["frame", "pivot_tip", "blade", "junction_tip", "pivot_butt", "handle", "junction_butt"].includes(v) && v,
  scale: v => ["fit", "physical"].includes(v) && v,
  rotation: v => Number.isInteger(+v) && Math.abs(+v) <= 180 && +v,
  opacity: v => +v >= 0.05 && +v <= 1 && +v,
  single: v => Number.isInteger(+v) && +v >= 0 && +v,
};
// The whole state is stored, defaults included: a new key when the defaults
// change. Each public product keeps its own (fronts share an origin).
const STORE = "kgl.workbench.2" + (PRODUCT === "backoffice" ? "" : "." + PRODUCT);
const stage = document.getElementById("stage");
let state = loadLocal();
let items = [];
let analyzers = [];
let calibration = null;
let workspace = "";
let zoom = 1; // wheel zoom in fit; of the moment, like a scroll position: not stored, not in links

function loadLocal() {
  let st;
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || "{}");
    if (s.layout && !LAYOUTS.includes(s.layout)) delete s.layout;
    st = { ...DEFAULT_STATE, ...s, layers: { ...DEFAULT_STATE.layers, ...(s.layers || {}) } };
  } catch { st = structuredClone(DEFAULT_STATE); }
  return productRules(viewFromURL(st));
}
// A product without the alignment tools keeps the default alignment.
function productRules(st) {
  if (!P.align) { st.align = DEFAULT_STATE.align; st.orient = DEFAULT_STATE.orient; }
  if (!LAYOUTS.includes(st.layout)) st.layout = DEFAULT_STATE.layout;
  return st;
}

function viewFromURL(st) {
  const p = new URLSearchParams(location.search);
  for (const [k, ok] of Object.entries(VIEW)) {
    const v = p.has(k) ? ok(p.get(k)) : false;
    if (v !== false) st[k] = v;
  }
  if (p.has("layers")) {
    const on = new Set(p.get("layers").split(",").filter(Boolean));
    st.layers = Object.fromEntries([...new Set([...Object.keys(st.layers), ...on])].map(k => [k, on.has(k)]));
  }
  return st;
}
function writeURL(refs) {
  const p = new URLSearchParams();
  refs.forEach(r => p.append("g", r));
  if (workspace) p.set("ws", workspace);
  for (const k of Object.keys(VIEW)) if (k !== "single" || state.layout === "single") p.set(k, state[k]);
  p.set("layers", Object.keys(state.layers).filter(k => state.layers[k]).sort().join(","));
  history.replaceState(null, "", "?" + p.toString().replace(/%2C/g, ","));
}
function saveLocal() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode */ }
}

function selectedRefs() { return new URLSearchParams(location.search).getAll("g"); }
function setRefs(refs) { writeURL(refs); }

async function fetchItems() {
  const refs = selectedRefs();
  if (!refs.length) { items = []; return; }
  items = await (await api("/api/canonical?" + refs.map(r => "g=" + encodeURIComponent(r)).join("&"))).json();
  items.forEach((it, i) => { it.color = COLORS[i % COLORS.length]; });
}

// Rotation (spec 004 R001): every knife turns by state.rotation degrees about
// its own pivot (junction midpoint when it has none). SVG rotate(+a) in a y-down
// frame raises a tip that points to −x, matching the angle analyzers' sign.
function rotationCentre(it) {
  const lm = it.landmarks_mm || {};
  if (lm.pivot) return lm.pivot;
  if (lm.junction) return [(lm.junction[0][0] + lm.junction[1][0]) / 2, (lm.junction[0][1] + lm.junction[1][1]) / 2];
  return [0, 0];
}
// Axis (spec 004 R006, R010): before the common rotation, each knife turns
// about the same centre so that the chosen axis is horizontal, blade-side
// axes pointing to −x (the blade side of the canonical frame), handle-side
// axes to +x. "frame" keeps the handle frame.
const mid = j => [(j[0][0] + j[1][0]) / 2, (j[0][1] + j[1][1]) / 2];
function axisOf(it) {
  const lm = it.landmarks_mm || {}, j = lm.junction && mid(lm.junction);
  const principal = part => (it.analysis?.["axis.principal"]?.overlay || []).find(o => o.part === part);
  const seg = (a, b, dir) => (a && b ? [a, b, dir] : null);
  const pr = (part, dir) => { const o = principal(part); return o ? seg(o.from, o.to, dir) : null; };
  switch (state.orient) {
    case "pivot_tip": return seg(lm.pivot, lm.tip, -1);
    case "blade": return pr("blade", -1);
    case "junction_tip": return seg(j, lm.tip, -1);
    case "pivot_butt": return seg(lm.pivot, lm.butt, 1);
    case "handle": return pr("handle", 1);
    case "junction_butt": return seg(j, lm.butt, 1);
    default: return null;
  }
}
// Levelling angle: from the axis direction (oriented by its sign) to ±x.
function orientation(it) {
  const ax = axisOf(it);
  if (!ax) return 0;
  const [a, b, dir] = ax, phi = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  const a0 = (dir < 0 ? 180 : 0) - phi;
  return ((a0 + 540) % 360) - 180;
}
function turn(p, c, deg) {
  const a = deg * Math.PI / 180, dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * Math.cos(a) - dy * Math.sin(a), c[1] + dx * Math.sin(a) + dy * Math.cos(a)];
}
const angle = it => (state.rotation || 0) + orientation(it);
function rotate(it, p) {
  const a = angle(it);
  return a ? turn(p, rotationCentre(it), a) : p;
}

// Alignment (spec 004 R010): a point and an axis. With the handle frame the
// chosen points coincide. With an axis, every knife's axis lies on one
// horizontal line (coaxial) and the points' projections on it coincide (no
// point: the lines only). The common rotation then turns the set about the
// shared point; without a point each knife turns about its own centre.
function anchor(it, lev) {
  const lm = it.landmarks_mm || {};
  switch (state.align) {
    case "tip": return lm.tip && lev(lm.tip);
    case "pivot": return lm.pivot && lev(lm.pivot);
    case "junction": return lm.junction && lev(mid(lm.junction));
    case "butt": {
      let best = null;
      for (const p of it.contours_mm.whole) { const q = lev(p); if (!best || q[0] > best[0]) best = q; }
      return best;
    }
    default: return null;
  }
}
function offset(it) {
  const c = rotationCentre(it), o = orientation(it);
  const lev = p => (o ? turn(p, c, o) : p);
  const pt = anchor(it, lev), ax = axisOf(it);
  let t = [0, 0];
  if (state.orient === "frame" || !ax) {
    if (pt) t = [-pt[0], -pt[1]];
  } else {
    t = [pt ? -pt[0] : 0, -lev(ax[0])[1]];
  }
  const shared = state.align !== "frame" && pt;
  const O = shared ? [0, 0] : [c[0] + t[0], c[1] + t[1]];
  const q = turn([c[0] + t[0], c[1] + t[1]], O, state.rotation || 0);
  return [q[0] - c[0], q[1] - c[1]];
}

function bounds(it) {
  const [dx, dy] = offset(it);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of it.contours_mm.whole) {
    const [x, y] = rotate(it, p);
    x0 = Math.min(x0, x + dx); x1 = Math.max(x1, x + dx);
    y0 = Math.min(y0, y + dy); y1 = Math.max(y1, y + dy);
  }
  return [x0, y0, x1, y1];
}
const union = bs => bs.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
// The layout at rotation 0: the scale is computed from it, so that turning
// the knives never resizes them (specs/014 U6).
function atRest(fn) {
  const r = state.rotation;
  state.rotation = 0;
  try { return fn(); } finally { state.rotation = r; }
}
// The point the knives turn about, in stage coordinates: the shared point
// when the knives share one (it is at the origin), else the knife's own.
const sharedPoint = () => state.align !== "frame" && items.some(it => anchor(it, p => p));
function turnCentre(it) {
  if (sharedPoint() && anchor(it, p => p)) return [0, 0];
  const c = rotationCentre(it), [dx, dy] = offset(it);
  return [c[0] + dx, c[1] + dy];
}

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
const NS = { "vector-effect": "non-scaling-stroke" };
const pts = ps => ps.map(p => p.join(",")).join(" ");

function drawGrid(svg, box) {
  const g = el("g", { class: "grid" }, svg);
  for (let x = Math.ceil(box[0] / 10) * 10; x <= box[2]; x += 10)
    el("line", { x1: x, y1: box[1], x2: x, y2: box[3], class: x === 0 ? "axis" : null, ...NS }, g);
  for (let y = Math.ceil(box[1] / 10) * 10; y <= box[3]; y += 10)
    el("line", { x1: box[0], y1: y, x2: box[2], y2: y, class: y === 0 ? "axis" : null, ...NS }, g);
}

// Centre-of-mass symbol: a circle with two opposite filled quadrants.
function centroidSymbol(g, x, y, color, label) {
  const r = 2.2;
  const s = el("g", { class: "com" }, g);
  el("circle", { cx: x, cy: y, r, fill: "#fff", stroke: color, ...NS }, s);
  el("path", { d: `M${x},${y} L${x + r},${y} A${r},${r} 0 0,1 ${x},${y + r} Z M${x},${y} L${x - r},${y} A${r},${r} 0 0,1 ${x},${y - r} Z`,
    fill: color, stroke: "none" }, s);
  el("title", {}, s).textContent = label;
}

function drawPrimitive(g, p, color) {
  const cls = `ov ov-${p.layer}` + (p.part ? ` part-${p.part}` : "");
  const stroke = color || PART_COLORS[p.part] || "#2a2";
  switch (p.type) {
    case "point":
      if (p.layer === "centroids") centroidSymbol(g, p.at[0], p.at[1], stroke, `${p.part} area centroid`);
      else el("circle", { cx: p.at[0], cy: p.at[1], r: 1.4, class: cls, stroke, ...NS }, g);
      break;
    case "segment":
      el("line", { x1: p.from[0], y1: p.from[1], x2: p.to[0], y2: p.to[1], class: cls, stroke, ...NS }, g);
      break;
    case "polygon":
      el("polygon", { points: pts(p.points), class: cls, stroke, ...NS }, g);
      break;
  }
}

function drawItem(svg, it, overlay) {
  const [dx, dy] = offset(it);
  const [cx, cy] = rotationCentre(it);
  const g = el("g", { transform: `translate(${dx} ${dy}) rotate(${angle(it)} ${cx} ${cy})` }, svg);
  const L = state.layers;
  // Open and folded photographs are alternative layers (spec 006); axes and points do not depend on them.
  for (const [on, cut] of [[L.image, it.cutout], [L.image_closed, it.cutout?.closed]]) {
    if (!on || !cut?.url) continue;
    const m = cut.px_to_mm;
    el("image", {
      href: cut.url, width: cut.width, height: cut.height, opacity: overlay ? state.opacity : 1,
      transform: `matrix(${m[0][0]} ${m[1][0]} ${m[0][1]} ${m[1][1]} ${m[0][2]} ${m[1][2]})`, preserveAspectRatio: "none",
      // Opaque display images (spec 012, photo-band/1) are drawn with multiply so their white stays neutral;
      // photo-band/2 images are transparent instead and carry no blend.
      ...(cut.blend === "multiply" ? { style: "mix-blend-mode: multiply" } : {}),
    }, g);
  }
  const col = overlay ? it.color : null;
  // Outlines are drawn smoothed when the outline.smooth analyzer has run (specs/009 C4).
  const smooth = Object.fromEntries((it.analysis?.["outline.smooth"]?.overlay || []).map(p => [p.part, p.points]));
  for (const part of ["whole", "handle", "blade"])
    if (L[part]) el("polygon", { points: pts(smooth[part] || it.contours_mm[part]), class: `c-${part}`, stroke: col || PART_COLORS[part], ...NS }, g);
  if (L.landmarks && it.landmarks_mm) {
    const lm = it.landmarks_mm;
    if (lm.junction) drawPrimitive(g, { layer: "landmarks", type: "segment", from: lm.junction[0], to: lm.junction[1] }, col);
    // Extremities: filled shapes (tip disc, butt square).
    if (lm.tip) el("circle", { cx: lm.tip[0], cy: lm.tip[1], r: 1.2, class: "extremity", fill: col || "#2a2" }, g)
      .appendChild(Object.assign(document.createElementNS(SVGNS, "title"), { textContent: "tip" }));
    if (lm.butt) el("rect", { x: lm.butt[0] - 1.1, y: lm.butt[1] - 1.1, width: 2.2, height: 2.2, class: "extremity",
      fill: col || "#2a2" }, g).appendChild(Object.assign(document.createElementNS(SVGNS, "title"), { textContent: "butt" }));
    if (lm.pivot) {
      const [x, y] = lm.pivot, r = 2.5, dash = lm.pivot_confidence === "high" ? null : "1.5 1";
      const pg = el("g", { class: "pivot", stroke: col || "#e67e00", "stroke-dasharray": dash }, g);
      el("circle", { cx: x, cy: y, r, fill: "none", ...NS }, pg);
      el("line", { x1: x - r * 1.6, y1: y, x2: x + r * 1.6, y2: y, ...NS }, pg);
      el("line", { x1: x, y1: y - r * 1.6, x2: x, y2: y + r * 1.6, ...NS }, pg);
      const t = el("title", {}, pg);
      t.textContent = `pivot (${lm.pivot_confidence} confidence)`;
    }
  }
  for (const res of Object.values(it.analysis || {}))
    for (const p of res.overlay || [])
      if (L[p.layer]) drawPrimitive(g, p, col);
  // Hover targets (specs/014 U9): the blade, the handle and the pivot answer
  // the pointer with their numbers, in separate views only.
  if (!overlay) {
    const i = items.indexOf(it);
    for (const part of ["handle", "blade"])
      if (it.contours_mm[part]) el("polygon", { points: pts(smooth[part] || it.contours_mm[part]), class: "hit", "data-i": i, "data-part": part, ...NS }, g);
    if (it.landmarks_mm?.pivot) el("circle", { cx: it.landmarks_mm.pivot[0], cy: it.landmarks_mm.pivot[1], r: 4, class: "hit", "data-i": i, "data-part": "pivot", ...NS }, g);
  }
}

function pxPerMM(box, cols, rows) {
  if (state.scale === "physical") return calibration ? calibration.css_px_per_mm : estimatedPxPerMM();
  const W = stage.clientWidth - 16 * cols;
  const H = Math.max(200, window.innerHeight * 0.72 - 22 * rows);
  return Math.max(0.2, Math.min(W / cols / (box[2] - box[0]), H / rows / (box[3] - box[1])));
}

// Without a calibration, 1:1 uses an estimate (spec 010): the CSS reference
// pixel (96 per inch), or about 6 css px/mm on a small touch screen.
function estimatedPxPerMM() {
  const phone = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 700;
  return phone ? 6 : 96 / 25.4;
}

// Display calibrations are re-read on focus and when 1:1 is chosen, so a
// calibration saved in another tab applies without reloading the workbench.
let calibrations = [];
async function loadCalibrations() {
  try { calibrations = await (await api("/api/calibrations")).json(); } catch { calibrations = []; }
  calibration = calibrations.find(c => c.name === state.calibration) || calibrations[0] || null;
  const sel = document.getElementById("calsel");
  sel.innerHTML = calibrations.map(c => `<option ${calibration && c.name === calibration.name ? "selected" : ""}>${c.name}</option>`).join("");
  sel.hidden = calibrations.length < 2;
}

function scaleStatus(k) {
  const el = document.getElementById("calib");
  if (state.scale === "physical" && !calibration) {
    el.innerHTML = `<b>1:1 estimated</b> (${estimatedPxPerMM().toFixed(2)} css px/mm, screen not calibrated) — ` +
      `<a href="${STATIC ? "calibrate.html" : "/calibrate"}">calibrate</a> for the exact size`;
  } else if (state.scale === "physical") {
    const dpr = window.devicePixelRatio !== calibration.device_pixel_ratio
      ? ` <b class="st-REJECTED">DPR is ${window.devicePixelRatio}, calibrated at ${calibration.device_pixel_ratio}: recalibrate or reset zoom</b>` : "";
    el.innerHTML = `<b>1:1</b> via "${calibration.name}": ${calibration.css_px_per_mm.toFixed(3)} css px/mm${dpr}`;
  } else {
    el.textContent = k ? `fit: ${k.toFixed(2)} css px/mm` + (calibration ? ` (${(k / calibration.css_px_per_mm).toFixed(2)}× life size)` : "") : "";
  }
  // The badge above the stage always says where the stage is (specs/014 U8).
  const life = calibration ? calibration.css_px_per_mm : estimatedPxPerMM();
  document.getElementById("scale-badge").textContent = state.scale === "physical"
    ? (calibration ? "1:1" : "1:1 (estimated)")
    : (zoom === 1 ? "fit" : `zoom ×${zoom.toFixed(1)}`) + (k ? ` · ${(k / life).toFixed(2)}× life size` : "");
  document.getElementById("zoomreset").hidden = state.scale === "physical" || zoom === 1;
  document.querySelectorAll("[data-when-scale]").forEach(e => { e.hidden = e.dataset.whenScale !== state.scale; });
}

function emptyStage() {
  const arrow = NARROW ? "↑" : "←";
  return `<div class="empty"><span class="arrow">${arrow}</span><div><b>Pick knives to compare</b>` +
    `<p>Search by brand or model, or take one of the suggestions. Each knife you add appears here, at its real size.</p></div></div>`;
}

function render() {
  stage.innerHTML = "";
  stage.classList.toggle("zoomed", zoom !== 1 && state.scale !== "physical");
  scaleStatus(null);
  renderMeasures();
  if (!items.length) {
    stage.innerHTML = emptyStage();
    return;
  }
  const m = 6, pad = b => [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
  // The scale comes from the knives at rest (rotation 0): a turn never
  // resizes them. Separate panels grow when a turned knife needs room.
  const rest = pad(atRest(() => union(items.map(bounds))));
  const overlay = state.layout === "overlay";
  let shown = items, cols = 1, rows = items.length;
  if (state.layout === "single") { state.single = Math.min(state.single, items.length - 1); shown = [items[state.single]]; rows = 1; }
  else if (overlay) rows = 1;
  else if (state.layout === "columns") { cols = items.length; rows = 1; }
  else if (state.layout === "grid") {
    // Knives are long and flat: stack them vertically while they stay
    // legible, and add a column only when one would show them much smaller
    // (under 60 % of the best scale any column count reaches).
    const scaleFor = c => pxPerMM(rest, c, Math.ceil(items.length / c));
    const counts = Array.from({ length: items.length }, (_, i) => i + 1);
    const best = Math.max(...counts.map(scaleFor));
    cols = counts.find(c => scaleFor(c) >= 0.6 * best);
    rows = Math.ceil(items.length / cols);
  }
  const z = state.scale === "physical" ? 1 : zoom;
  let vb, k1;
  if (overlay) {
    // A fixed window centred on the shared point (specs/014 U7): the knives
    // turn about it and the grid stays still. It fills the stage.
    const c = sharedPoint() ? [0, 0] : [(rest[0] + rest[2]) / 2, (rest[1] + rest[3]) / 2];
    const hx = Math.max(c[0] - rest[0], rest[2] - c[0]), hy = Math.max(c[1] - rest[1], rest[3] - c[1]);
    const W = stage.clientWidth - 16, H = Math.max(200, window.innerHeight * 0.72 - 22);
    k1 = state.scale === "physical" ? pxPerMM(rest, 1, 1) : Math.max(0.2, Math.min(W / (2 * hx), H / (2 * hy)));
    const w = Math.max(W, 2 * hx * k1) / k1, h = Math.max(H, 2 * hy * k1) / k1;
    vb = [c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2];
  } else {
    k1 = pxPerMM(rest, cols, rows);
    vb = union([rest, pad(union(shown.map(bounds)))]);
  }
  const k = k1 * z, w = vb[2] - vb[0], h = vb[3] - vb[1];
  scaleStatus(k);
  stage.style.gridTemplateColumns = `repeat(${cols}, max-content)`;
  const panels = overlay ? [shown] : shown.map(it => [it]);
  for (const group of panels) {
    const fig = document.createElement("figure");
    const cap = document.createElement("figcaption");
    cap.innerHTML = group.map(it =>
      `<span style="color:${overlay ? it.color : "inherit"}">■</span> ` +
      (STATIC ? (pageURL(it.slug) ? `<a href="${pageURL(it.slug)}" target="_blank" rel="noopener"><b>${it.model}</b></a>` : `<b>${it.model}</b>`)
        : `<a href="/g/${it.slug}">${it.model}</a>`) +
      (it.notes ? ` <span class="dim" title="${it.notes.replace(/"/g, "&quot;")}">⚠ known defect</span>` : "") +
      (STATIC ? (it.landmarks_mm?.pivot ? "" : ' <span class="dim">no pivot</span>')
        : ` <span class="dim">v${it.version}${it.pinned ? " (pinned)" : ""}${it.active ? "" : " — superseded"}` +
          `${it.landmarks_mm?.pivot ? (it.landmarks_mm.pivot_confidence === "high" ? "" : " · pivot unconfirmed") : " · no pivot"}</span>`) +
      (state.align === "pivot" && !it.landmarks_mm?.pivot ? ' <b class="st-REJECTED">not aligned (no pivot)</b>' : "") +
      ((state.rotation || state.orient !== "frame") && !it.landmarks_mm?.pivot ? ' <span class="dim">rotated about the junction (no pivot)</span>' : "") +
      (state.orient !== "frame" && PRODUCT === "backoffice" ? ` <span class="dim">${orientation(it) >= 0 ? "+" : ""}${orientation(it).toFixed(1)}° to level</span>` : "")).join(" &nbsp; ");
    const svg = el("svg", { viewBox: `${vb[0]} ${vb[1]} ${w} ${h}`, width: (w * k).toFixed(1), height: (h * k).toFixed(1) });
    svg.dataset.i = overlay ? "" : items.indexOf(group[0]);
    if (state.layers.grid) drawGrid(svg, vb);
    for (const it of group) drawItem(svg, it, overlay);
    fig.append(cap, svg);
    stage.appendChild(fig);
  }
}

// Comparator decision card (specs/014 U10): the numbers that decide, one
// column per knife, each knife after the first with its difference to it.
const DECISION = [
  ["extrema.dimensions", "length_along_handle_axis", "overall length"],
  ["extrema.dimensions", "junction_tip_length", "blade length"],
  ["extrema.dimensions", "handle_length_butt_to_junction", "handle length"],
  ["extrema.dimensions", "blade_width", "blade height"],
];
const val = (it, a, key) => it.analysis?.[a]?.values?.[key];

function renderMeasures() {
  const t = document.getElementById("measures"), card = document.getElementById("decision");
  const all = document.getElementById("allmeasures");
  // Nothing selected, nothing to measure: no empty table header.
  document.getElementById("numbers").hidden = !items.length;
  const def = id => (analyzers.find(a => a.id === id) || {}).definition || "";
  const head = COLUMNS.map(([a, key, label]) => {
    const unit = items[0]?.analysis?.[a]?.values?.[key]?.unit || "";
    return `<th title="${a}: ${def(a).replace(/"/g, "&quot;")}">${label}${unit ? ` <span class="dim">${unit}</span>` : ""}</th>`;
  }).join("");
  const body = items.map(it => "<tr>" +
    `<td style="color:${it.color}">${it.model}</td>` +
    COLUMNS.map(([a, key]) => {
      const v = val(it, a, key);
      return `<td class="num">${v == null ? "" : v.v.toFixed(v.unit === "mm²" ? 0 : 1)}</td>`;
    }).join("") + "</tr>").join("");
  t.innerHTML = `<tr><th></th>${head}</tr>${body}`;
  const isCard = P.numbers === "card";
  card.hidden = !isCard;
  all.hidden = !isCard;
  document.getElementById("measures-title").hidden = isCard;
  if (isCard) {
    if (t.parentElement !== all) all.appendChild(t);
    const first = items[0];
    card.innerHTML = "<tr><th></th>" + items.map(it => `<th style="color:${it.color}">${it.model}</th>`).join("") + "</tr>" +
      DECISION.map(([a, key, label]) => {
        const ref = first && val(first, a, key);
        return `<tr><th>${label}</th>` + items.map((it, i) => {
          const v = val(it, a, key);
          if (v == null) return "<td></td>";
          const d = i && ref ? v.v - ref.v : null;
          const diff = d == null ? "" : ` <span class="diff ${d > 0.05 ? "up" : d < -0.05 ? "down" : ""}">${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}</span>`;
          return `<td class="num"><b>${v.v.toFixed(1)}</b> <span class="dim">mm</span>${diff}</td>`;
        }).join("") + "</tr>";
      }).join("");
  }
}

// Hover cards (specs/014 U9): what is measured on the part under the pointer.
const CARD = {
  blade: [["extrema.dimensions", "junction_tip_length", "blade length (junction→tip)"], ["extrema.dimensions", "blade_width", "blade height"],
    ["area.centroid", "blade_area", "blade area"], ["angle.relative", "blade_vs_handle", "blade angle to the handle"]],
  handle: [["extrema.dimensions", "handle_length_butt_to_junction", "handle length (butt→junction)"], ["extrema.dimensions", "handle_width", "handle height"],
    ["area.centroid", "handle_area", "handle area"]],
  pivot: [["axis.pivot_tip", "length", "pivot→tip"], ["axis.butt_pivot", "length", "butt→pivot"]],
};
function cardHTML(it, part) {
  const rows = CARD[part].map(([a, key, label]) => {
    const v = val(it, a, key);
    return v == null ? "" : `<tr><th>${label}</th><td class="num">${v.v.toFixed(v.unit === "mm²" ? 0 : 1)} <span class="dim">${v.unit}</span></td></tr>`;
  }).join("");
  const conf = part === "pivot" ? `<tr><th>confidence</th><td>${it.landmarks_mm.pivot_confidence || "?"}</td></tr>` : "";
  return `<b style="color:${it.color}">■</b> <b>${it.model}</b> · ${part}<table>${conf}${rows}</table>`;
}
const card = document.getElementById("card");
stage.addEventListener("pointermove", e => {
  const h = !drag && e.target.closest?.(".hit");
  if (!h) { card.hidden = true; return; }
  const it = items[+h.dataset.i];
  if (!it) return;
  card.innerHTML = cardHTML(it, h.dataset.part);
  card.hidden = false;
  const r = card.getBoundingClientRect();
  card.style.left = Math.min(e.clientX + 14, window.innerWidth - r.width - 8) + "px";
  card.style.top = Math.min(e.clientY + 14, window.innerHeight - r.height - 8) + "px";
});
stage.addEventListener("pointerleave", () => { card.hidden = true; });

// Direct manipulation (specs/014 U8): drag turns the knives about the
// centre under the pointer, shift-drag pans, the wheel zooms (fit only).
let drag = null, frame = 0;
function paint() {
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; syncRotation(); render(); });
}
function screenPoint(svg, p) {
  const q = svg.createSVGPoint();
  q.x = p[0]; q.y = p[1];
  return q.matrixTransform(svg.getScreenCTM());
}
stage.addEventListener("pointerdown", e => {
  const svg = e.target.closest?.("svg");
  if (!svg || e.button !== 0 || e.target.closest("a")) return;
  e.preventDefault();
  try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic or ended pointer */ }
  card.hidden = true;
  if (e.shiftKey) {
    drag = { pan: true, x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
    return;
  }
  let c;
  if (svg.dataset.i === "") {
    const rest = atRest(() => union(items.map(bounds)));
    c = sharedPoint() ? [0, 0] : [(rest[0] + rest[2]) / 2, (rest[1] + rest[3]) / 2];
  } else c = turnCentre(items[+svg.dataset.i]);
  const sc = screenPoint(svg, c);
  drag = { cx: sc.x, cy: sc.y, a0: Math.atan2(e.clientY - sc.y, e.clientX - sc.x), r0: state.rotation || 0 };
  stage.classList.add("turning");
});
stage.addEventListener("pointermove", e => {
  if (!drag) return;
  if (drag.pan) {
    stage.scrollLeft = drag.sl - (e.clientX - drag.x);
    stage.scrollTop = drag.st - (e.clientY - drag.y);
    return;
  }
  const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
  // SVG rotate(+a) is clockwise on screen, like the pointer's angle.
  let r = Math.round(drag.r0 + (a - drag.a0) * 180 / Math.PI);
  r = ((r + 540) % 360) - 180;
  if (r !== state.rotation) { state.rotation = r; paint(); }
});
const endDrag = () => {
  if (!drag) return;
  const turned = !drag.pan;
  drag = null;
  stage.classList.remove("turning");
  if (turned) refresh(false);
};
stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);
stage.addEventListener("wheel", e => {
  if (state.scale === "physical" || !items.length) return; // at 1:1 the wheel scrolls
  e.preventDefault();
  const z0 = zoom, z1 = Math.min(8, Math.max(1, z0 * Math.exp(-e.deltaY * 0.0015)));
  if (z1 === z0) return;
  const r = stage.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const x = stage.scrollLeft + px, y = stage.scrollTop + py;
  zoom = z1;
  render();
  // Keep the point under the cursor where it was.
  stage.scrollLeft = x * z1 / z0 - px;
  stage.scrollTop = y * z1 / z0 - py;
}, { passive: false });
document.getElementById("zoomreset").addEventListener("click", () => { zoom = 1; render(); });

function buildLayerControls() {
  const box = document.getElementById("layers");
  const rows = BASE_LAYERS.map(([k, label]) => [k, label, ""]);
  for (const a of analyzers)
    for (const [k, label] of Object.entries(a.layers || {})) rows.push([k, label, `${a.id} v${a.version}: ${a.definition}`]);
  const html = ([k, label, title]) =>
    `<label title="${title.replace(/"/g, "&quot;")}"><input type="checkbox" data-layer="${k}"> ${label}` +
    (k === "image" ? " <kbd>i</kbd>" : "") + "</label>";
  // A public product lists the consumer layers first, the others under "more layers" (spec 010).
  const pub = PRODUCT !== "backoffice";
  const first = pub ? rows.filter(([k]) => CONSUMER_LAYERS.includes(k)) : rows;
  const rest = pub ? rows.filter(([k]) => !CONSUMER_LAYERS.includes(k)) : [];
  box.innerHTML = first.map(html).join("") +
    (rest.length ? `<details class="more"><summary>more layers</summary>${rest.map(html).join("")}</details>` : "");
  box.querySelectorAll("input").forEach(i => i.addEventListener("change", () => {
    state.layers[i.dataset.layer] = i.checked; refresh(false);
  }));
}

// Knife search (spec 010): a search field with at most MAX_SUGGEST
// suggestions instead of a long list, and the compared knives below it, in
// display order (the order of the g parameters, kept in workspaces). The
// catalogue is loaded once and refreshed on focus.
const MAX_SUGGEST = 8;
let catalogList = [];
let activeSuggestion = 0;
async function loadPicker() {
  catalogList = await (await api("/api/geometries")).json();
  if (!ideas.length) ideas = shuffled(catalogList.filter(g => g.comparable));
  renderSuggest();
  renderChosen();
}
const pageURL = slug => (catalogList.find(g => g.slug === slug) || {}).url;

// Every word must appear in brand + model; words that start the brand or a
// word of the model rank first. With favourites chosen and no text, the
// favourites are suggested; with neither, a few random knives, so that an
// empty page always offers a choice (specs/014 U5).
let ideas = [];
const shuffled = list => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
function suggestions(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const min = +document.getElementById("minstars").value;
  const all = !STATIC && document.getElementById("showall").checked;
  const chosen = new Set(selectedRefs().map(r => r.split("@")[0]));
  if (!words.length && !min) return ideas.filter(g => !chosen.has(g.slug));
  const out = [];
  for (const g of catalogList) {
    if (chosen.has(g.slug) || (!g.comparable && !all) || (g.stars || 0) < min) continue;
    const hay = `${g.brand} ${g.model}`.toLowerCase();
    if (!words.every(w => hay.includes(w))) continue;
    out.push([words.filter(w => !(hay.startsWith(w) || hay.includes(" " + w))).length, hay, g]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return out.map(x => x[2]);
}
function renderSuggest() {
  const q = document.getElementById("filter").value;
  const idle = !q.trim() && !+document.getElementById("minstars").value;
  // On a phone the stage comes after the picker: fewer idle suggestions.
  const list = suggestions(q), shown = list.slice(0, idle && NARROW ? 3 : MAX_SUGGEST);
  activeSuggestion = Math.max(0, Math.min(activeSuggestion, shown.length - 1));
  document.getElementById("suggest").innerHTML = (idle && shown.length ? '<div class="dim head">suggestions</div>' : "") + shown.map((g, i) =>
    `<div role="option" data-slug="${g.slug}" class="${i === activeSuggestion ? "on" : ""}${g.comparable ? "" : " dim"}">` +
    `<span class="dim">${g.brand}</span> ${g.model}${g.stars ? ` <span class="stars-ro">${"★".repeat(g.stars)}</span>` : ""}` +
    (g.comparable ? "" : ` <a href="/g/${g.slug}" class="st-${g.status}">${g.status.toLowerCase()}</a>`) + "</div>").join("") +
    (list.length > shown.length && !idle ? `<div class="dim">${list.length - shown.length} more: type more letters</div>` : "") +
    (q.trim() && !list.length ? '<div class="dim">no match</div>' : "");
}
function addKnife(slug) {
  const g = catalogList.find(x => x.slug === slug);
  if (!g || !g.comparable) return;
  setRefs([...selectedRefs(), slug]);
  document.getElementById("filter").value = "";
  activeSuggestion = 0;
  renderSuggest();
  refresh(true);
}
function renderChosen() {
  const refs = selectedRefs();
  document.getElementById("count").textContent = refs.length ? `(${refs.length})` : "";
  const box = document.getElementById("chosen");
  if (!refs.length) { box.innerHTML = '<li class="dim">none yet: search a knife above</li>'; return; }
  box.innerHTML = refs.map((r, i) => {
    const slug = r.split("@")[0];
    const g = catalogList.find(x => x.slug === slug) || { slug, brand: "", model: slug, stars: 0 };
    const link = STATIC ? (g.url ? ` <a href="${g.url}" target="_blank" rel="noopener" title="product page">↗</a>` : "")
      : ` <a href="/g/${slug}" title="inspect">⌕</a>`;
    return `<li><span style="color:${COLORS[i % COLORS.length]}">■</span> <span class="dim">${g.brand}</span> ${g.model}${link}` +
      `<span class="acts">${stars(g)} <button data-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} title="move up">▲</button>` +
      `<button data-move="${i}" data-dir="1" ${i === refs.length - 1 ? "disabled" : ""} title="move down">▼</button>` +
      `<button data-remove="${i}" title="remove">✕</button></span></li>`;
  }).join("");
}
// Favourite rating (spec 004 R008): click a star to rate 1–5, click the
// current rating again to clear it.
function stars(g) {
  let h = `<span class="stars" data-slug="${g.slug}" title="favourite rating">`;
  for (let n = 1; n <= 5; n++) h += `<span data-stars="${n}" class="${n <= g.stars ? "on" : ""}">${n <= g.stars ? "★" : "☆"}</span>`;
  return h + "</span>";
}
document.getElementById("chosen").addEventListener("click", async e => {
  const star = e.target.closest(".stars [data-stars]");
  if (star) {
    const g = catalogList.find(x => x.slug === star.parentElement.dataset.slug);
    if (!g) return;
    const n = +star.dataset.stars === g.stars ? 0 : +star.dataset.stars;
    const res = await api(`/api/geometries/${encodeURIComponent(g.slug)}/stars`, { method: "PUT", body: JSON.stringify({ stars: n }) });
    if (res.ok) { g.stars = n; renderChosen(); renderSuggest(); }
    return;
  }
  const b = e.target.closest("button[data-move], button[data-remove]");
  if (!b) return;
  const refs = selectedRefs();
  if (b.dataset.remove != null) refs.splice(+b.dataset.remove, 1);
  else { const i = +b.dataset.move, j = i + +b.dataset.dir; [refs[i], refs[j]] = [refs[j], refs[i]]; }
  setRefs(refs);
  renderSuggest();
  refresh(true);
});
const filterBox = document.getElementById("filter");
filterBox.addEventListener("input", () => { activeSuggestion = 0; renderSuggest(); });
filterBox.addEventListener("keydown", e => {
  const opts = [...document.querySelectorAll("#suggest [data-slug]")];
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    activeSuggestion = Math.max(0, Math.min(opts.length - 1, activeSuggestion + (e.key === "ArrowDown" ? 1 : -1)));
    renderSuggest();
  } else if (e.key === "Enter" && opts[activeSuggestion]) addKnife(opts[activeSuggestion].dataset.slug);
  else if (e.key === "Escape") { filterBox.value = ""; renderSuggest(); }
  else return;
  e.preventDefault();
});
document.getElementById("suggest").addEventListener("mousedown", e => {
  const o = e.target.closest("[data-slug]");
  if (o && !e.target.closest("a")) { e.preventDefault(); addKnife(o.dataset.slug); }
});
document.getElementById("minstars").addEventListener("change", renderSuggest);
document.getElementById("showall")?.addEventListener("change", renderSuggest);
document.addEventListener("keydown", e => {
  if (e.key === "/" && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.type !== "search") {
    e.preventDefault(); filterBox.focus();
  }
});

function syncControls() {
  for (const key of ["layout", "align", "orient", "scale"])
    document.querySelectorAll(`input[name=${key}]`).forEach(i => { i.checked = i.value === state[key]; });
  document.querySelectorAll("#layers input").forEach(i => { i.checked = !!state.layers[i.dataset.layer]; });
  syncRotation();
  document.getElementById("opacity").value = state.opacity;
  document.getElementById("opv").textContent = state.opacity.toFixed(2);
  // The view selector shows the product's views, the current one pressed;
  // a tool shows only in the views where it does something (specs/014 U3, U4).
  document.querySelectorAll("#views label").forEach(l => {
    l.hidden = !LAYOUTS.includes(l.dataset.view);
    l.classList.toggle("on", l.dataset.view === state.layout);
  });
  document.querySelectorAll("#controls [data-when]").forEach(e => { e.hidden = e.dataset.when !== state.layout; });
  document.querySelectorAll('#controls [data-tool="align"]').forEach(e => { e.hidden = !P.align; });
  document.getElementById("singlev").textContent = items.length ? `${state.single + 1} / ${items.length}` : "";
  renderChosen();
}
function syncRotation() {
  document.getElementById("rotation").value = state.rotation || 0;
  document.getElementById("rotv").textContent = `${state.rotation > 0 ? "+" : ""}${state.rotation || 0}°`;
}

async function refresh(refetch) {
  if (refetch) await fetchItems();
  syncControls();
  saveLocal();
  writeURL(selectedRefs());
  render();
}

// Workspaces ------------------------------------------------------------------

const wsmsg = t => { document.getElementById("wsmsg").textContent = t; };

async function listWorkspaces() {
  const list = await (await api("/api/workspaces")).json();
  const sel = document.getElementById("wslist");
  sel.innerHTML = '<option value="">— unsaved —</option>' +
    list.map(w => `<option ${w.name === workspace ? "selected" : ""}>${w.name}</option>`).join("");
}

async function saveWorkspace(name, withNotes) {
  // Items keep their pin when they have one; otherwise they follow the active version.
  const body = { items: selectedRefs().map(r => { const [slug, v] = r.split("@"); return { slug, version: v ? +v : null }; }), state };
  if (withNotes) body.notes = document.getElementById("notes").value;
  const r = await api("/api/workspaces/" + encodeURIComponent(name), {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  wsmsg(r.ok ? `saved "${name}" ${new Date().toLocaleTimeString()}` : await r.text());
}

async function openWorkspace(name) {
  workspace = name;
  if (!name) { document.getElementById("notes").value = ""; setRefs(selectedRefs()); return; }
  const ws = await (await api("/api/workspaces/" + encodeURIComponent(name))).json();
  state = { ...DEFAULT_STATE, ...ws.state, layers: { ...DEFAULT_STATE.layers, ...(ws.state.layers || {}) } };
  document.getElementById("notes").value = ws.notes || "";
  setRefs((ws.items || []).map(i => i.version ? `${i.slug}@${i.version}` : i.slug));
  wsmsg(`opened "${name}" (updated ${new Date(ws.updated_at).toLocaleString()})`);
  refresh(true);
}

// Workspaces and notes need the back end: the static site has none (spec 005).
if (!STATIC) {
let notesTimer = null;
document.getElementById("notes").addEventListener("input", () => {
  if (!workspace) { wsmsg("save the workspace to keep notes"); return; }
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => {
    api("/api/workspaces/" + encodeURIComponent(workspace), { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: document.getElementById("notes").value }) })
      .then(r => wsmsg(r.ok ? `notes saved ${new Date().toLocaleTimeString()}` : "notes NOT saved"));
  }, 800);
});
document.getElementById("wslist").addEventListener("change", e => openWorkspace(e.target.value));
document.getElementById("wssave").addEventListener("click", async () => {
  if (!workspace) return document.getElementById("wssaveas").click();
  await saveWorkspace(workspace, true);
});
document.getElementById("wssaveas").addEventListener("click", async () => {
  const name = prompt("workspace name", workspace || "");
  if (!name) return;
  workspace = name;
  await saveWorkspace(name, true);
  setRefs(selectedRefs());
  listWorkspaces();
});
}

// Controls ----------------------------------------------------------------------

for (const key of ["layout", "align", "orient", "scale"])
  document.querySelectorAll(`input[name=${key}]`).forEach(i => i.addEventListener("change", async () => {
    state[key] = i.value;
    if (key === "scale" && i.value === "physical") await loadCalibrations();
    refresh(false);
  }));
document.getElementById("calsel").addEventListener("change", e => {
  state.calibration = e.target.value;
  calibration = calibrations.find(c => c.name === e.target.value) || null;
  refresh(false);
});
document.getElementById("opacity").addEventListener("input", e => { state.opacity = +e.target.value; refresh(false); });
document.getElementById("rotation").addEventListener("input", e => { state.rotation = +e.target.value; refresh(false); });
document.getElementById("rotreset").addEventListener("click", () => { state.rotation = 0; refresh(false); });
const step = d => { state.single = (state.single + d + items.length) % Math.max(1, items.length); refresh(false); };
document.getElementById("prev").addEventListener("click", () => step(-1));
document.getElementById("next").addEventListener("click", () => step(1));
// Start over (specs/014 U5): the product's starting state, knives and view.
const startRefs = () => P.start === "random" ? ideas.slice(0, RANDOM_START).map(g => g.slug) : [];
document.getElementById("reset").addEventListener("click", () => {
  try { localStorage.removeItem(STORE); } catch { /* private mode */ }
  state = productRules(structuredClone(DEFAULT_STATE));
  zoom = 1;
  workspace = "";
  if (!STATIC) { document.getElementById("wslist").value = ""; document.getElementById("notes").value = ""; }
  ideas = shuffled(ideas);
  document.getElementById("filter").value = "";
  setRefs(startRefs());
  renderSuggest();
  refresh(true);
});
document.getElementById("permalink").addEventListener("click", async e => {
  const b = e.target;
  try { await navigator.clipboard.writeText(location.href); b.textContent = "copied"; }
  catch { prompt("Link to this view:", location.href); }
  setTimeout(() => { b.textContent = "copy link"; }, 1500);
});
window.addEventListener("resize", () => render());
document.addEventListener("keydown", e => {
  if (["TEXTAREA", "SELECT"].includes(e.target.tagName) || (e.target.tagName === "INPUT" && ["text", "search"].includes(e.target.type))) return;
  const layouts = { s: "single", r: "rows", c: "columns", g: "grid", o: "overlay" };
  if (layouts[e.key] && LAYOUTS.includes(layouts[e.key])) state.layout = layouts[e.key];
  else if (e.key === "i") state.layers.image = !state.layers.image;
  else if (e.key === "m") { state.scale = state.scale === "physical" ? "fit" : "physical"; loadCalibrations().then(() => refresh(false)); }
  else if (e.key === ",") state.rotation = Math.max(-45, (state.rotation || 0) - 1);
  else if (e.key === ".") state.rotation = Math.min(45, (state.rotation || 0) + 1);
  else if (e.key === "0") state.rotation = 0;
  else if (e.key === "[") state.opacity = Math.max(0.05, +(state.opacity - 0.05).toFixed(2));
  else if (e.key === "]") state.opacity = Math.min(1, +(state.opacity + 0.05).toFixed(2));
  else if (e.key === "ArrowRight" && state.layout === "single") state.single = (state.single + 1) % Math.max(1, items.length);
  else if (e.key === "ArrowLeft" && state.layout === "single") state.single = (state.single - 1 + items.length) % Math.max(1, items.length);
  else return;
  e.preventDefault();
  refresh(false);
});

(async () => {
  if (NARROW) document.getElementById("ctl").open = false; // display options collapse on a phone
  await loadCalibrations();
  analyzers = await (await api("/api/analyzers")).json();
  buildLayerControls();
  await loadPicker();
  window.addEventListener("focus", () => { loadPicker(); loadCalibrations().then(() => render()); });
  if (!STATIC) {
    workspace = new URLSearchParams(location.search).get("ws") || "";
    await listWorkspaces();
  }
  // A Comparator never opens on nothing: a random set when the link has none.
  if (!workspace && !selectedRefs().length && P.start === "random") { setRefs(startRefs()); renderSuggest(); }
  if (workspace) await openWorkspace(workspace);
  else refresh(true);
})();
