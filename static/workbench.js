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
  ["blade", "blade contour", true],
  ["handle", "handle contour", true],
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

// Remarkable points are shown by default (user request): landmarks and area centroids.
const DEFAULT_STATE = {
  layout: "rows", align: "frame", orient: "frame", scale: "fit", opacity: 0.5, single: 0, rotation: 0,
  layers: { ...Object.fromEntries(BASE_LAYERS.map(([k, , on]) => [k, on])), centroids: true },
};

const stage = document.getElementById("stage");
let state = loadLocal();
let items = [];
let analyzers = [];
let calibration = null;
let workspace = "";

function loadLocal() {
  try {
    const s = JSON.parse(localStorage.getItem("kgl.workbench") || "{}");
    return { ...DEFAULT_STATE, ...s, layers: { ...DEFAULT_STATE.layers, ...(s.layers || {}) } };
  } catch { return structuredClone(DEFAULT_STATE); }
}
function saveLocal() {
  try { localStorage.setItem("kgl.workbench", JSON.stringify(state)); } catch { /* private mode */ }
}

function selectedRefs() { return new URLSearchParams(location.search).getAll("g"); }
function setRefs(refs) {
  const p = new URLSearchParams();
  refs.forEach(r => p.append("g", r));
  if (workspace) p.set("ws", workspace);
  history.replaceState(null, "", "?" + p.toString());
}

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
// Orientation (spec 004 R006): before the common rotation, each knife turns
// about the same centre so that its pivot→tip axis points to −x (the blade
// side of the canonical frame) or its pivot→butt axis to +x.
function orientation(it) {
  const lm = it.landmarks_mm || {}, [cx, cy] = rotationCentre(it);
  const end = state.orient === "pivot_tip" ? lm.tip : state.orient === "pivot_butt" ? lm.butt : null;
  if (!end) return 0;
  const phi = Math.atan2(end[1] - cy, end[0] - cx) * 180 / Math.PI;
  const a = (state.orient === "pivot_tip" ? 180 : 0) - phi;
  return ((a + 540) % 360) - 180;
}
const angle = it => (state.rotation || 0) + orientation(it);
function rotate(it, p) {
  const a = angle(it) * Math.PI / 180;
  if (!a) return p;
  const [cx, cy] = rotationCentre(it), dx = p[0] - cx, dy = p[1] - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
}

// Alignment: translation (mm) applied after the rotation, so tip, junction and
// butt anchors use their rotated positions (the pivot does not move).
function offset(it) {
  const lm = it.landmarks_mm || {};
  const neg = p => { const q = rotate(it, p); return [-q[0], -q[1]]; };
  switch (state.align) {
    case "tip": return lm.tip ? neg(lm.tip) : [0, 0];
    case "pivot": return lm.pivot ? neg(lm.pivot) : [0, 0];
    case "junction": {
      const j = lm.junction;
      return j ? neg([(j[0][0] + j[1][0]) / 2, (j[0][1] + j[1][1]) / 2]) : [0, 0];
    }
    case "butt": {
      let best = null;
      for (const p of it.contours_mm.whole) { const q = rotate(it, p); if (!best || q[0] > best[0]) best = q; }
      return [-best[0], -best[1]];
    }
    default: return [0, 0];
  }
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
    }, g);
  }
  const col = overlay ? it.color : null;
  for (const part of ["whole", "handle", "blade"])
    if (L[part]) el("polygon", { points: pts(it.contours_mm[part]), class: `c-${part}`, stroke: col || PART_COLORS[part], ...NS }, g);
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
}

