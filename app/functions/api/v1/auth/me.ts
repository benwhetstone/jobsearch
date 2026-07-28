// GET /api/v1/auth/me  -> current signed-in user (or null; route is public).
//
// This is the boot call, which makes it the right place for the product's core
// promise: on the FIRST login of the day, today's matches start populating in
// the background before the user touches anything. Search is refinement; the
// system surfaces work on its own.
import { json, type Env } from "../../_lib";
import { getSessionUser } from "../../_auth";
import { ensureDailySweep } from "../../_refresh";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const session = await getSessionUser(env, request);
  if (!session) return json({ user: null });
  const u = session.user;

  // Kick the daily sweep without blocking the response. sweepStarted tells the
  // UI to show "finding today's matches" and poll instead of an empty state.
  let sweepStarted = false;
  const day = new Date().toISOString().slice(0, 10);
  const already = await env.DB.prepare("SELECT 1 AS x FROM daily_sweeps WHERE user_id = ? AND sweep_day = ?")
    .bind(u.id, day).first().catch(() => null);
  if (!already) {
    sweepStarted = true;
    context.waitUntil(ensureDailySweep(env, u.id).catch(() => {}));
  }

  return json({
    user: { id: u.id, email: u.email, name: u.name, role: u.role, notifyEmail: !!u.notify_email },
    sweepStarted,
    tipjarUrl: env.APP_TIPJAR_URL || null,
  });
};
