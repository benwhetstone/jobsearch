// GET /api/v1/profile/completion
// -> { score, requiredScore, blocks: { <blockKey>: {filledCount, totalCount, ...} } }
import { json, computeCompletion, type Env } from "../../_lib";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const c = await computeCompletion(env);
  return json(c);
};
