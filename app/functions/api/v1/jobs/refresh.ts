// POST /api/v1/jobs/refresh — manual sweep from the search bar. The same engine
// also runs automatically on the first login of the day (see _refresh.ts).
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";
import { runSweep } from "../../_refresh";

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data }) => {
  const user = currentUser(data);
  // origin "auto" = the Jobs For You refresh button re-running the daily
  // sweep; anything else is the search bar.
  let origin: "auto" | "search" = "search";
  try { if ((await request.json() as any)?.origin === "auto") origin = "auto"; } catch { /* empty body */ }
  const res = await runSweep(env, user.id, origin);
  if (!res.ok) return err(400, res.error || "Sweep failed.");
  const { ok, error, ...payload } = res;
  return json(payload);
};
