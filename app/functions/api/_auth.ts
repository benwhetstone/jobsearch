// Auth helpers: PBKDF2 password hashing (WebCrypto, no deps), sessions, cookies.
import type { Env } from "./_lib";

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  notify_email: number;
}

const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_DAYS = 30;
const COOKIE_NAME = "jse_session";
const enc = new TextEncoder();

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return { hash: toHex(bits), salt: toHex(salt) };
}

// Constant-time-ish comparison.
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(password: string, hashHex: string, saltHex: string): Promise<boolean> {
  const { hash } = await hashPassword(password, saltHex);
  return safeEqual(hash, hashHex);
}

// --- sessions ---------------------------------------------------------------
export async function createSession(env: Env, userId: string, ttlDays = SESSION_TTL_DAYS): Promise<string> {
  const token = randomHex(32);
  const now = new Date();
  const expires = new Date(now.getTime() + ttlDays * 86400_000);
  await env.DB.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(token, userId, now.toISOString(), expires.toISOString())
    .run();
  return token;
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

export function readSessionCookie(request: Request): string | null {
  const cookie = request.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// A session token can arrive two ways: the browser's cookie, or an
// `Authorization: Bearer <token>` header. The header path lets a headless
// client (Cowork) act as the signed-in user with a long-lived session token,
// no browser required. Both resolve through the same sessions table.
export function readBearerToken(request: Request): string | null {
  const m = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function getSessionUser(env: Env, request: Request): Promise<{ user: User; token: string } | null> {
  const token = readSessionCookie(request) || readBearerToken(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.notify_email, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`
  ).bind(token).first<User & { expires_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await destroySession(env, token);
    return null;
  }
  const { expires_at, ...user } = row;
  return { user: user as User, token };
}

export function sessionCookie(token: string): string {
  const maxAge = SESSION_TTL_DAYS * 86400;
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
export function clearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}
