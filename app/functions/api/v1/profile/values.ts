// PATCH /api/v1/profile/values   (POST accepted too)
// body: { values: [ { fieldKey, value } ] }
// Upserts values, validating against each field's type and enum. Enum validation
// is what keeps matching deterministic: a value that is not on the option list is
// rejected, not silently stored. Sending null / "" / [] CLEARS a field.
import { json, err, computeCompletion, type Env } from "../../_lib";

interface FieldDef {
  field_key: string; field_type: string; options_json: string; is_multi_select: number;
}

interface Incoming { fieldKey?: string; field_key?: string; value: unknown; }

function coerce(field: FieldDef, value: unknown): { ok: true; value: unknown } | { ok: false; msg: string } {
  const options: string[] = (() => { try { return JSON.parse(field.options_json) || []; } catch { return []; } })();
  const hasEnum = options.length > 0;

  switch (field.field_type) {
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return { ok: false, msg: "expected a number" };
      if (hasEnum && !options.includes(String(n))) return { ok: false, msg: `must be one of: ${options.join(", ")}` };
      return { ok: true, value: n };
    }
    case "boolean": {
      if (typeof value === "boolean") return { ok: true, value };
      if (value === "true" || value === "false") return { ok: true, value: value === "true" };
      return { ok: false, msg: "expected a boolean" };
    }
    case "string": {
      if (typeof value !== "string") return { ok: false, msg: "expected a string" };
      if (hasEnum && !options.includes(value)) return { ok: false, msg: `must be one of: ${options.join(", ")}` };
      return { ok: true, value };
    }
    case "string_array": {
      if (!Array.isArray(value) || value.some((x) => typeof x !== "string"))
        return { ok: false, msg: "expected an array of strings" };
      if (hasEnum) {
        const bad = value.filter((x) => !options.includes(x as string));
        if (bad.length) return { ok: false, msg: `invalid option(s): ${bad.join(", ")}. allowed: ${options.join(", ")}` };
      }
      return { ok: true, value };
    }
    case "object_array": {
      if (!Array.isArray(value) || value.some((x) => typeof x !== "object" || x == null || Array.isArray(x)))
        return { ok: false, msg: "expected an array of objects" };
      return { ok: true, value };
    }
    default:
      return { ok: true, value };
  }
}

function isClear(value: unknown): boolean {
  return value == null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0);
}

const handler: PagesFunction<Env> = async ({ request, env }) => {
  let body: { values?: Incoming[] };
  try {
    body = await request.json();
  } catch {
    return err(400, "Body must be JSON: { values: [ { fieldKey, value } ] }");
  }
  const items = Array.isArray(body?.values) ? body.values : null;
  if (!items) return err(400, "Expected a non-empty `values` array.");
  if (items.length > 200) return err(400, "Too many values in one request (max 200).");

  // Load field defs referenced by this request.
  const keys = items.map((i) => i.fieldKey ?? i.field_key).filter(Boolean) as string[];
  if (!keys.length) return err(400, "No fieldKey provided on any value.");
  const placeholders = keys.map(() => "?").join(",");
  const defsRes = await env.DB.prepare(
    `SELECT field_key, field_type, options_json, is_multi_select FROM profile_fields WHERE field_key IN (${placeholders})`
  ).bind(...keys).all<FieldDef>();
  const defs = new Map<string, FieldDef>();
  for (const d of defsRes.results ?? []) defs.set(d.field_key, d);

  const now = new Date().toISOString();
  const saved: string[] = [];
  const cleared: string[] = [];
  const errors: { fieldKey: string; message: string }[] = [];
  const statements: D1PreparedStatement[] = [];

  for (const item of items) {
    const fk = (item.fieldKey ?? item.field_key) as string | undefined;
    if (!fk) { errors.push({ fieldKey: "(missing)", message: "fieldKey required" }); continue; }
    const def = defs.get(fk);
    if (!def) { errors.push({ fieldKey: fk, message: "unknown field" }); continue; }

    if (isClear(item.value)) {
      statements.push(env.DB.prepare("DELETE FROM profile_values WHERE field_key = ?").bind(fk));
      cleared.push(fk);
      continue;
    }
    const c = coerce(def, item.value);
    if (!c.ok) { errors.push({ fieldKey: fk, message: c.msg }); continue; }
    statements.push(
      env.DB.prepare(
        "INSERT OR REPLACE INTO profile_values (field_key, value_json, updated_at) VALUES (?, ?, ?)"
      ).bind(fk, JSON.stringify(c.value), now)
    );
    saved.push(fk);
  }

  if (statements.length) await env.DB.batch(statements);

  const completion = await computeCompletion(env);
  const status = errors.length && !statements.length ? 422 : 200;
  return json({ saved, cleared, errors, completion }, { savedCount: saved.length, errorCount: errors.length }, status);
};

export const onRequestPatch = handler;
export const onRequestPost = handler;
