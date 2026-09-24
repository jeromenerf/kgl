// Data access for the workbench pages (specs/005 phase 1).
//
// On the back end, api() is fetch() on /api/*. On a published static site
// (<body data-static="1">) the same calls are answered from the exported
// files (data/*.json) and from this browser's storage: ratings and
// calibrations belong to the visitor and are never shared (workspaces and
// notes need the back end and are not on the static site). Calibrations
// are kept in the browser on the back end too (see calibrations()).
export const STATIC = document.body.dataset.static === "1";

const KEY = "kgl.static.";
function load(name, fallback) {
  try { return JSON.parse(localStorage.getItem(KEY + name)) ?? fallback; } catch { return fallback; }
}
function save(name, value) {
  try { localStorage.setItem(KEY + name, JSON.stringify(value)); return true; } catch { return false; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const file = async path => (await fetch(path)).json();

async function staticApi(path, init = {}) {
  const url = new URL(path, location.href);
  const method = (init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  const parts = url.pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent); // after "api"
  const [res, id, sub] = parts;
  if (res === "geometries" && method === "GET") {
    const stars = load("stars", {});
    return json((await file("data/geometries.json")).map(g => ({ ...g, stars: stars[g.slug] || 0 })));
  }
  if (res === "geometries" && sub === "stars") {
    const stars = load("stars", {});
    if (body.stars > 0) stars[id] = body.stars; else delete stars[id];
    return save("stars", stars) ? json({ slug: id, stars: body.stars }) : json({ error: "storage unavailable" }, 500);
  }
  if (res === "canonical") {
    // Only active versions are published: a pinned "slug@version" shows the active one.
    const slugs = url.searchParams.getAll("g").map(r => r.split("@")[0]);
    const out = [];
    for (const s of slugs) {
      const r = await fetch(`data/g/${encodeURIComponent(s)}.json`);
      if (r.ok) out.push(await r.json());
    }
    return json(out);
  }
  if (res === "analyzers") return json(await file("data/analyzers.json"));
  if (res === "calibrations") return calibrations(method, body);
  return json({ error: "not available on the static site" }, 404);
}

// Display calibrations belong to a screen, a zoom and a device: they are kept
// in this browser in both modes (user). On the back end, calibrations saved
// there before are copied into the browser once.
async function calibrations(method, body) {
  let all = load("calibrations", null);
  if (all === null) {
    all = [];
    if (!STATIC) {
      try { all = await (await fetch("/api/calibrations")).json(); } catch { /* none */ }
    }
    save("calibrations", all);
  }
  if (method === "GET") return json(all);
  const c = { ...body, updated_at: new Date().toISOString() };
  const next = [c, ...all.filter(x => x.name !== c.name)];
  return save("calibrations", next) ? json(c) : json({ error: "storage unavailable" }, 500);
}

export const api = STATIC ? staticApi : (path, init) => {
  if (new URL(path, location.href).pathname === "/api/calibrations") {
    return calibrations((init?.method || "GET").toUpperCase(), init?.body ? JSON.parse(init.body) : null);
  }
  return fetch(path, init);
};
