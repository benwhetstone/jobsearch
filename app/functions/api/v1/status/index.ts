// GET /api/v1/status — the realtime strip at the top of the app.
// One cheap call: queue depth, action-required count, unread mail, today's AI
// spend against the cap, and whether the morning sweep has run yet.
import { json, currentUser, type Env, type CtxUser } from "../../_lib";
import { spentTodayUsd, DAILY_BUDGET_USD } from "../../_ai";

export const onRequestGet: PagesFunction<Env, string, { user?: CtxUser }> = async ({ env, data }) => {
  const user = currentUser(data);
  const day = new Date().toISOString().slice(0, 10);
  const [apps, unread, sweep, spent] = await Promise.all([
    env.DB.prepare("SELECT status, COUNT(*) AS n FROM applications_v2 WHERE user_id = ? GROUP BY status")
      .bind(user.id).all<{ status: string; n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM inbox_emails WHERE user_id = ? AND read_at IS NULL")
      .bind(user.id).first<{ n: number }>().catch(() => null),
    env.DB.prepare("SELECT found, ran_at FROM daily_sweeps WHERE user_id = ? AND sweep_day = ?")
      .bind(user.id, day).first<{ found: number; ran_at: string }>().catch(() => null),
    spentTodayUsd(env, user.id),
  ]);
  const by: Record<string, number> = {};
  for (const r of apps.results ?? []) by[r.status] = r.n;
  return json({
    queue: { queued: by.queued || 0, preparing: by.preparing || 0 },
    actionRequired: by.actionRequired || 0,
    unreadMail: unread?.n ?? 0,
    sweep: sweep ? { found: sweep.found, ranAt: sweep.ran_at } : null,
    budget: { spentUsd: Math.round(spent * 1000) / 1000, capUsd: DAILY_BUDGET_USD },
  });
};
