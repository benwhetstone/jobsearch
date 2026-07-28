// Anthropic client for Cloudflare Workers (raw fetch). Haiku 4.5 is the default
// workhorse: cheap, fast, strong at structured extraction and classification.
import type { Env } from "./_lib";

export const AI_MODEL = "claude-haiku-4-5";

export interface Block { type: string; [k: string]: unknown; }

export async function anthropic(
  env: Env,
  opts: { system?: string; content: Block[] | string; maxTokens?: number; model?: string }
): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const content = typeof opts.content === "string" ? [{ type: "text", text: opts.content }] : opts.content;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model || AI_MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: "user", content }],
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message || `Anthropic HTTP ${res.status}`);
  return (json.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

// Pull the first JSON object/array out of a model reply (handles ``` fences).
export function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start < 0) throw new Error("no JSON found in model output");
  // find matching end by scanning
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error("unterminated JSON in model output");
  return JSON.parse(body.slice(start, end + 1));
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}
