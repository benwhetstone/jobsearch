// Shared helpers for the Pages Functions API.
// {data, meta} envelope on every response, per PROJECT-BRIEF §2.

export interface Env {
  DB: D1Database;
  APP_AUTH_TOKEN?: string;
  ROADMAP_TOKEN?: string;
  APP_ENV?: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type",
};

export function json(data: unknown, meta: Record<string, unknown> = {}, status = 200): Response {
  return new Response(JSON.stringify({ data, meta }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export function err(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

// Bearer auth. Accepts APP_AUTH_TOKEN, or the existing ROADMAP_TOKEN as a
// fallback so one secret can cover both surfaces during migration.
export function checkAuth(request: Request, env: Env): boolean {
  const expected = env.APP_AUTH_TOKEN || env.ROADMAP_TOKEN;
  if (!expected) return false; // fail closed: no token configured => no access
  const header = request.headers.get("Authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return !!m && m[1].trim() === expected;
}

// A value counts as "filled" if it is present and not an empty scalar/array.
export function isFilled(valueJson: string | null | undefined): boolean {
  if (valueJson == null) return false;
  let v: unknown;
  try {
    v = JSON.parse(valueJson);
  } catch {
    return valueJson.trim().length > 0;
  }
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true; // numbers, booleans
}

// Completion payload shared by /profile and /profile/completion.
export async function computeCompletion(env: Env): Promise<{
  score: number;
  requiredScore: number;
  blocks: Record<string, { filledCount: number; totalCount: number; requiredFilled: number; requiredTotal: number }>;
}> {
  const fields = await env.DB.prepare(
    "SELECT field_key, block_key, is_required FROM profile_fields"
  ).all<{ field_key: string; block_key: string; is_required: number }>();
  const values = await env.DB.prepare("SELECT field_key, value_json FROM profile_values").all<{
    field_key: string;
    value_json: string | null;
  }>();

  const filledSet = new Set<string>();
  for (const row of values.results ?? []) {
    if (isFilled(row.value_json)) filledSet.add(row.field_key);
  }

  const blocks: Record<string, { filledCount: number; totalCount: number; requiredFilled: number; requiredTotal: number }> = {};
  let total = 0, filled = 0, reqTotal = 0, reqFilled = 0;
  for (const f of fields.results ?? []) {
    const b = (blocks[f.block_key] ??= { filledCount: 0, totalCount: 0, requiredFilled: 0, requiredTotal: 0 });
    b.totalCount++;
    total++;
    const isf = filledSet.has(f.field_key);
    if (isf) { b.filledCount++; filled++; }
    if (f.is_required) {
      b.requiredTotal++; reqTotal++;
      if (isf) { b.requiredFilled++; reqFilled++; }
    }
  }
  return {
    score: total ? Math.round((100 * filled) / total) : 0,
    requiredScore: reqTotal ? Math.round((100 * reqFilled) / reqTotal) : 0,
    blocks,
  };
}
