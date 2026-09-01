// GET /api/v1/profile/completion
// -> { score, requiredScore, blocks: { <blockKey>: {filledCount, totalCount, ...} } }
import { json, computeCompletion, currentUser, type Env, type CtxUser } from "../../_lib";

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ env, data }) => {
  const user = currentUser(data);
  const c = await computeCompletion(env, user.id);
  return json(c);
};
