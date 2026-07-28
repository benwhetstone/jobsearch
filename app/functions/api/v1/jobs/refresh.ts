// POST /api/v1/jobs/refresh — manual sweep from the search bar. The same engine
// also runs automatically on the first login of the day (see _refresh.ts).
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";
import { runSweep } from "../../_refresh";

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ env, data }) => {
  const user = currentUser(data);
  const res = await runSweep(env, user.id, "search");
  if (!res.ok) return err(400, res.error || "Sweep failed.");
  const { ok, error, ...payload } = res;
  return json(payload);
};
