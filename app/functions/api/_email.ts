// Transactional email via Resend. Degrades to a no-op (status 'skipped') when
// RESEND_API_KEY / NOTIFY_FROM are not configured, so the app deploys and runs
// before email is wired up.
import type { Env } from "./_lib";

export interface SendResult { status: "sent" | "skipped" | "failed"; providerId?: string; error?: string; }

export function emailConfigured(env: Env): boolean {
  return !!(env.RESEND_API_KEY && env.NOTIFY_FROM);
}

export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  html: string,
  text?: string
): Promise<SendResult> {
  if (!emailConfigured(env)) return { status: "skipped", error: "email not configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.NOTIFY_FROM, to, subject, html, text: text ?? stripHtml(html) }),
    });
    const body = await res.json().catch(() => ({} as any));
    if (!res.ok) return { status: "failed", error: body?.message || `HTTP ${res.status}` };
    return { status: "sent", providerId: body?.id };
  } catch (e: any) {
    return { status: "failed", error: e?.message || "network error" };
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const shell = (heading: string, bodyHtml: string, cta?: { label: string; url: string }) => `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#14181d">
    <h2 style="font-size:19px;margin:0 0 12px">${heading}</h2>
    ${bodyHtml}
    ${cta ? `<p style="margin:22px 0"><a href="${cta.url}" style="background:#2563eb;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600;display:inline-block">${cta.label}</a></p>` : ""}
    <p style="font-size:12px;color:#5c6875;margin-top:24px">Job Search Engine · you're receiving this because you have an account. Turn these off in your profile settings.</p>
  </div>`;

export function welcomeHtml(name: string | null, appUrl: string): string {
  return shell(
    `Welcome${name ? ", " + escapeHtml(name.split(" ")[0]) : ""}.`,
    `<p>Your Job Search account is set up. Fill out your profile once and the system uses it to score roles, tailor your resume, and prefill applications.</p>
     <p>You stay in control: nothing is ever submitted without your review.</p>`,
    { label: "Open my profile", url: appUrl }
  );
}

export function actionNeededHtml(name: string | null, items: { title: string; url?: string }[], appUrl: string): string {
  const list = items
    .slice(0, 8)
    .map((i) => `<li style="margin:6px 0">${escapeHtml(i.title)}</li>`)
    .join("");
  const more = items.length > 8 ? `<p style="font-size:13px;color:#5c6875">…and ${items.length - 8} more.</p>` : "";
  return shell(
    `You have ${items.length} thing${items.length === 1 ? "" : "s"} to review`,
    `<p>Log in when you have a minute:</p><ul style="padding-left:18px;margin:8px 0">${list}</ul>${more}`,
    { label: "Log in and review", url: appUrl }
  );
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
