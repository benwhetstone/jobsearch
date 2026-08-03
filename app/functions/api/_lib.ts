// Shared helpers for the Pages Functions API.
// {data, meta} envelope on every response, per PROJECT-BRIEF §2.

export interface Env {
  DB: D1Database;
  APP_ENV?: string;
  // auth / admin
  APP_ADMIN_TOKEN?: string;      // bearer for cron/admin calls (e.g. notifications runner)
  BROWSER_APPLY_URL?: string;    // jobsearch-browser-apply worker endpoint (browser ATS submit)
  RELAY_DOMAIN?: string;         // shared relay domain for vanity apply addresses (multi-tenant)
  ROADMAP_TOKEN?: string;        // existing token, accepted as an admin fallback
  APP_SIGNUP_CODE?: string;      // if set, sign-up requires this invite code
  APP_BASE_URL?: string;         // e.g. https://jobs.benwhetstone.info (for links in emails)
  // email (optional; degrades to no-op if unset)
  RESEND_API_KEY?: string;
  NOTIFY_FROM?: string;          // e.g. "Job Search <notify@jobs.benwhetstone.info>"
  // AI (résumé parsing, tailoring, classification)
  ANTHROPIC_API_KEY?: string;
  // Job sources (aggregators). Keyless connectors need nothing.
  ADZUNA_APP_ID?: string;
  ADZUNA_APP_KEY?: string;
  RAPIDAPI_KEY?: string;         // JSearch (Google-for-Jobs via RapidAPI)
  JOOBLE_KEY?: string;
  CAREERJET_AFFID?: string;      // Careerjet public search affiliate id
  FINDWORK_KEY?: string;         // Findwork.dev token
  USAJOBS_KEY?: string;          // USAJOBS (federal) Authorization-Key
  USAJOBS_UA?: string;           // USAJOBS requires the registered email as User-Agent
  // Instance config (public, not secret)
  APP_TIPJAR_URL?: string;       // Stripe payment link; tip line hidden when unset
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type",
};

export function json(data: unknown, meta: Record<string, unknown> = {}, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ data, meta }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...headers },
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

// Admin bearer for cron/automation (notifications runner). Not user auth.
export function checkAdmin(request: Request, env: Env): boolean {
  const expected = env.APP_ADMIN_TOKEN || env.ROADMAP_TOKEN;
  if (!expected) return false;
  const m = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
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
  return true;
}

// Completion payload for one user.
export async function computeCompletion(env: Env, userId: string): Promise<{
  score: number;
  requiredScore: number;
  blocks: Record<string, { filledCount: number; totalCount: number; requiredFilled: number; requiredTotal: number }>;
}> {
  const fields = await env.DB.prepare(
    "SELECT field_key, block_key, is_required FROM profile_fields"
  ).all<{ field_key: string; block_key: string; is_required: number }>();
  const values = await env.DB.prepare(
    "SELECT field_key, value_json FROM profile_values WHERE user_id = ?"
  ).bind(userId).all<{ field_key: string; value_json: string | null }>();

  const filledSet = new Set<string>();
  for (const row of values.results ?? []) if (isFilled(row.value_json)) filledSet.add(row.field_key);

  const blocks: Record<string, { filledCount: number; totalCount: number; requiredFilled: number; requiredTotal: number }> = {};
  let total = 0, filled = 0, reqTotal = 0, reqFilled = 0;
  for (const f of fields.results ?? []) {
    const b = (blocks[f.block_key] ??= { filledCount: 0, totalCount: 0, requiredFilled: 0, requiredTotal: 0 });
    b.totalCount++; total++;
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

// Append one line to a job's activity timeline. Best-effort: a logging failure
// must never break the action it is recording, so callers can fire-and-forget.
export async function logActivity(
  env: Env, userId: string,
  ev: { applicationUuid?: string | null; queueId?: string | null; company?: string | null; title?: string | null;
        kind: string; message: string; meta?: unknown },
): Promise<void> {
  const jobKey = ev.company && ev.title
    ? `${String(ev.company).toLowerCase().trim()}|${String(ev.title).toLowerCase().trim()}`
    : null;
  await env.DB.prepare(
    `INSERT INTO activity_log (id, user_id, application_uuid, queue_id, job_key, kind, message, meta_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    crypto.randomUUID(), userId, ev.applicationUuid ?? null, ev.queueId ?? null, jobKey,
    String(ev.kind || "note").slice(0, 40), String(ev.message || "").slice(0, 1000),
    ev.meta == null ? null : JSON.stringify(ev.meta).slice(0, 4000), new Date().toISOString(),
  ).run().catch(() => {});
}

// Pull the authenticated user attached by the middleware.
export interface CtxUser { id: string; email: string; name: string | null; role: string; notify_email: number; }
export function currentUser(data: { user?: CtxUser }): CtxUser {
  return data.user as CtxUser;
}