function pxPerMM(box, cols, rows) {
  if (state.scale === "physical" && calibration) return calibration.css_px_per_mm;
  const W = stage.clientWidth - 16 * cols;
  const H = Math.max(200, window.innerHeight * 0.72 - 22 * rows);
  return Math.max(0.2, Math.min(W / cols / (box[2] - box[0]), H / rows / (box[3] - box[1])));
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
    el.innerHTML = '<b class="st-REJECTED">1:1 needs a display calibration</b> — <a href="/calibrate">calibrate</a>; showing fit.';
  } else if (state.scale === "physical") {
    const dpr = window.devicePixelRatio !== calibration.device_pixel_ratio
      ? ` <b class="st-REJECTED">DPR is ${window.devicePixelRatio}, calibrated at ${calibration.device_pixel_ratio}: recalibrate or reset zoom</b>` : "";
    el.innerHTML = `<b>1:1</b> via "${calibration.name}": ${calibration.css_px_per_mm.toFixed(3)} css px/mm${dpr}`;
  } else {
    el.textContent = k ? `fit: ${k.toFixed(2)} css px/mm` + (calibration ? ` (${(k / calibration.css_px_per_mm).toFixed(2)}× life size)` : "") : "";
  }
}

function render() {
  stage.innerHTML = "";
  scaleStatus(null);
  renderMeasures();
  if (!items.length) {
    stage.innerHTML = '<p class="dim">Select knives in the list on the right.</p>';
    return;
  }
  const box = union(items.map(bounds));
  const m = 6, vb = [box[0] - m, box[1] - m, box[2] + m, box[3] + m];
  const w = vb[2] - vb[0], h = vb[3] - vb[1];
  let shown = items, cols = 1, rows = items.length;
  if (state.layout === "single") { state.single = Math.min(state.single, items.length - 1); shown = [items[state.single]]; rows = 1; }
  else if (state.layout === "overlay") rows = 1;
  else if (state.layout === "columns") { cols = items.length; rows = 1; }
  else if (state.layout === "grid") {
    // Knives are long and flat: stack them vertically while they stay
    // legible, and add a column only when one would show them much smaller
    // (under 60 % of the best scale any column count reaches).
    const scaleFor = c => pxPerMM(vb, c, Math.ceil(items.length / c));
    const counts = Array.from({ length: items.length }, (_, i) => i + 1);
    const best = Math.max(...counts.map(scaleFor));
    cols = counts.find(c => scaleFor(c) >= 0.6 * best);
    rows = Math.ceil(items.length / cols);
  }
  const k = pxPerMM(vb, cols, rows);
  scaleStatus(k);
  stage.style.gridTemplateColumns = `repeat(${cols}, max-content)`;
  const panels = state.layout === "overlay" ? [shown] : shown.map(it => [it]);
  for (const group of panels) {
    const fig = document.createElement("figure");
    const cap = document.createElement("figcaption");
    cap.innerHTML = group.map(it =>
      `<span style="color:${state.layout === "overlay" ? it.color : "inherit"}">■</span> ` +
      (STATIC ? `<b>${it.model}</b>` : `<a href="/g/${it.slug}">${it.model}</a>`) +
      (it.notes ? ` <span class="dim" title="${it.notes.replace(/"/g, "&quot;")}">⚠ known defect</span>` : "") +
      ` <span class="dim">v${it.version}${it.pinned ? " (pinned)" : ""}${it.active ? "" : " — superseded"}` +
      `${it.landmarks_mm?.pivot ? (it.landmarks_mm.pivot_confidence === "high" ? "" : " · pivot unconfirmed") : " · no pivot"}</span>` +
      (state.align === "pivot" && !it.landmarks_mm?.pivot ? ' <b class="st-REJECTED">not aligned (no pivot)</b>' : "") +
      ((state.rotation || state.orient !== "frame") && !it.landmarks_mm?.pivot ? ' <span class="dim">rotated about the junction (no pivot)</span>' : "") +
      (state.orient !== "frame" ? ` <span class="dim">${orientation(it) >= 0 ? "+" : ""}${orientation(it).toFixed(1)}° to level</span>` : "")).join(" &nbsp; ");
    const svg = el("svg", { viewBox: `${vb[0]} ${vb[1]} ${w} ${h}`, width: (w * k).toFixed(1), height: (h * k).toFixed(1) });
    if (state.layers.grid) drawGrid(svg, vb);
    for (const it of group) drawItem(svg, it, state.layout === "overlay");
    fig.append(cap, svg);
    stage.appendChild(fig);
  }
}

