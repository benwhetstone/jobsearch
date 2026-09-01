// Daily snapshot of the roadmap's KV store into the d1-backups bucket.
//
// Written as bens-roadmap-kv/<YYYY-MM-DD>.json to sit alongside the six
// <project>/<date>.sql dumps the d1-backups worker already writes.

const KEYS = ["items", "state", "salaries", "authcred"];

async function snapshot(env) {
  const out = { takenAt: new Date().toISOString(), keys: {} };
  for (const k of KEYS) {
    const raw = await env.PROGRESS.get(k);
    // Store the parsed value where possible so a snapshot is readable, and the
    // raw string when it is not JSON, so nothing is silently lost.
    if (raw == null) { out.keys[k] = null; continue; }
    try { out.keys[k] = JSON.parse(raw); } catch { out.keys[k] = { _raw: raw }; }
  }
  return out;
}

// A backup that overwrites a good copy with an empty one is worse than no
// backup, so an empty board refuses to write.
function sane(snap) {
  const items = snap.keys.items && snap.keys.items.items;
  if (!items) return "items key missing or unreadable";
  const n = Object.values(items).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
  if (n === 0) return "board came back with zero cards";
  return null;
}

async function run(env) {
  const snap = await snapshot(env);
  const bad = sane(snap);
  if (bad) { console.log("REFUSING to write backup:", bad); return { ok: false, reason: bad }; }
  const day = snap.takenAt.slice(0, 10);
  const key = `bens-roadmap-kv/${day}.json`;
  const body = JSON.stringify(snap, null, 2);
  await env.BACKUPS.put(key, body, { httpMetadata: { contentType: "application/json" } });
  console.log(`wrote ${key} (${body.length} bytes)`);
  return { ok: true, key, bytes: body.length };
}

export default {
  async scheduled(_event, env, ctx) { ctx.waitUntil(run(env)); },
  // Same job on demand, so a restore can be preceded by a fresh snapshot.
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/run") return new Response("roadmap-kv-backup", { status: 200 });
    const r = await run(env);
    return new Response(JSON.stringify(r), { status: r.ok ? 200 : 500, headers: { "content-type": "application/json" } });
  },
};
