// Shared auth for the roadmap API.
//
// The page used to carry one hard-coded key that every visitor received, so
// "can read" and "can edit" were the same thing. They are split here: GET is
// public, which is what makes a view-only link possible, and every write needs
// a signed session cookie that only a sign-in can produce.
export interface Env { PROGRESS: KVNamespace; ROADMAP_KEY?: string; }

const SECRET_KEY = "authsecret";
const CRED_KEY = "authcred";
const COOKIE = "rm_session";
const SESSION_DAYS = 30;
export const OWNER_EMAIL = "brwhetstone@gmail.com";

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

async function secret(env: Env): Promise<string> {
  let v = await env.PROGRESS.get(SECRET_KEY);
  if (!v) { v = hex(crypto.getRandomValues(new Uint8Array(32)).buffer); await env.PROGRESS.put(SECRET_KEY, v); }
  return v;
}

// PBKDF2 rather than a bare digest: a stored hash should cost real time to
// attack even though there is exactly one account behind it.
export async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 50000, hash: "SHA-256" }, key, 256);
  return hex(bits);
}

export interface Cred { salt: string; hash: string; email: string; updated: number; }
export async function getCred(env: Env): Promise<Cred | null> {
  const raw = await env.PROGRESS.get(CRED_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as Cred; } catch { return null; }
}
export async function setPassword(env: Env, password: string): Promise<Cred> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const cred: Cred = { salt, hash: await hashPassword(password, salt), email: OWNER_EMAIL, updated: Date.now() };
  await env.PROGRESS.put(CRED_KEY, JSON.stringify(cred));
  return cred;
}
export async function checkPassword(env: Env, password: string): Promise<boolean> {
  const c = await getCred(env);
  if (!c) return false;
  const h = await hashPassword(password, c.salt);
  // constant-time-ish compare
  if (h.length !== c.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ c.hash.charCodeAt(i);
  return diff === 0;
}

async function sign(env: Env, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(await secret(env)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

export async function makeSession(env: Env): Promise<string> {
  const body = JSON.stringify({ e: OWNER_EMAIL, x: Date.now() + SESSION_DAYS * 864e5 });
  const p = b64url(body);
  return p + "." + (await sign(env, p));
}

export async function validSession(request: Request, env: Env): Promise<boolean> {
  const raw = (request.headers.get("Cookie") || "")
    .split(";").map((s) => s.trim()).find((s) => s.startsWith(COOKIE + "="));
  if (!raw) return false;
  const token = decodeURIComponent(raw.slice(COOKIE.length + 1));
  const [p, sig] = token.split(".");
  if (!p || !sig) return false;
  if ((await sign(env, p)) !== sig) return false;
  try { const d = JSON.parse(unb64url(p)); return d.x > Date.now(); } catch { return false; }
}

export const sessionCookie = (token: string) =>
  `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`;
export const clearCookie = () => `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

export const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json", "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,x-roadmap-key",
    "access-control-allow-methods": "GET,POST,OPTIONS", ...extra } });