function renderMeasures() {
  const t = document.getElementById("measures");
  // Nothing selected, nothing to measure: no empty table header.
  t.hidden = document.getElementById("measures-title").hidden = !items.length;
  const def = id => (analyzers.find(a => a.id === id) || {}).definition || "";
  const head = COLUMNS.map(([a, key, label]) => {
    const unit = items[0]?.analysis?.[a]?.values?.[key]?.unit || "";
    return `<th title="${a}: ${def(a).replace(/"/g, "&quot;")}">${label}${unit ? ` <span class="dim">${unit}</span>` : ""}</th>`;
  }).join("");
  const body = items.map(it => "<tr>" +
    `<td style="color:${it.color}">${it.model}</td>` +
    COLUMNS.map(([a, key]) => {
      const v = it.analysis?.[a]?.values?.[key];
      return `<td class="num">${v == null ? "" : v.v.toFixed(v.unit === "mm²" ? 0 : 1)}</td>`;
    }).join("") + "</tr>").join("");
  t.innerHTML = `<tr><th></th>${head}</tr>${body}`;
}

function buildLayerControls() {
  const box = document.getElementById("layers");
  const rows = BASE_LAYERS.map(([k, label]) => [k, label, ""]);
  for (const a of analyzers)
    for (const [k, label] of Object.entries(a.layers || {})) rows.push([k, label, `${a.id} v${a.version}: ${a.definition}`]);
  box.innerHTML = rows.map(([k, label, title]) =>
    `<label title="${title.replace(/"/g, "&quot;")}"><input type="checkbox" data-layer="${k}"> ${label}` +
    (k === "image" ? " <kbd>i</kbd>" : "") + "</label>").join("");
  box.querySelectorAll("input").forEach(i => i.addEventListener("change", () => {
    state.layers[i.dataset.layer] = i.checked; refresh(false);
  }));
}

// Knife picker: the whole catalog is loaded (refreshed on focus); comparable
// knives are listed, the others greyed with their status when "show not
// comparable" is ticked, so an added knife is always findable.
async function loadPicker() {
  catalogList = await (await api("/api/geometries")).json();
  renderPicker();
}

// Filtered, brand-grouped picker. Selected knives always stay visible.
let catalogList = [];
function renderPicker() {
  const q = (document.getElementById("filter").value || "").toLowerCase().trim();
  const all = !STATIC && document.getElementById("showall").checked;  // the static site publishes accepted knives only
  const selected = new Set(selectedRefs().map(r => r.split("@")[0]));
  const match = g => !q || [g.brand, g.model, g.slug, ...(g.tags || [])].join(" ").toLowerCase().includes(q);
  const min = +document.getElementById("minstars").value;
  const shown = catalogList.filter(g => selected.has(g.slug) || (match(g) && (g.comparable || all) && g.stars >= min));
  const box = document.getElementById("pick");
  if (!catalogList.length) { box.innerHTML = '<p class="dim">Catalog empty: run make import.</p>'; return; }
  let html = "", brand = null;
  for (const g of shown) {
    if (g.brand !== brand) { brand = g.brand; html += `<div class="brand">${brand}</div>`; }
    html += g.comparable
      ? `<label><input type="checkbox" name="g" value="${g.slug}"> ${g.model}${stars(g)}</label>`
      : `<label class="dim" title="not comparable yet"><input type="checkbox" disabled> ${g.model} ` +
        `<a href="/g/${g.slug}" class="st-${g.status}">${g.status.toLowerCase()}</a></label>`;
  }
  const hidden = catalogList.length - shown.length;
  box.innerHTML = html + (hidden ? `<p class="dim">${hidden} hidden by the filter</p>` : "");
  syncControls();
}
// Favourite rating (spec 004 R008): click a star to rate 1–5, click the
// current rating again to clear it.
function stars(g) {
  let h = ` <span class="stars" data-slug="${g.slug}" title="favourite rating">`;
  for (let n = 1; n <= 5; n++) h += `<span data-stars="${n}" class="${n <= g.stars ? "on" : ""}">${n <= g.stars ? "★" : "☆"}</span>`;
  return h + "</span>";
}
document.getElementById("pick").addEventListener("click", async e => {
  const star = e.target.closest(".stars [data-stars]");
  if (!star) return;
  e.preventDefault();  // inside the label: do not toggle the knife
  const g = catalogList.find(x => x.slug === star.parentElement.dataset.slug);
  const n = +star.dataset.stars === g.stars ? 0 : +star.dataset.stars;
  const res = await api(`/api/geometries/${encodeURIComponent(g.slug)}/stars`, { method: "PUT", body: JSON.stringify({ stars: n }) });
  if (res.ok) { g.stars = n; renderPicker(); }
});
document.getElementById("minstars").addEventListener("change", renderPicker);
document.getElementById("filter").addEventListener("input", renderPicker);
document.getElementById("showall")?.addEventListener("change", renderPicker);
document.addEventListener("keydown", e => {
  if (e.key === "/" && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.type !== "search") {
    e.preventDefault(); document.getElementById("filter").focus();
  }
});

