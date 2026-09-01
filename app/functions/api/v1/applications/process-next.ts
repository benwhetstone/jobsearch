// POST /api/v1/applications/process-next — drain one queued application.
// The UI polls this while a queue exists, so the chain survives lost links.
import { json, currentUser, type Env, type CtxUser } from "../../_lib";
import { drainOne } from "./bulk";

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ env, data }) => {
  const user = currentUser(data);
  return json(await drainOne(env, user));
};
