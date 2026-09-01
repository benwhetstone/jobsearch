// Verify candidate ATS boards against live APIs; print the valid ones with
// how many analyst-ish roles they currently list. Only real, reachable boards
// get seeded into ats_boards.
const ANALYST = /(analyst|analytics|business intelligence|\bbi\b|data analy|insights|reporting)/i;

// Well-known companies that hire data/business analysts, by ATS.
const GH = ["stripe","gitlab","cloudflare","databricks","robinhood","coinbase","brex","plaid","affirm","chime","sofi","marqeta","mercury","betterment","wealthfront","nerdwallet","creditkarma","flexport","faire","samsara","benchling","checkr","gusto","gopuff","gorgias","webflow","retool","datadog","confluent","cockroachlabs","fivetran","discord","reddit","pinterest","lyft","opendoor","wayfair","chewy","peloton","oscar","cityblock","cedar","hims","calm","headspace","noom","anduril","instacart","doordash","twilio","hashicorp","dropbox","airbnb","asana","airtable","zapier","grammarly","1password","calendly","miro","vercel","attentive","amplitude","whoop","carta","gemini","circle","kraken","blockchain","toast","squarespace","warbyparker","allbirds","away","glossier","rothys","thirdlove","sweetgreen","cava","chipotle","udemy","coursera","duolingo","masterclass","outschool","handshake","guild","degreed"];
const LV = ["spotify","palantir","blend","kickstarter","mixpanel","brex2","voleon","numeric","ncino","jobandtalent","upstart","matchgroup","plaid","attn","valon","fanatics","gopuff","kandji","alma","ro","protocol"];
const AB = ["openai","ramp","notion","linear","vanta","scale","perplexity","deel","posthog","replit","runway","cursor","anthropic","hex","clay","sardine","mercor","together","modal","baseten","decagon","sierra","glean","harvey","abridge","cohere","huggingface","writer","adept","imbue","suno","elevenlabs","ramp2","watershed","found","tecton","gong","rippling"];

async function j(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 jobs.benwhetstone.info" } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function checkGH(t) {
  const d = await j(`https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=false`);
  if (!d || !Array.isArray(d.jobs)) return null;
  const a = d.jobs.filter((x) => ANALYST.test(x.title || "")).length;
  return { total: d.jobs.length, analyst: a };
}
async function checkLV(t) {
  const d = await j(`https://api.lever.co/v0/postings/${t}?mode=json&limit=200`);
  if (!Array.isArray(d)) return null;
  const a = d.filter((x) => ANALYST.test(x.text || "")).length;
  return { total: d.length, analyst: a };
}
async function checkAB(t) {
  const d = await j(`https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=false`);
  if (!d || !Array.isArray(d.jobs)) return null;
  const a = d.jobs.filter((x) => ANALYST.test(x.title || "")).length;
  return { total: d.jobs.length, analyst: a };
}

const valid = [];
async function run(list, ats, fn) {
  for (let i = 0; i < list.length; i += 8) {
    await Promise.all(list.slice(i, i + 8).map(async (t) => {
      const r = await fn(t);
      if (r && r.total > 0) { valid.push({ ats, token: t, ...r }); }
    }));
  }
}
await run(GH, "greenhouse", checkGH);
await run(LV, "lever", checkLV);
await run(AB, "ashby", checkAB);

valid.sort((a, b) => b.analyst - a.analyst);
console.log(`VALID ${valid.length} boards (of ${GH.length + LV.length + AB.length} candidates)`);
for (const v of valid) console.log(`${v.ats}\t${v.token}\t${v.total} jobs\t${v.analyst} analyst`);
// emit a SQL file to seed them
import { writeFileSync } from "node:fs";
const now = new Date().toISOString();
const rows = valid.map((v) => `('${v.ats}:${v.token}','${v.ats}','${v.token}','${now}')`).join(",\n");
writeFileSync("/tmp/claude-0/-home-user-jobsearch/7e161c50-10b0-5d88-ba8a-a46662ad5de2/scratchpad/seed-boards.sql",
  `INSERT INTO ats_boards (company_key, ats, token, checked_at) VALUES\n${rows}\nON CONFLICT(company_key) DO UPDATE SET ats=excluded.ats, token=excluded.token, checked_at=excluded.checked_at;`);
console.log("\nwrote seed-boards.sql");