// Displayed order = order of the g parameters (kept in workspaces).
function renderOrder() {
  const refs = selectedRefs();
  const name = r => (items.find(it => it.slug === r.split("@")[0]) || {}).model || r;
  const box = document.getElementById("order");
  box.innerHTML = refs.map((r, i) =>
    `<li><span style="color:${COLORS[i % COLORS.length]}">■</span> ${name(r)} ` +
    `<button data-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} title="move up">▲</button>` +
    `<button data-move="${i}" data-dir="1" ${i === refs.length - 1 ? "disabled" : ""} title="move down">▼</button></li>`).join("");
}
document.getElementById("order").addEventListener("click", e => {
  const b = e.target.closest("button[data-move]");
  if (!b) return;
  const refs = selectedRefs(), i = +b.dataset.move, j = i + +b.dataset.dir;
  [refs[i], refs[j]] = [refs[j], refs[i]];
  setRefs(refs);
  refresh(true);
});

function syncControls() {
  const refs = selectedRefs().map(r => r.split("@")[0]);
  document.querySelectorAll("#pick input").forEach(i => { i.checked = refs.includes(i.value); });
  for (const key of ["layout", "align", "orient", "scale"])
    document.querySelectorAll(`input[name=${key}]`).forEach(i => { i.checked = i.value === state[key]; });
  document.querySelectorAll("#layers input").forEach(i => { i.checked = !!state.layers[i.dataset.layer]; });
  document.getElementById("rotation").value = state.rotation || 0;
  document.getElementById("rotv").textContent = `${state.rotation > 0 ? "+" : ""}${state.rotation || 0}°`;
  document.getElementById("opacity").value = state.opacity;
  document.getElementById("opv").textContent = state.opacity.toFixed(2);
  renderOrder();
}

async function refresh(refetch) {
  if (refetch) await fetchItems();
  syncControls();
  saveLocal();
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

// Keep the chosen order: selected knives stay in place, new ones are appended.
document.getElementById("pick").addEventListener("change", () => {
  const checked = new Set([...document.querySelectorAll("#pick input:checked")].map(i => i.value));
  const kept = selectedRefs().filter(r => checked.has(r.split("@")[0]));
  const have = new Set(kept.map(r => r.split("@")[0]));
  setRefs([...kept, ...[...checked].filter(slug => !have.has(slug))]);
  refresh(true);
});
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
window.addEventListener("resize", () => render());
document.addEventListener("keydown", e => {
  if (["TEXTAREA", "SELECT"].includes(e.target.tagName) || (e.target.tagName === "INPUT" && e.target.type === "text")) return;
  const layouts = { s: "single", r: "rows", c: "columns", g: "grid", o: "overlay" };
  if (layouts[e.key]) state.layout = layouts[e.key];
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
  await loadCalibrations();
  analyzers = await (await api("/api/analyzers")).json();
  buildLayerControls();
  await loadPicker();
  window.addEventListener("focus", () => { loadPicker(); loadCalibrations().then(() => render()); });
  if (!STATIC) {
    workspace = new URLSearchParams(location.search).get("ws") || "";
    await listWorkspaces();
  }
  if (workspace) await openWorkspace(workspace);
  else refresh(true);
})();
