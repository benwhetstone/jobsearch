// POST /api/v1/jobs/refresh — manual sweep from the search bar. The same engine
// also runs automatically on the first login of the day (see _refresh.ts).
import { json, err, currentUser, type Env, type CtxUser } from "../../_lib";
import { runSweep } from "../../_refresh";
import { scanGmail } from "../../_gmail";

export const onRequestPost: PagesFunction<Env, string, { user?: CtxUser }> = async ({ request, env, data, waitUntil }) => {
  const user = currentUser(data);
  // origin "auto" = the Jobs For You refresh button re-running the daily
  // sweep; anything else is the search bar.
  let origin: "auto" | "search" = "search";
  try { if ((await request.json() as any)?.origin === "auto") origin = "auto"; } catch { /* empty body */ }
  const res = await runSweep(env, user.id, origin);
  if (!res.ok) return err(400, res.error || "Sweep failed.");
  // Fold in outside applications: scan the connected Gmail for confirmations
  // and status updates, keeping the tracker current. Best-effort, in the
  // background — a mail hiccup never blocks the board refresh. No-op if the
  // user hasn't connected Gmail.
  waitUntil(scanGmail(env, user.id, { days: 14, max: 40 }).catch(() => {}));
  const { ok, error, ...payload } = res;
  return json(payload);
};
