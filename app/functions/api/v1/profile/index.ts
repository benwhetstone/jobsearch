// GET /api/v1/profile
// Returns the whole profile: blocks -> categories -> fields, each field carrying
// its definition (question, options, flags) and Ben's current value.
import { json, isFilled, computeCompletion, currentUser, type Env, type CtxUser } from "../../_lib";

interface BlockRow { key: string; label: string; description: string | null; sort_order: number; }
interface FieldRow {
  field_key: string; block_key: string; category_key: string; category_label: string | null;
  field_type: string; question: string | null; options_json: string; is_multi_select: number;
  is_required: number; is_matching_input: number; help_text: string | null; sort_order: number;
}

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ env, data }) => {
  const user = currentUser(data);
  const [blocks, fields, values, completion] = await Promise.all([
    env.DB.prepare("SELECT * FROM profile_blocks ORDER BY sort_order").all<BlockRow>(),
    env.DB.prepare("SELECT * FROM profile_fields ORDER BY block_key, sort_order").all<FieldRow>(),
    env.DB.prepare("SELECT field_key, value_json, updated_at FROM profile_values WHERE user_id = ?").bind(user.id).all<{
      field_key: string; value_json: string | null; updated_at: string;
    }>(),
    computeCompletion(env, user.id),
  ]);

  const valueMap = new Map<string, { value_json: string | null; updated_at: string }>();
  for (const v of values.results ?? []) valueMap.set(v.field_key, v);

  const parseJson = (s: string | null, fallback: unknown) => {
    if (s == null) return fallback;
    try { return JSON.parse(s); } catch { return fallback; }
  };

  const out = (blocks.results ?? []).map((b) => {
    const blockFields = (fields.results ?? []).filter((f) => f.block_key === b.key);
    // group into categories, preserving field order
    const catOrder: string[] = [];
    const catMap = new Map<string, { key: string; label: string; fields: unknown[] }>();
    for (const f of blockFields) {
      if (!catMap.has(f.category_key)) {
        catMap.set(f.category_key, { key: f.category_key, label: f.category_label ?? f.category_key, fields: [] });
        catOrder.push(f.category_key);
      }
      const v = valueMap.get(f.field_key);
      catMap.get(f.category_key)!.fields.push({
        fieldKey: f.field_key,
        fieldType: f.field_type,
        question: f.question,
        options: parseJson(f.options_json, []),
        isMultiSelect: !!f.is_multi_select,
        isRequired: !!f.is_required,
        isMatchingInput: !!f.is_matching_input,
        helpText: f.help_text,
        value: v ? parseJson(v.value_json, null) : null,
        filled: isFilled(v?.value_json),
        updatedAt: v?.updated_at ?? null,
      });
    }
    const cc = completion.blocks[b.key] ?? { filledCount: 0, totalCount: 0, requiredFilled: 0, requiredTotal: 0 };
    return {
      key: b.key,
      label: b.label,
      description: b.description,
      completion: cc,
      categories: catOrder.map((k) => catMap.get(k)!),
    };
  });

  return json(
    { blocks: out, completion: { score: completion.score, requiredScore: completion.requiredScore } },
    { totalRecords: out.length }
  );
};
