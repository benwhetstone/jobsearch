/* Job Search Engine — profile editor (Phase 1). Vanilla JS, no build step.
   Auth is cookie-session based: the browser holds an HttpOnly session cookie,
   so nothing sensitive lives in JS. */
(() => {
  "use strict";
  let MODEL = null; // last /profile payload
  let MODE = "login"; // login | signup

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  async function api(path, opts = {}) {
    const res = await fetch(`/api/v1${path}`, {
      ...opts,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (res.status === 401) { showAuth(); throw new Error("unauthorized"); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { body, status: res.status });
    return body;
  }

  // ---- auth --------------------------------------------------------------
  function showAuth() { $("#app").hidden = true; $("#auth").hidden = false; }
  function showApp() { $("#auth").hidden = true; $("#app").hidden = false; }

  function setMode(mode) {
    MODE = mode;
    const signup = mode === "signup";
    $("#authSub").textContent = signup ? "Create your account." : "Sign in to your account.";
    $("#authSubmit").textContent = signup ? "Create account" : "Sign in";
    $("#name").hidden = !signup;
    $("#inviteCode").hidden = !signup;
    $("#password").setAttribute("autocomplete", signup ? "new-password" : "current-password");
    $("#switchText").textContent = signup ? "Already have an account?" : "New here?";
    $("#switchMode").textContent = signup ? "Sign in" : "Create an account";
    $("#authErr").hidden = true;
  }
  $("#switchMode").addEventListener("click", () => setMode(MODE === "login" ? "signup" : "login"));

  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#email").value.trim();
    const password = $("#password").value;
    const name = $("#name").value.trim();
    const inviteCode = $("#inviteCode").value.trim();
    $("#authErr").hidden = true;
    if (!email || !password) return;
    try {
      if (MODE === "signup") {
        const r = await api("/auth/signup", { method: "POST", body: JSON.stringify({ email, password, name, inviteCode }) });
        if (r.data.claimed) toast("Welcome back — your profile was already set up.");
      } else {
        await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      }
      showApp();
      boot();
    } catch (err) {
      $("#authErr").hidden = false;
      $("#authErr").textContent = err.message || "Something went wrong.";
    }
  });

  ["#logout", "#logoutM"].forEach((sel) => {
    const b = $(sel);
    if (b) b.addEventListener("click", async () => {
      try { await api("/auth/logout", { method: "POST" }); } catch {}
      showAuth();
    });
  });

  // Generate a long-lived API token for Cowork (or any headless client). The
  // secret is created and shown here, in Ben's own signed-in browser.
  $("#btnCoworkToken")?.addEventListener("click", async () => {
    if (!confirm("Generate a Cowork API token?\n\nThis creates a key that lets Cowork read and update your job search for one year. It's shown once — copy it into your Cowork environment as JOBS_API_TOKEN.")) return;
    let r; try { r = (await api("/auth/api-token", { method: "POST" })).data; }
    catch (e) { toast(e.message || "Could not create token", 3500); return; }
    const ov = el("div", "token-ov");
    ov.style.cssText = "position:fixed;inset:0;background:rgba(15,20,30,.55);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px";
    const m = el("div");
    m.style.cssText = "background:var(--panel,#fff);color:var(--text,#14181d);border-radius:14px;max-width:560px;width:100%;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.35);max-height:90vh;overflow:auto";
    m.addEventListener("click", (e) => e.stopPropagation());
    m.appendChild(el("h3", null, "Your Cowork API token"));
    const p = el("p", null, "Copy this now — it won't be shown again. Set it in your Cowork environment as JOBS_API_TOKEN; Cowork sends it as an Authorization: Bearer header.");
    p.style.cssText = "margin:4px 0 14px;font-size:13px;color:var(--muted)";
    m.appendChild(p);
    const ta = el("textarea"); ta.value = r.token; ta.readOnly = true; ta.rows = 3;
    ta.style.cssText = "width:100%;box-sizing:border-box;font-family:monospace;font-size:12px;padding:10px;border:1px solid var(--border,#d7dbe3);border-radius:8px;word-break:break-all";
    m.appendChild(ta);
    const row = el("div", null); row.style.cssText = "display:flex;gap:10px;margin-top:14px;justify-content:flex-end";
    const copy = el("button", "btn primary", "Copy");
    copy.addEventListener("click", () => { ta.select(); try { document.execCommand("copy"); } catch {} navigator.clipboard?.writeText(r.token).catch(() => {}); copy.textContent = "Copied ✓"; });
    const close = el("button", "btn ghost", "Done");
    close.addEventListener("click", () => ov.remove());
    row.appendChild(copy); row.appendChild(close); m.appendChild(row);
    ov.addEventListener("click", () => ov.remove());
    ov.appendChild(m); document.body.appendChild(ov);
    ta.focus(); ta.select();
  });

  // ---- view switching (sidebar + mobile tab bar) --------------------------
  let CURRENT_VIEW = "matches";
  function switchView(view) {
    CURRENT_VIEW = view;
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== "view-" + view; });
    document.querySelectorAll("#sidenav button, #tabbar button").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === view);
    });
    if (view === "matches" && !MATCHES_LOADED) loadMatches();
    if (view === "apply") loadApplyQueue();
    if (view === "applications") loadApplications();
    if (view === "inbox") loadInbox("all");
    if (view === "templates") renderTemplates();
    if (view === "profile" && !MODEL) loadProfile();
    window.scrollTo(0, 0);
  }
  document.querySelectorAll("#sidenav button, #tabbar button").forEach((b) => {
    b.addEventListener("click", () => switchView(b.dataset.view));
  });

  // ---- toast -------------------------------------------------------------
  let toastTimer;
  function toast(msg, ms = 1600) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  // ---- save (debounced per field) ---------------------------------------
  const saveTimers = new Map();
  function queueSave(fieldKey, value, fieldEl) {
    clearTimeout(saveTimers.get(fieldKey));
    fieldEl.classList.add("saving");
    saveTimers.set(fieldKey, setTimeout(() => save(fieldKey, value, fieldEl), 450));
  }
  async function save(fieldKey, value, fieldEl) {
    try {
      const r = await api("/profile/values", { method: "PATCH", body: JSON.stringify({ values: [{ fieldKey, value }] }) });
      fieldEl.classList.remove("saving", "error-flash");
      const msg = $(".fieldmsg", fieldEl);
      const fieldErr = (r.data.errors || []).find((e) => e.fieldKey === fieldKey);
      if (fieldErr) {
        fieldEl.classList.add("error-flash");
        if (msg) msg.textContent = fieldErr.message;
        return;
      }
      if (msg) msg.textContent = "";
      applyCompletion(r.data.completion);
      flashSaved(fieldEl);
    } catch (e) {
      fieldEl.classList.remove("saving");
      const msg = $(".fieldmsg", fieldEl);
      if (msg) msg.textContent = e.message || "save failed";
      toast("Save failed");
    }
  }
  function flashSaved(fieldEl) {
    fieldEl.classList.add("saved-flash");
    const msg = $(".fieldmsg", fieldEl);
    if (msg) { msg.textContent = "Saved"; msg.classList.add("ok"); }
    setTimeout(() => {
      fieldEl.classList.remove("saved-flash");
      if (msg && msg.textContent === "Saved") { msg.textContent = ""; msg.classList.remove("ok"); }
    }, 1400);
  }

  // ---- completion bars ---------------------------------------------------
  function pct(filled, total) { return total ? Math.round((100 * filled) / total) : 0; }
  function applyCompletion(c) {
    if (!c) return;
    const cp = $("#cntProfile");
    if (cp && c.score != null) { cp.textContent = c.score + "%"; cp.hidden = false; }
    if (c.blocks) {
      for (const [key, b] of Object.entries(c.blocks)) {
        const p = pct(b.filledCount, b.totalCount);
        const fill = document.querySelector(`[data-block-fill="${key}"]`);
        if (fill) fill.style.width = p + "%";
        const lbl = document.querySelector(`[data-block-lbl="${key}"]`);
        if (lbl) lbl.textContent = `${b.filledCount}/${b.totalCount}`;
        const nav = document.querySelector(`[data-nav-mini="${key}"]`);
        if (nav) nav.textContent = `${b.filledCount}/${b.totalCount}`;
      }
    }
  }

  // ---- field renderers ---------------------------------------------------
  function renderField(f) {
    const wrap = el("div", "field");
    wrap.dataset.field = f.fieldKey;
    const label = el("label");
    label.appendChild(document.createTextNode(f.question || f.fieldKey));
    if (f.isRequired) { const s = el("span", "req", "*"); s.title = "Required"; label.appendChild(s); }
    if (f.isMatchingInput) {
      const b = el("span", "match-badge", "match");
      b.title = "This answer is used to score how well jobs match you";
      label.appendChild(b);
    }
    wrap.appendChild(label);
    if (f.helpText) wrap.appendChild(el("div", "help", f.helpText));

    const control = buildControl(f, wrap);
    wrap.appendChild(control);
    wrap.appendChild(el("div", "fieldmsg"));
    return wrap;
  }

  function buildControl(f, wrap) {
    const opts = Array.isArray(f.options) ? f.options : [];
    const type = f.fieldType;

    // boolean -> Yes/No chips
    if (type === "boolean") {
      const box = el("div", "chips");
      [["Yes", true], ["No", false]].forEach(([lbl, v]) => {
        const c = el("div", "chip bool", lbl);
        if (f.value === v) c.classList.add("on");
        c.addEventListener("click", () => {
          box.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
          c.classList.add("on");
          f.value = v; queueSave(f.fieldKey, v, wrap);
        });
        box.appendChild(c);
      });
      return box;
    }

    // number
    if (type === "number" && opts.length === 0) {
      const i = el("input"); i.type = "number"; if (f.value != null) i.value = f.value;
      i.addEventListener("input", () => queueSave(f.fieldKey, i.value === "" ? null : Number(i.value), wrap));
      return i;
    }

    // enum scalar (string or number with options) -> select
    if (opts.length && !f.isMultiSelect && type !== "string_array") {
      const sel = el("select");
      sel.appendChild(new Option("— select —", ""));
      opts.forEach((o) => { const opt = new Option(pretty(o), o); if (String(f.value) === String(o)) opt.selected = true; sel.appendChild(opt); });
      sel.addEventListener("change", () => {
        const v = sel.value === "" ? null : (type === "number" ? Number(sel.value) : sel.value);
        f.value = v; queueSave(f.fieldKey, v, wrap);
      });
      return sel;
    }

    // enum multi -> chips
    if (opts.length && (f.isMultiSelect || type === "string_array")) {
      const box = el("div", "chips");
      const current = new Set(Array.isArray(f.value) ? f.value : []);
      opts.forEach((o) => {
        const c = el("div", "chip", pretty(o));
        if (current.has(o)) c.classList.add("on");
        c.addEventListener("click", () => {
          if (current.has(o)) { current.delete(o); c.classList.remove("on"); }
          else { current.add(o); c.classList.add("on"); }
          const arr = [...current]; f.value = arr; queueSave(f.fieldKey, arr, wrap);
        });
        box.appendChild(c);
      });
      return box;
    }

    // free string array -> tag input
    if (type === "string_array") {
      return tagInput(f, wrap);
    }

    // object array -> summary + JSON editor toggle
    if (type === "object_array") {
      return objectArray(f, wrap);
    }

    // default string -> auto-growing textarea. One-line answers look like an
    // input; long answers wrap instead of forcing sideways scrolling.
    const i = el("textarea", "autosize");
    i.rows = 1;
    if (f.value != null) i.value = f.value;
    i.addEventListener("input", () => { autoGrow(i); queueSave(f.fieldKey, i.value === "" ? null : i.value, wrap); });
    requestAnimationFrame(() => autoGrow(i));
    return i;
  }

  function autoGrow(t) {
    t.style.height = "auto";
    t.style.height = Math.min(360, Math.max(42, t.scrollHeight + 2)) + "px";
  }

  function tagInput(f, wrap) {
    const box = el("div", "tags");
    const arr = Array.isArray(f.value) ? [...f.value] : [];
    const input = el("input"); input.placeholder = "type and press Enter";
    function commit() { f.value = [...arr]; queueSave(f.fieldKey, [...arr], wrap); }
    function redraw() {
      box.querySelectorAll(".tagitem").forEach((x) => x.remove());
      arr.forEach((t, idx) => {
        const item = el("span", "tagitem"); item.appendChild(document.createTextNode(t));
        const x = el("b", null, "×"); x.addEventListener("click", () => { arr.splice(idx, 1); redraw(); commit(); });
        item.appendChild(x); box.insertBefore(item, input);
      });
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); const v = input.value.trim(); if (v) { arr.push(v); input.value = ""; redraw(); commit(); } }
      else if (e.key === "Backspace" && input.value === "" && arr.length) { arr.pop(); redraw(); commit(); }
    });
    box.appendChild(input); redraw();
    return box;
  }

  // How each object_array field is edited by a human. name-lists are add/remove
  // tags; "records" are card forms with labeled inputs. No JSON.
  const SKILL_LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"];
  const LANG_LEVELS = ["BASIC", "INTERMEDIATE", "PROFESSIONAL", "FLUENT", "NATIVE"];
  const OBJECT_ARRAY_SPEC = {
    st_jobTitles: { kind: "namelist", singular: "job title", placeholder: "e.g. Data Analyst" },
    st_softSkills: { kind: "namelist", singular: "soft skill", placeholder: "e.g. Stakeholder Communication" },
    st_industryDomainKnowledge: { kind: "namelist", singular: "industry", placeholder: "e.g. Real Estate" },
    st_professionalCredential: { kind: "namelist", singular: "credential", placeholder: "e.g. DP-900" },
    st_hardSkills: { kind: "namelist", singular: "skill", placeholder: "e.g. SQL", withLevel: true, levels: SKILL_LEVELS },
    workLanguage: { kind: "namelist", singular: "language", placeholder: "e.g. English", withLevel: true, levels: LANG_LEVELS },
    otherSocialHandles: { kind: "namelist", singular: "link", placeholder: "e.g. github.com/you", nameKey: "url" },
    st_workExperiences: { kind: "records", singular: "role", fields: [
      { key: "title", label: "Job title" }, { key: "employer", label: "Employer" },
      { key: "city", label: "Location" }, { key: "startDate", label: "Start (YYYY-MM)" },
      { key: "endDate", label: "End (YYYY-MM, blank if current)" },
      { key: "description", label: "What you did", type: "textarea" },
    ] },
    st_education: { kind: "records", singular: "degree", fields: [
      { key: "degree", label: "Degree or certificate" }, { key: "school", label: "School" },
      { key: "fieldOfStudy", label: "Field of study" }, { key: "city", label: "Location" },
      { key: "startDate", label: "Start (year)" }, { key: "endDate", label: "Finished (year)" },
    ] },
    // Resume & Voice block
    employerDescriptions: { kind: "records", singular: "employer description", fields: [
      { key: "employer", label: "Employer" },
      { key: "description", label: "Exact wording to use", type: "textarea" },
    ] },
    signatureAchievements: { kind: "records", singular: "achievement", fields: [
      { key: "result", label: "What you did — one sentence, said plainly", type: "textarea" },
      { key: "metric", label: "The number that backs it up (optional but powerful)" },
      { key: "employer", label: "Where this happened" },
    ] },
    metricPhrasing: { kind: "records", singular: "phrasing rule", fields: [
      { key: "number", label: "The number (e.g. $36 million)" },
      { key: "phrasing", label: "How you want it said, every time", type: "textarea" },
    ] },
  };

  function objectArray(f, wrap) {
    const spec = OBJECT_ARRAY_SPEC[f.fieldKey];
    if (spec && spec.kind === "namelist") return nameListEditor(f, wrap, spec);
    if (spec && spec.kind === "records") return recordListEditor(f, wrap, spec);
    return nameListEditor(f, wrap, { singular: "item", placeholder: "Add an item" }); // sane default, still no JSON
  }

  function nameListEditor(f, wrap, spec) {
    const nameKey = spec.nameKey || "name";
    const box = el("div", "namelist");
    const chips = el("div", "chips");
    const arr = Array.isArray(f.value) ? f.value.map((x) => ({ ...x })) : [];
    const commit = () => { f.value = arr.map((x) => ({ ...x })); queueSave(f.fieldKey, f.value, wrap); };
    function renderChips() {
      chips.innerHTML = "";
      arr.forEach((item, idx) => {
        const chip = el("span", "tagitem");
        chip.appendChild(document.createTextNode(item[nameKey] || ""));
        if (spec.withLevel) {
          const sel = el("select", "levelsel");
          (spec.levels || SKILL_LEVELS).forEach((lv) => {
            const o = new Option(pretty(lv), lv); if ((item.level || "") === lv) o.selected = true; sel.appendChild(o);
          });
          sel.addEventListener("change", () => { item.level = sel.value; commit(); });
          chip.appendChild(sel);
        }
        const x = el("b", null, "×");
        x.addEventListener("click", () => { arr.splice(idx, 1); renderChips(); commit(); });
        chip.appendChild(x);
        chips.appendChild(chip);
      });
    }
    const row = el("div", "addrow");
    const input = el("input"); input.type = "text"; input.placeholder = spec.placeholder || ("Add a " + spec.singular);
    const add = () => {
      const v = input.value.trim(); if (!v) return;
      const item = { [nameKey]: v }; if (spec.withLevel) item.level = (spec.levels || SKILL_LEVELS)[0];
      arr.push(item); input.value = ""; renderChips(); commit(); input.focus();
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    const btn = el("button", "addbtn", "Add"); btn.type = "button"; btn.addEventListener("click", add);
    row.appendChild(input); row.appendChild(btn);
    box.appendChild(chips); box.appendChild(row);
    renderChips();
    return box;
  }

  function recordListEditor(f, wrap, spec) {
    const box = el("div", "records");
    const list = el("div");
    const arr = Array.isArray(f.value) ? f.value.map((x) => ({ ...x })) : [];
    const commit = () => { f.value = arr.map((x) => ({ ...x })); queueSave(f.fieldKey, f.value, wrap); };
    function render() {
      list.innerHTML = "";
      arr.forEach((rec, idx) => {
        const card = el("div", "reccard");
        const head = el("div", "rechead");
        head.appendChild(el("span", "recnum", (spec.singular ? pretty(spec.singular) : "Entry") + " " + (idx + 1)));
        const del = el("button", "linkbtn", "Remove"); del.type = "button";
        del.addEventListener("click", () => { arr.splice(idx, 1); render(); commit(); });
        head.appendChild(del); card.appendChild(head);
        spec.fields.forEach((fld) => {
          const w = el("div", "recfield");
          w.appendChild(el("label", null, fld.label));
          const inp = fld.type === "textarea" ? el("textarea", "autosize") : el("input");
          if (fld.type !== "textarea") inp.type = "text";
          else { inp.rows = 1; requestAnimationFrame(() => autoGrow(inp)); }
          inp.value = rec[fld.key] != null ? rec[fld.key] : "";
          inp.addEventListener("input", () => {
            if (fld.type === "textarea") autoGrow(inp);
            rec[fld.key] = inp.value || undefined; commit();
          });
          w.appendChild(inp); card.appendChild(w);
        });
        list.appendChild(card);
      });
    }
    const noun = spec.singular || "entry";
    const article = /^[aeiou]/i.test(noun) ? "an" : "a";
    const add = el("button", "addbtn"); add.type = "button";
    const setAddText = () => { add.textContent = arr.length ? `Add another ${noun}` : `Add ${article} ${noun}`; };
    add.addEventListener("click", () => { arr.push({}); render(); setAddText(); commit(); });
    box.appendChild(list); box.appendChild(add);
    render(); setAddText();
    return box;
  }

  // Acronyms that must stay uppercase in labels (country codes, regions, terms).
  const ACRONYMS = new Set(["US","EU","UK","USA","CAN","GBR","MEX","LATAM","GED","OPT","CPT",
    "KPI","OKR","OTE","PTO","W2","IC","VP","HR","IT"]);
  function pretty(v) {
    return String(v).split("_").map((w) => {
      if (ACRONYMS.has(w.toUpperCase())) return w.toUpperCase();
      if (/^\d+$/.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(" ");
  }

  // ---- render whole profile ---------------------------------------------
  function render(model) {
    MODEL = model;
    const nav = $("#blockNav"); nav.innerHTML = "";
    const main = $("#blocks"); main.innerHTML = "";

    // One CATEGORY at a time. The left rail lists every block as a small
    // heading with its categories under it; clicking a category shows just
    // those questions. Nobody scrolls a 70-question page.
    const panels = new Map();   // "block:cat" -> panel
    const navBtns = new Map();

    model.blocks.forEach((b) => {
      const head = el("div", "navblockhead", b.label);
      nav.appendChild(head);
      b.categories.forEach((cat) => {
        const key = b.key + ":" + cat.key;
        const nb = el("button");
        nb.appendChild(document.createTextNode(cat.label));
        const filled = cat.fields.filter((f) => f.filled).length;
        const frac = el("span", "frac", `${filled}/${cat.fields.length}`);
        frac.dataset.catMini = key; nb.appendChild(frac);
        nb.addEventListener("click", () => showCat(key));
        nav.appendChild(nb);
        navBtns.set(key, nb);

        const panel = el("section", "card block-body");
        panel.hidden = true;
        panel.appendChild(el("h2", null, cat.label));
        panel.appendChild(el("p", "desc", b.label + (b.description ? " — " + b.description : "")));
        const grid = el("div", "fieldgrid");
        cat.fields.forEach((f) => grid.appendChild(renderField(f)));
        panel.appendChild(grid);
        main.appendChild(panel);
        panels.set(key, panel);
      });
    });

    function showCat(key) {
      panels.forEach((p, k) => { p.hidden = k !== key; });
      navBtns.forEach((n, k) => n.classList.toggle("active", k === key));
      // textareas sized while hidden measure a scrollHeight of 0 and stay
      // collapsed — remeasure now that this panel is actually visible
      const panel = panels.get(key);
      if (panel) requestAnimationFrame(() =>
        panel.querySelectorAll("textarea.autosize").forEach((t) => autoGrow(t)));
      window.scrollTo(0, 0);
    }
    const first = panels.keys().next().value;
    if (first) showCat(first);
    applyCompletion({ score: model.completion.score, blocks: Object.fromEntries(model.blocks.map((b) => [b.key, b.completion])) });
  }

  // Action items surface in Applications (red dots + Action-required box),
  // not on the Profile page — profile is for answering questions, nothing else.
  async function loadProfile() {
    const r = await api("/profile");
    render(r.data);
  }

  // ======================= JOBS / MATCHES ==================================
  let MATCHES_LOADED = false;

  const AVA_TINTS = [["#ede9fe","#5b21b6"],["#dcfce7","#15803d"],["#fee2e2","#b91c1c"],
                     ["#e0f2fe","#0369a1"],["#fef3c7","#92610a"],["#fce7f3","#9d174d"]];
  function avaFor(name) {
    const s = name || "?";
    let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AVA_TINTS[h % AVA_TINTS.length];
  }
  function money(n) { return "$" + Math.round(n / 1000) + "k"; }
  function payLabel(j) {
    if (j.salaryMin && j.salaryMax) {
      // Boards often repeat one figure in both fields; don't render "$115k – $115k".
      return j.salaryMin === j.salaryMax
        ? `${money(j.salaryMax)}/year`
        : `${money(j.salaryMin)} – ${money(j.salaryMax)}/year`;
    }
    if (j.salaryMax) return `up to ${money(j.salaryMax)}/year`;
    if (j.salaryMin) return `${money(j.salaryMin)}+/year`;
    return null;
  }
  function scoreClass(n) { return n >= 70 ? "good" : n >= 38 ? "mid" : "low"; }
  function ago(iso) {
    if (!iso) return null;
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (isNaN(d)) return null;
    return d <= 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`;
  }
  // decode entities that older stored descriptions still carry
  const DECODE_TA = document.createElement("textarea");
  function decodeEnt(str) {
    // strip HTML the boards ship (older stored jobs still carry tags), keep
    // paragraph/list structure as line breaks, then decode entities
    const s = String(str || "")
      .replace(/<\s*(?:br|\/p|\/div|\/h[1-6]|\/ul|\/ol)\s*\/?\s*>/gi, "\n")
      .replace(/<\s*li[^>]*>/gi, "\n• ")
      .replace(/<[^>]+>/g, " ");
    DECODE_TA.innerHTML = s;
    return DECODE_TA.value.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }
  const svg = (paths) =>
    `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const ICON = {
    pin: svg('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>'),
    home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h14V10"/>'),
    card: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  };
  function chip(text, icon, cls) {
    const c = el("span", "chip" + (cls ? " " + cls : ""));
    if (icon) c.innerHTML = icon;
    c.appendChild(document.createTextNode(text));
    return c;
  }

  // Band copy — mirrors the reference product's explanations.
  const BANDS = {
    // Thresholds are calibrated to how the skills ranker actually scores: a
    // posting names a handful of tools, so 50% is genuinely "about half", not weak.
    skills: [[85,"You've got all the key skills this role is looking for"],
             [65,"You have most of the key skills this role needs"],
             [40,"You have about half the key skills for this role"],
             [0, "Most of the must-have skills for this role aren't a match"]],
    experience: [[90,"Your experience level and work history are a great fit for this role"],
                 [75,"Your experience is a good fit for what this role needs"],
                 [55,"Your background is relevant, even if it's not a perfect fit"],
                 [0, "Your experience is a bit far from what this role is looking for"]],
    compensation: [[95,"The pay here meets or beats what you're looking for"],
                   [80,"A little under your target, but still in a comfortable range"],
                   [60,"Pay comes in a bit below your target"],
                   [0, "This role likely won't meet your pay expectations"]],
    terms: [[90,"Work style, schedule and location all match what you're after"],
            [60,"Mostly a fit, with a small difference in the work setup"],
            [0, "The format, schedule or location doesn't line up with your preferences"]],
    company: [[80,"Nothing on file suggests a problem with this employer"],
              [0, "We don't have much on this employer yet"]],
  };
  const LABELS = { skills:"Skills", experience:"Experience", compensation:"Compensation", terms:"Terms", company:"Company" };
  function bandFor(key, n) { return (BANDS[key] || []).find(([min]) => n >= min)?.[1] || ""; }
  function headline(n) {
    return n >= 70 ? "Strong match" : n >= 55 ? "Good match" : n >= 38 ? "Worth a look" : "Long shot";
  }

  function matchCard(m) {
    const j = m.job;
    const card = el("article", "card job");

    const top = el("div", "job-top");
    const check = el("input", "jobcheck");
    check.type = "checkbox";
    check.checked = SELECTED.has(m.jobUuid);
    check.title = "Select for bulk apply";
    check.addEventListener("change", () => {
      if (check.checked) SELECTED.add(m.jobUuid); else SELECTED.delete(m.jobUuid);
      updateBulkBar();
    });
    top.appendChild(check);
    const [bg, fg] = avaFor(j.company);
    const ava = el("span", "job-ava", (j.company || "?").trim()[0].toUpperCase());
    ava.style.background = bg; ava.style.color = fg;
    top.appendChild(ava);

    const id = el("div", "job-id");
    const h = el("h3", null, j.title);
    h.style.cursor = "pointer"; h.title = "View full posting details";
    h.addEventListener("click", () => openJobDetail(m.jobUuid));
    id.appendChild(h);
    id.appendChild(el("div", "co", j.company || "Company not listed"));
    top.appendChild(id);

    const sc = el("div", "job-score " + "score-" + scoreClass(m.totalScore));
    sc.appendChild(el("b", null, m.totalScore + "%"));
    sc.appendChild(el("span", null, "match"));
    top.appendChild(sc);
    card.appendChild(top);

    const mid = el("div", "job-mid");
    const chips = el("div", "chips");
    // first seen in today's sweep -> flag it (already deduped at ingest, so a
    // reposting of an old job never re-badges)
    if (j.firstSeenAt && j.firstSeenAt.slice(0, 10) === new Date().toISOString().slice(0, 10))
      chips.appendChild(chip("New today", null, "green"));
    if (j.autoApply === true) chips.appendChild(chip("Auto-apply ready", null, "green"));
    else if (j.autoApply === false) chips.appendChild(chip("Apply on employer site", null, "plain"));
    if (j.location) chips.appendChild(chip(j.location, ICON.pin));
    if (j.remote) chips.appendChild(chip("Remote", ICON.home));
    const pay = payLabel(j);
    if (pay) chips.appendChild(chip(pay, ICON.card));
    else chips.appendChild(chip("Pay not listed", ICON.card, "plain"));
    if (m.compFlag === "negotiation") chips.appendChild(chip("Negotiation candidate", null, "amber"));
    const when = ago(j.postedAt);
    if (when) chips.appendChild(chip(when, ICON.clock, "plain"));
    chips.appendChild(chip(j.source, null, "plain"));
    mid.appendChild(chips);

    const actions = el("div", "job-actions");
    const why = el("button", "btn", "Why this score");
    const skip = el("button", "btn ghost", "Not interested");
    const view = el("button", "btn ghost", "View posting");
    view.title = "Read the full posting without leaving the page";
    view.addEventListener("click", () => openJobDetail(m.jobUuid));
    // Apply = add this job to the To-Apply queue (the worklist). The actual
    // applying is worked from the queue, one by one — the site is the tracker
    // and system of record, not the thing that fills employer forms.
    const apply = el("button", "btn primary", "Add to To-Apply");
    apply.addEventListener("click", async () => {
      apply.disabled = true; apply.textContent = "Adding…";
      try {
        await api("/apply-queue", { method: "POST", body: JSON.stringify({
          company: m.job.company, title: m.job.title,
          url: m.job.applyUrl || m.job.url, location: m.job.location,
          salaryMin: m.job.salaryMin, salaryMax: m.job.salaryMax,
          matchScore: m.matchScore, source: "jobs-for-you",
        }) });
        // pull it out of Jobs For You (survives future sweeps)
        await api("/matches", { method: "PATCH", body: JSON.stringify({ jobUuid: m.jobUuid, status: "queued" }) }).catch(() => {});
        toast("Added to your To-Apply list", 2500);
        card.remove();
        const cq = $("#cntApply"); // nudge the To-Apply badge if present
        if (cq && !cq.hidden) cq.textContent = String((parseInt(cq.textContent) || 0) + 1);
      } catch (e) {
        apply.disabled = false; apply.textContent = "Add to To-Apply";
        toast(e.message, 3000);
      }
    });
    actions.appendChild(why); actions.appendChild(skip); actions.appendChild(view); actions.appendChild(apply);
    mid.appendChild(actions);
    card.appendChild(mid);

    if (j.snippet) {
      const s = el("p", "job-snip", decodeEnt(j.snippet).replace(/\s+/g, " ").slice(0, 230) + "…");
      card.appendChild(s);
    }

    // score breakdown (collapsed)
    const panel = el("div", "job-why"); panel.hidden = true;
    const head = el("div", "why-head");
    const tile = el("div", "why-tile " + scoreClass(m.totalScore), m.totalScore + "%");
    const ht = el("div");
    ht.appendChild(el("div", "t", headline(m.totalScore)));
    ht.appendChild(el("div", "d", `Based on your profile, you have ${m.totalScore}% of what this role is asking for.`));
    head.appendChild(tile); head.appendChild(ht);
    panel.appendChild(head);
    ["skills","experience","compensation","terms","company"].forEach((k) => {
      const n = m.rankers[k];
      const r = el("div", "ranker");
      r.appendChild(el("div", "pct " + scoreClass(n), n + "%"));
      const t = el("div");
      t.appendChild(el("div", "nm", LABELS[k]));
      t.appendChild(el("div", "ds", bandFor(k, n)));
      r.appendChild(t);
      panel.appendChild(r);
    });
    if (m.missing && m.missing.length) {
      const b = el("div", "banner warn");
      b.style.marginTop = "10px"; b.style.marginBottom = "0";
      b.textContent = "Add these to your profile for a sharper score: " + m.missing.join(", ") + ".";
      panel.appendChild(b);
    }
    card.appendChild(panel);

    why.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      why.textContent = panel.hidden ? "Why this score" : "Hide breakdown";
    });
    skip.addEventListener("click", async () => {
      try {
        await api("/matches", { method: "PATCH", body: JSON.stringify({ jobUuid: m.jobUuid, status: "skipped" }) });
        card.remove(); toast("Hidden");
      } catch (e) { toast("Could not hide: " + e.message); }
    });
    return card;
  }

  let JOBS_SORT = "newest";
  $("#sortJobs").addEventListener("change", () => {
    JOBS_SORT = $("#sortJobs").value;
    renderMatches(LAST_MATCHES);
  });
  let LAST_MATCHES = [];
  function sortMatches(list) {
    const bySalary = (m) => Math.max(m.job.salaryMax || 0, m.job.salaryMin || 0);
    const byDate = (m) => m.job.postedAt ? Date.parse(m.job.postedAt) || 0 : 0;
    const arr = [...list];
    if (JOBS_SORT === "newest") arr.sort((a, b) => byDate(b) - byDate(a));
    else if (JOBS_SORT === "salary") arr.sort((a, b) => bySalary(b) - bySalary(a));
    else arr.sort((a, b) => b.totalScore - a.totalScore);
    return arr;
  }
  // Jobs For You shows ONLY jobs autopilot can file end-to-end (globalwork's
  // hasModernAutoApply). The toggle widens it to everything we scored.
  let FORYOU_AUTO_ONLY = true;

  function renderMatches(list) {
    LAST_MATCHES = list;
    const filtered = (JOBS_TAB === "auto" && FORYOU_AUTO_ONLY)
      ? list.filter((m) => m.job.autoApply === true) : list;
    const hiddenCount = list.length - filtered.length;
    list = sortMatches(filtered);
    const box = $("#matchList"); box.innerHTML = "";
    if (JOBS_TAB === "auto") {
      const bar = el("div", "muted");
      bar.style.cssText = "display:flex;align-items:center;gap:8px;font-size:12.5px;margin-bottom:10px";
      const cb = el("input"); cb.type = "checkbox"; cb.checked = FORYOU_AUTO_ONLY; cb.id = "autoOnly";
      cb.addEventListener("change", () => { FORYOU_AUTO_ONLY = cb.checked; renderMatches(LAST_MATCHES); });
      const lb = el("label", null, "One-click apply only — jobs we submit for you after your approval");
      lb.htmlFor = "autoOnly"; lb.style.cursor = "pointer";
      bar.appendChild(cb); bar.appendChild(lb);
      if (FORYOU_AUTO_ONLY && hiddenCount > 0)
        bar.appendChild(el("span", null, `(${hiddenCount} manual-apply match${hiddenCount === 1 ? "" : "es"} hidden)`));
      box.appendChild(bar);
    }
    if (!list.length) {
      const p = el("div", "card placeholder");
      p.innerHTML = (JOBS_TAB === "auto" && FORYOU_AUTO_ONLY)
        ? '<div class="ph-icon"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div>' +
          '<h3>No one-click jobs right now</h3><p>Every sweep discovers more employers whose systems we can file directly. ' +
          'Hit <strong>Refresh</strong> to sweep again, or untick the box above to see matches that need a manual submit.</p>'
        : '<div class="ph-icon"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div>' +
          '<h3>No jobs yet</h3><p>Set what you\'re looking for above and hit <strong>Find jobs</strong>. ' +
          'We search several boards at once — local, hybrid and remote together.</p>';
      box.appendChild(p);
      return;
    }
    list.forEach((m) => box.appendChild(matchCard(m)));
    const c = $("#cntMatches");
    if (c) { c.textContent = list.length; c.hidden = false; }
  }

  async function loadSearchPrefs() {
    try {
      const r = await api("/search");
      const d = r.data;
      $("#sKeywords").value = d.keywords || "";
      if (d.keywordsFallback) $("#sKeywords").placeholder = d.keywordsFallback;
      $("#sLocation").value = d.location || "";
      if (d.locationFallback) $("#sLocation").placeholder = d.locationFallback;
      $("#sRemote").checked = !!d.remoteOnly;
      if (d.salaryMin != null) $("#sSalary").value = d.salaryMin;
      if (d.radiusMi != null) $("#sRadius").value = String(d.radiusMi);
    } catch { /* first run: leave defaults */ }
  }
  function currentPrefs() {
    return {
      keywords: $("#sKeywords").value.trim() || $("#sKeywords").placeholder.replace(/^e\.g\. /, ""),
      location: $("#sLocation").value.trim(),
      remoteOnly: $("#sRemote").checked,
      salaryMin: $("#sSalary").value === "" ? null : Number($("#sSalary").value),
      radiusMi: $("#sRadius").value === "" ? null : Number($("#sRadius").value),
    };
  }

  let SWEEP_RUNNING = false;
  let JOBS_TAB = "auto";            // auto = Jobs For You, search = Search jobs
  const SELECTED = new Set();       // jobUuids checked for bulk apply

  function setJobsTab(tab) {
    JOBS_TAB = tab;
    $("#tabForYou").classList.toggle("active", tab === "auto");
    $("#tabSearch").classList.toggle("active", tab === "search");
    $("#jobsHeadAuto").hidden = tab !== "auto";
    $("#jobsHeadSearch").hidden = tab !== "search";
    $("#searchbarCard").hidden = tab !== "search";
    $("#matchMsg").innerHTML = "";
    loadMatches();
  }
  $("#tabForYou").addEventListener("click", () => setJobsTab("auto"));
  $("#tabSearch").addEventListener("click", () => setJobsTab("search"));

  // re-run the daily sweep on demand
  const resweep = $("#btnResweep");
  if (resweep) resweep.addEventListener("click", async () => {
    resweep.disabled = true; resweep.textContent = "Sweeping…";
    SWEEP_RUNNING = true; refreshStrip();
    try {
      const r = await api("/jobs/refresh", { method: "POST", body: JSON.stringify({ origin: "auto" }) });
      toast(`Swept the boards: ${r.data.matched} matches from ${r.data.fetched} postings.`, 3200);
      await loadMatches();
    } catch (e) { toast(e.message, 3600); }
    finally { SWEEP_RUNNING = false; resweep.disabled = false; resweep.textContent = "Refresh"; refreshStrip(); }
  });

  function updateBulkBar() {
    const bar = $("#bulkbar");
    bar.hidden = SELECTED.size === 0;
    $("#bulkCount").textContent = `${SELECTED.size} selected`;
    $("#bulkStart").textContent = `Start ${SELECTED.size} application${SELECTED.size === 1 ? "" : "s"}`;
  }
  $("#bulkClear").addEventListener("click", () => {
    SELECTED.clear();
    document.querySelectorAll(".jobcheck").forEach((c) => (c.checked = false));
    updateBulkBar();
  });
  $("#bulkStart").addEventListener("click", async () => {
    const btn = $("#bulkStart");
    btn.disabled = true; btn.textContent = "Queuing…";
    try {
      const r = await api("/applications/bulk", { method: "POST", body: JSON.stringify({ jobUuids: [...SELECTED] }) });
      SELECTED.clear(); updateBulkBar();
      toast(`${r.data.queued} queued. Preparing one at a time in the background.`, 3200);
      switchView("applications");
    } catch (e) { toast(e.message, 3600); }
    finally { btn.disabled = false; updateBulkBar(); }
  });
  // bulk skip: clear the selection out of the feed in one click
  const bulkSkipBtn = $("#bulkSkip");
  if (bulkSkipBtn) bulkSkipBtn.addEventListener("click", async () => {
    bulkSkipBtn.disabled = true;
    const picked = [...SELECTED];
    try {
      for (const jobUuid of picked) {
        await api("/matches", { method: "PATCH", body: JSON.stringify({ jobUuid, status: "skipped" }) });
      }
      SELECTED.clear(); updateBulkBar();
      toast(`${picked.length} hidden`);
      loadMatches();
    } catch (e) { toast(e.message, 3200); }
    finally { bulkSkipBtn.disabled = false; }
  });

  async function loadMatches() {
    MATCHES_LOADED = true;
    await loadSearchPrefs();
    try {
      const r = await api("/matches?origin=" + (JOBS_TAB === "auto" ? "auto" : "search"));
      const list = r.data.matches || [];
      if (!list.length && SWEEP_RUNNING) {
        // The daily sweep kicked off at login; matches are on their way.
        const box = $("#matchList"); box.innerHTML = "";
        const p = el("div", "card placeholder");
        p.innerHTML = '<div class="ph-icon"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div>' +
          "<h3>Finding today's matches…</h3><p>We're sweeping the boards for you right now. This takes about half a minute.</p>";
        box.appendChild(p);
        pollSweep(0);
        return;
      }
      renderMatches(list);
    } catch (e) {
      if (e.message !== "unauthorized") renderMatches([]);
    }
  }
  function pollSweep(tries) {
    if (tries > 15) { SWEEP_RUNNING = false; renderMatches([]); return; }
    setTimeout(async () => {
      try {
        const r = await api("/matches");
        const list = r.data.matches || [];
        if (list.length) { SWEEP_RUNNING = false; renderMatches(list); toast(`${list.length} matches waiting for you`, 3000); }
        else pollSweep(tries + 1);
      } catch { SWEEP_RUNNING = false; }
    }, 4000);
  }

  $("#btnRefresh").addEventListener("click", async () => {
    const btn = $("#btnRefresh");
    const msg = $("#matchMsg");
    btn.disabled = true; btn.textContent = "Searching…";
    SEARCHING = true; refreshStrip();
    msg.innerHTML = "";
    try {
      JOBS_TAB = "search";
      await api("/search", { method: "PATCH", body: JSON.stringify(currentPrefs()) });
      const r = await api("/jobs/refresh", { method: "POST" });
      const d = r.data;
      const live = Object.entries(d.sources || {}).filter(([, n]) => n > 0).map(([s, n]) => `${s} ${n}`).join(" · ");
      msg.innerHTML = "";
      const b = el("div", "banner info");
      b.textContent = `Found ${d.fetched} postings, ${d.deduped} unique, ${d.matched} scored${live ? " — " + live : ""}.`;
      msg.appendChild(b);
      const m = await api("/matches?origin=search");
      renderMatches(m.data.matches || []);
    } catch (e) {
      const b = el("div", "banner bad");
      b.textContent = e.message || "Search failed.";
      msg.appendChild(b);
    } finally {
      btn.disabled = false; btn.textContent = "Find jobs";
      SEARCHING = false; refreshStrip();
    }
  });

  // ======================= JOB DETAIL (in-page) =============================
  async function openJobDetail(jobUuid, backTo) {
    // The jobs view hosts the detail panel; make sure it's visible without
    // letting the first-visit auto-load race us for the same container.
    if (CURRENT_VIEW !== "matches") { MATCHES_LOADED = true; switchView("matches"); }
    const box = $("#matchList");
    box.innerHTML = ""; box.appendChild(el("div", "muted", "Loading posting…"));
    let d;
    try { d = (await api(`/jobs/${jobUuid}`)).data; }
    catch (e) { box.innerHTML = ""; box.appendChild(el("div", "banner bad", e.message)); return; }
    box.innerHTML = "";
    const back = el("button", "btn ghost",
      backTo === "applications" ? "\u2190 Back to applications" : "\u2190 Back to jobs");
    back.addEventListener("click", () => {
      if (backTo === "applications") switchView("applications");
      else loadMatches();
    });
    box.appendChild(back);

    const j = d.job;
    const card = el("article", "card job");
    const top = el("div", "job-top");
    const [bg, fg] = avaFor(j.company);
    const ava = el("span", "job-ava", (j.company || "?").trim()[0].toUpperCase());
    ava.style.background = bg; ava.style.color = fg;
    top.appendChild(ava);
    const id = el("div", "job-id");
    id.appendChild(el("h3", null, j.title));
    id.appendChild(el("div", "co", j.company || "Company not listed"));
    top.appendChild(id);
    if (d.match) {
      const sc = el("div", "job-score score-" + scoreClass(d.match.totalScore));
      sc.appendChild(el("b", null, d.match.totalScore + "%")); sc.appendChild(el("span", null, "match"));
      top.appendChild(sc);
    }
    card.appendChild(top);

    const chips = el("div", "chips"); chips.style.marginTop = "11px";
    if (j.location) chips.appendChild(chip(j.location, ICON.pin));
    if (j.remote) chips.appendChild(chip("Remote", ICON.home));
    const pay = payLabel(j); if (pay) chips.appendChild(chip(pay, ICON.card));
    if (j.category) chips.appendChild(chip(j.category, null, "plain"));
    const when = ago(j.postedAt); if (when) chips.appendChild(chip(when, ICON.clock, "plain"));
    chips.appendChild(chip("via " + j.source, null, "plain"));
    card.appendChild(chips);

    const actions = el("div", "job-actions"); actions.style.marginTop = "12px";
    const view = el("a", "btn ghost", "Original posting \u2197");
    view.href = j.url; view.target = "_blank"; view.rel = "noopener noreferrer";
    actions.appendChild(view);
    if (d.application) {
      const go = el("button", "btn primary", "View application");
      go.addEventListener("click", () => { switchView("applications"); openApplication(d.application.uuid); });
      actions.appendChild(go);
    } else {
      const skip = el("button", "btn ghost", "Not interested");
      skip.addEventListener("click", async () => {
        try { await api("/matches", { method: "PATCH", body: JSON.stringify({ jobUuid, status: "skipped" }) });
              toast("Hidden"); loadMatches(); } catch (e) { toast(e.message); }
      });
      const apply = el("button", "btn primary", "Add to To-Apply");
      apply.addEventListener("click", async () => {
        apply.disabled = true; apply.textContent = "Adding\u2026";
        try {
          await api("/apply-queue", { method: "POST", body: JSON.stringify({
            company: j.company, title: j.title,
            url: j.applyUrl || j.url, location: j.location,
            salaryMin: j.salaryMin, salaryMax: j.salaryMax, matchScore: d.matchScore,
            source: "jobs-for-you",
          }) });
          await api("/matches", { method: "PATCH", body: JSON.stringify({ jobUuid, status: "queued" }) }).catch(() => {});
          apply.textContent = "Queued \u2713";
          toast("Added to your To-Apply list \u2014 removed from Jobs For You", 2800);
          if (MATCHES_LOADED) loadMatches();
        } catch (e) { apply.disabled = false; apply.textContent = "Add to To-Apply"; toast(e.message, 3200); }
      });
      actions.appendChild(skip); actions.appendChild(apply);
    }
    card.appendChild(actions);
    box.appendChild(card);

    // score breakdown, open by default
    if (d.match) {
      const why = el("div", "card block-body");
      const head = el("div", "why-head");
      const tile = el("div", "why-tile " + scoreClass(d.match.totalScore), d.match.totalScore + "%");
      const ht = el("div");
      ht.appendChild(el("div", "t", headline(d.match.totalScore)));
      ht.appendChild(el("div", "d", "How this role scored against your profile."));
      head.appendChild(tile); head.appendChild(ht);
      why.appendChild(head);
      ["skills","experience","compensation","terms","company"].forEach((k) => {
        const n = d.match.rankers[k];
        const r = el("div", "ranker");
        r.appendChild(el("div", "pct " + scoreClass(n), n + "%"));
        const t = el("div");
        t.appendChild(el("div", "nm", LABELS[k]));
        t.appendChild(el("div", "ds", bandFor(k, n)));
        r.appendChild(t);
        why.appendChild(r);
      });
      box.appendChild(why);
    }

    // the posting itself
    const body = el("div", "card block-body");
    body.appendChild(el("h3", null, "About this role"));
    const txt = decodeEnt(j.description || "").trim();
    if (txt) {
      txt.split(/\n{2,}|(?<=\.)\s{2,}/).slice(0, 40).forEach((para) => {
        if (para.trim()) body.appendChild(el("p", null, para.trim()));
      });
      if (txt.length >= 1900) {
        const more = el("p", "muted", "This is the excerpt the job board provides. The full posting is on the original page.");
        body.appendChild(more);
      }
    } else {
      body.appendChild(el("p", "muted", "The board didn't provide a description for this one. The original posting has the full text."));
    }
    box.appendChild(body);
    window.scrollTo(0, 0);
  }

  // ======================= STATUS STRIP ====================================
  let STRIP_TIMER = null;
  let SEARCHING = false;   // a manual "Find jobs" run is in flight
  async function refreshStrip() {
    try {
      const d = (await api("/status")).data;
      if (d.sweep && SWEEP_RUNNING) SWEEP_RUNNING = false;   // morning sweep finished
      const strip = $("#statusStrip");
      strip.innerHTML = ""; strip.hidden = false;
      const busy = d.queue.queued + d.queue.preparing > 0;
      const live = el("span", "live");
      live.appendChild(document.createTextNode(
        SEARCHING ? "Searching the boards right now…"
        : SWEEP_RUNNING ? "Sweeping the boards for today's matches…"
        : busy ? `Autopilot working: ${d.queue.preparing || 1} preparing, ${d.queue.queued} in queue`
        : d.sweep ? `Today's sweep found ${d.sweep.found} matches` : "Autopilot idle"));
      strip.appendChild(live);
      if (d.actionRequired > 0) {
        const w = el("span", "warn", `${d.actionRequired} need${d.actionRequired === 1 ? "s" : ""} your attention`);
        strip.appendChild(w);
      }
      if (d.unreadMail > 0) strip.appendChild(el("span", null, `${d.unreadMail} unread in inbox`));
      const b = el("span");
      b.innerHTML = `AI budget today: <b>$${d.budget.spentUsd.toFixed(2)}</b> of $${d.budget.capUsd.toFixed(2)}`;
      strip.appendChild(b);
      const dot = $("#cntApps"); if (dot) dot.classList.toggle("reddot", d.actionRequired > 0);
      clearTimeout(STRIP_TIMER);
      STRIP_TIMER = setTimeout(refreshStrip, (busy || SWEEP_RUNNING || SEARCHING) ? 4000 : 30000);
    } catch { /* signed out or transient */ }
  }

  // ======================= TO APPLY (queue) ================================
  async function loadApplyQueue() {
    const box = $("#applyList"); if (!box) return;
    box.innerHTML = ""; box.appendChild(el("div", "muted", "Loading…"));
    let d;
    try { d = (await api("/apply-queue?status=pending")).data; }
    catch (e) { box.innerHTML = ""; box.appendChild(el("div", "banner bad", e.message)); return; }
    box.innerHTML = "";
    const cnt = $("#cntApply"); if (cnt) { const n = (d.counts && d.counts.pending) || 0; cnt.textContent = n; cnt.hidden = n === 0; }
    if (!d.queue.length) {
      const p = el("div", "card placeholder");
      p.innerHTML = '<div class="ph-icon"><svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>' +
        "<h3>Nothing queued</h3><p>Jobs you decide to apply to land here — the daily search fills it automatically. Then work them one by one and each moves into Applications.</p>";
      box.appendChild(p); return;
    }
    d.queue.forEach((q) => {
      const card = el("article", "card job appcard");
      const top = el("div", "job-top");
      const [bg, fg] = avaFor(q.company);
      const ava = el("span", "job-ava", (q.company || "?").trim()[0].toUpperCase());
      ava.style.background = bg; ava.style.color = fg; top.appendChild(ava);
      const id = el("div", "job-id");
      id.appendChild(el("h3", null, q.title));
      id.appendChild(el("div", "co", q.company || ""));
      if (q.location) { const l = el("div", "appdate", q.location); l.style.cssText = "font-size:12px;color:var(--muted);margin-top:3px"; id.appendChild(l); }
      top.appendChild(id);
      if (q.match_score != null) {
        const sc = el("div", "job-score score-" + scoreClass(q.match_score));
        sc.appendChild(el("b", null, q.match_score + "%")); sc.appendChild(el("span", null, "match"));
        top.appendChild(sc);
      }
      card.appendChild(top);
      if (q.notes) card.appendChild(el("p", "job-snip", q.notes));
      // meta line: salary + where it came from + when it was queued
      const metaBits = [];
      if (q.salary_min || q.salary_max) {
        const k = (n) => "$" + Math.round(n / 1000) + "k";
        metaBits.push(q.salary_min && q.salary_max ? k(q.salary_min) + "–" + k(q.salary_max) : k(q.salary_max || q.salary_min));
      }
      if (q.source) metaBits.push(q.source.replace(/-/g, " "));
      if (q.created_at) metaBits.push("added " + fmtDate(q.created_at));
      if (q.priority) metaBits.push("priority " + q.priority);
      if (metaBits.length) { const mrow = el("div", null, metaBits.join(" · ")); mrow.style.cssText = "font-size:12px;color:var(--muted);margin:2px 0 10px"; card.appendChild(mrow); }
      // document links, when Cowork has already tailored + saved them to Drive
      if (q.resume_url || q.cover_url) {
        const docs = el("div", null);
        docs.style.cssText = "display:flex;gap:12px;font-size:12px;margin:0 0 10px";
        if (q.resume_url) { const a = el("a", "doclink", "📄 Résumé"); a.href = q.resume_url; a.target = "_blank"; a.rel = "noopener"; docs.appendChild(a); }
        if (q.cover_url) { const a = el("a", "doclink", "✉️ Cover letter"); a.href = q.cover_url; a.target = "_blank"; a.rel = "noopener"; docs.appendChild(a); }
        card.appendChild(docs);
      }
      const actions = el("div", "job-actions");
      if (q.url) { const open = el("a", "btn ghost", "Open posting"); open.href = q.url; open.target = "_blank"; open.rel = "noopener"; actions.appendChild(open); }
      else { const nolink = el("span", "muted", "no link — search it"); nolink.style.cssText = "font-size:12px;align-self:center;margin-right:6px"; actions.appendChild(nolink); }
      const done = el("button", "btn primary", "Mark applied");
      done.addEventListener("click", async () => {
        done.disabled = true;
        try { await api("/apply-queue", { method: "PATCH", body: JSON.stringify({ id: q.id, action: "applied" }) }); toast("Moved to Applications"); loadApplyQueue(); loadApplications(true); }
        catch (e) { toast(e.message, 3000); done.disabled = false; }
      });
      const skip = el("button", "btn ghost", "Skip");
      skip.addEventListener("click", async () => {
        try { await api("/apply-queue", { method: "PATCH", body: JSON.stringify({ id: q.id, action: "skipped" }) }); toast("Skipped"); loadApplyQueue(); }
        catch (e) { toast(e.message, 3000); }
      });
      actions.appendChild(done); actions.appendChild(skip);
      card.appendChild(actions);
      box.appendChild(card);
    });
  }
  $("#btnApplyRefresh")?.addEventListener("click", () => loadApplyQueue());

  // ======================= APPLICATIONS ====================================
  const STATUS_LABEL = {
    queued: "Queued", preparing: "Preparing", actionRequired: "Action required",
    readyToApply: "Ready to apply", approved: "Approved", applying: "Submitting…",
    applied: "Applied", interview: "Interview", offer: "Offer", rejected: "Rejected",
    withdrawn: "Withdrawn", failed: "Failed", expired: "Expired",
  };
  const STATUS_CLASS = {
    queued: "plain", preparing: "plain", actionRequired: "amber", readyToApply: "green",
    approved: "green", applying: "green", applied: "green", interview: "green", offer: "green",
    rejected: "plain", withdrawn: "plain", failed: "amber", expired: "plain",
  };
  let QUEUE_TIMER = null;

  let APPS_CACHE = [];
  let APP_FILTER = null;   // null = all; otherwise a list of statuses
  let APP_SORT = "recent"; // recent | oldest | company | match
  let APP_SEARCH = "";     // free-text filter over company + title
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ACT_ICON = { queued: "🗂️", tailored: "📄", gate: "🛡️", applied: "✅", status: "↕️",
    note: "📝", email: "✉️", error: "⚠️", apply: "🚀" };
  function fmtDateTime(iso) {
    if (!iso) return "";
    const d = new Date(String(iso)); if (isNaN(d.getTime())) return "";
    let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, "0");
    const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12;
    return MON[d.getMonth()] + " " + d.getDate() + ", " + h + ":" + m + ap;
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const s = String(iso);
    const d = new Date(s); if (isNaN(d.getTime())) return "";
    // A date-only / midnight-UTC stamp carries no real time-of-day; render its
    // UTC calendar day so a negative local offset can't roll it back a day.
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s) || /t00:00:00(\.000)?z$/i.test(s);
    const mo = dateOnly ? d.getUTCMonth() : d.getMonth();
    const day = dateOnly ? d.getUTCDate() : d.getDate();
    const yr = dateOnly ? d.getUTCFullYear() : d.getFullYear();
    return MON[mo] + " " + day + (yr !== new Date().getFullYear() ? ", " + yr : "");
  }
  async function loadApplications(force) {
    const box = $("#appList");
    try {
      const r = await api("/applications");
      APPS_CACHE = r.data.applications || [];
      const c = $("#cntApps");
      if (c) { c.textContent = APPS_CACHE.length; c.hidden = APPS_CACHE.length === 0; }
      renderApplications(APPS_CACHE, r.data.counts || {});
    } catch (e) {
      if (e.message !== "unauthorized") { box.innerHTML = ""; box.appendChild(el("div", "banner bad", e.message)); }
    }
  }

  function renderApplications(apps, counts) {
    const box = $("#appList"); box.innerHTML = "";
    // toolbar: log an off-site application + sort control (always visible)
    const bar = el("div", "app-toolbar");
    bar.style.cssText = "display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px";
    const logBtn = el("button", "btn primary", "+ Log an application");
    logBtn.title = "Record an application you submitted yourself, off-platform";
    logBtn.addEventListener("click", () => openManualApply());
    bar.appendChild(logBtn);
    // search box — filter applications by company or title
    const search = el("input", "appsearch");
    search.id = "appSearchInput"; search.type = "search"; search.placeholder = "Search company or title…";
    search.value = APP_SEARCH;
    search.style.cssText = "flex:1;min-width:160px;max-width:340px;padding:8px 12px;border:1px solid var(--border,#d7dbe3);border-radius:8px;font:inherit";
    search.addEventListener("input", () => {
      APP_SEARCH = search.value;
      renderApplications(APPS_CACHE, counts);
      const ni = document.getElementById("appSearchInput");
      if (ni) { ni.focus(); const n = ni.value.length; try { ni.setSelectionRange(n, n); } catch {} }
    });
    bar.appendChild(search);
    const sortWrap = el("label", "sortwrap");
    sortWrap.style.cssText = "display:flex;gap:6px;align-items:center;font-size:13px;color:var(--muted)";
    sortWrap.appendChild(el("span", null, "Sort"));
    const sortSel = el("select", "movesel");
    [["recent", "Newest first"], ["oldest", "Oldest first"], ["company", "Company A–Z"], ["match", "Match %"]]
      .forEach(([v, l]) => { const o = new Option(l, v); if (v === APP_SORT) o.selected = true; sortSel.appendChild(o); });
    sortSel.addEventListener("change", () => { APP_SORT = sortSel.value; renderApplications(APPS_CACHE, counts); });
    sortWrap.appendChild(sortSel);
    bar.appendChild(sortWrap);
    box.appendChild(bar);
    const stats = $("#appStats");
    if (stats) {
      // The real funnel, in order. Interviews and offers are advanced by the
      // inbox classifier, not by hand.
      stats.innerHTML = ""; stats.hidden = false;
      // Each box is a filter: click to see just that stage, click again for all.
      const GROUPS = {
        actionRequired: ["actionRequired"],
        readyToApply: ["readyToApply", "approved", "queued", "preparing"],
        applying: ["applying"],
        applied: ["applied", "interview", "offer"],
        rejected: ["rejected", "withdrawn", "failed"],
        expired: ["expired"],
      };
      const applied = (counts.applied || 0) + (counts.interview || 0) + (counts.offer || 0);
      [["actionRequired", counts.actionRequired || 0, "Action required", "amber"],
       ["readyToApply", (counts.readyToApply || 0) + (counts.approved || 0) + (counts.queued || 0) + (counts.preparing || 0), "Ready to apply", ""],
       ["applying", counts.applying || 0, "Applying", ""],
       ["applied", applied, "Applied", ""],
       ["rejected", (counts.rejected || 0) + (counts.withdrawn || 0) + (counts.failed || 0), "Rejected", "plain"],
       ["expired", counts.expired || 0, "Expired", "plain"]].forEach(([k, n, lbl, cls]) => {
        const s = el("button", "stat" + (cls ? " " + cls : ""));
        s.style.cursor = "pointer"; s.style.border = "0"; s.style.textAlign = "left"; s.style.font = "inherit";
        if (k === "actionRequired" && n > 0) s.classList.add("alert");
        const active = APP_FILTER && APP_FILTER.join() === GROUPS[k].join();
        if (active) s.style.outline = "3px solid var(--accent)";
        s.appendChild(el("div", "label", lbl));
        s.appendChild(el("div", "num", String(n)));
        s.addEventListener("click", () => {
          APP_FILTER = active ? null : GROUPS[k];
          renderApplications(APPS_CACHE, counts);
        });
        stats.appendChild(s);
      });
    }
    // "in line" explainer while applications are being submitted
    const applyingActive = APP_FILTER && APP_FILTER.join() === "applying";
    if ((applyingActive || (counts.applying || 0) > 0) && !APP_FILTER || applyingActive) {
      if ((counts.applying || 0) > 0) {
        const b = el("div", "banner ok");
        b.textContent = "Your applications are in line — we submit them at the right time and let you know. We don't send them all at once; spacing them out (usually within a day) improves your chances.";
        box.appendChild(b);
      }
    }
    if (APP_FILTER && APP_FILTER.join() === "expired") {
      box.appendChild(el("div", "banner bad", "These jobs are no longer accepting applications."));
    }
    // red dot on the sidebar when anything needs the user
    const cnt = $("#cntApps");
    if (cnt) cnt.classList.toggle("reddot", (counts.actionRequired || 0) > 0);
    // keep the queue draining while any items wait; poll as chain backstop
    clearTimeout(QUEUE_TIMER);
    if ((counts.queued || 0) + (counts.preparing || 0) > 0) {
      QUEUE_TIMER = setTimeout(async () => {
        try {
          const r = await api("/applications/process-next", { method: "POST" });
          if (r.data.paused) { $("#appList").prepend(el("div", "banner warn", r.data.paused)); return; }
        } catch { /* ignore */ }
        if (CURRENT_VIEW === "applications") loadApplications(true);
      }, 5000);
    }
    let shown = APP_FILTER ? apps.filter((a) => APP_FILTER.includes(a.status)) : apps;
    const sq = APP_SEARCH.trim().toLowerCase();
    if (sq) shown = shown.filter((a) =>
      (a.job.company || "").toLowerCase().includes(sq) || (a.job.title || "").toLowerCase().includes(sq));
    if (!shown.length) {
      const p = el("div", "card placeholder");
      p.innerHTML =
        '<div class="ph-icon"><svg viewBox="0 0 24 24"><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg></div>' +
        (APP_FILTER ? "<h3>Nothing in this stage</h3><p>Click the highlighted box again to see everything.</p>"
                    : "<h3>No applications yet</h3><p>Hit <strong>Apply</strong> on a job. We tailor the resume and cover letter, run the hiring-manager check, and prefill the employer's real application for your approval.</p>");
      box.appendChild(p);
      return;
    }
    // Order: things that need you / are ready first, then a "Preparing"
    // divider, then the ones still being worked. A live status line on every
    // card shows resume / cover letter / apply-form progress.
    const PREP = new Set(["queued", "preparing", "applying"]);
    const dt = (x) => new Date(x.submittedAt || x.createdAt || 0).getTime();
    const SORTERS = {
      recent: (a, b) => dt(b) - dt(a),
      oldest: (a, b) => dt(a) - dt(b),
      company: (a, b) => (a.job.company || "").localeCompare(b.job.company || ""),
      match: (a, b) => (b.matchScore || 0) - (a.matchScore || 0),
    };
    let ordered = [...shown].sort(SORTERS[APP_SORT] || SORTERS.recent);
    // default (newest) view keeps still-working items grouped at the bottom
    if (!APP_FILTER && APP_SORT === "recent")
      ordered = ordered.sort((a, b) => (PREP.has(a.status) ? 1 : 0) - (PREP.has(b.status) ? 1 : 0));
    let dividerDrawn = false;
    ordered.forEach((a) => {
      if (!APP_FILTER && APP_SORT === "recent" && !dividerDrawn && PREP.has(a.status)) {
        dividerDrawn = true;
        const div = el("div", "prep-divider"); div.appendChild(el("span", null, "Preparing"));
        box.appendChild(div);
      }
      const card = el("article", "card job appcard");
      const top = el("div", "job-top");
      const [bg, fg] = avaFor(a.job.company);
      const ava = el("span", "job-ava", (a.job.company || "?").trim()[0].toUpperCase());
      ava.style.background = bg; ava.style.color = fg;
      top.appendChild(ava);
      const id = el("div", "job-id");
      id.appendChild(el("h3", null, a.job.title));
      id.appendChild(el("div", "co", a.job.company || "Company not listed"));
      const dstr = (a.submittedAt ? "Applied " : "Added ") + fmtDate(a.submittedAt || a.createdAt);
      if (dstr.trim() !== "Added") {
        const dEl = el("div", "appdate", dstr);
        dEl.style.cssText = "font-size:12px;color:var(--muted);margin-top:3px";
        id.appendChild(dEl);
      }
      top.appendChild(id);
      if (a.matchScore != null) {
        const sc = el("div", "job-score score-" + scoreClass(a.matchScore));
        sc.appendChild(el("b", null, a.matchScore + "%")); sc.appendChild(el("span", null, "match"));
        top.appendChild(sc);
      }
      card.appendChild(top);

      const mid = el("div", "job-mid");
      const chips = el("div", "chips");
      chips.appendChild(chip(STATUS_LABEL[a.status] || a.status, null, STATUS_CLASS[a.status] || "plain"));
      if (a.ats) chips.appendChild(chip(a.ats, null, "plain"));
      if (a.needManualApply) chips.appendChild(chip("Needs manual apply", null, "amber"));
      if (a.gateVerdict) chips.appendChild(chip("Gate: " + a.gateVerdict, null, a.gateVerdict === "PASS" ? "green" : "amber"));
      if (a.fields.needsHuman > 0) chips.appendChild(chip(`${a.fields.needsHuman} question${a.fields.needsHuman === 1 ? "" : "s"} for you`, null, "amber"));
      mid.appendChild(chips);
      const actions = el("div", "job-actions");
      if (a.jobUuid) {
        const vp = el("button", "btn ghost", "View posting");
        vp.title = "Read the full posting without leaving the app";
        vp.addEventListener("click", (ev) => { ev.stopPropagation(); openJobDetail(a.jobUuid, "applications"); });
        actions.appendChild(vp);
      }
      if (a.cvUuid) {
        const d1 = el("a", "btn", "Resume");
        d1.href = `/api/v1/documents/${a.cvUuid}/pdf`; d1.target = "_blank"; d1.rel = "noopener";
        d1.title = "Download the tailored resume PDF";
        actions.appendChild(d1);
      }
      if (a.coverLetterUuid) {
        const d2 = el("a", "btn", "Letter");
        d2.href = `/api/v1/documents/${a.coverLetterUuid}/pdf`; d2.target = "_blank"; d2.rel = "noopener";
        d2.title = "Download the cover letter PDF";
        actions.appendChild(d2);
      }
      // manual pipeline movement: phone calls and emails the inbox never saw
      if (["applied", "interview", "offer", "rejected", "withdrawn", "approved", "readyToApply"].includes(a.status)) {
        const mv = el("select", "movesel");
        mv.appendChild(new Option("Move to…", ""));
        [["applied", "Applied"], ["interview", "Interview"], ["offer", "Offer"], ["rejected", "Rejected"], ["withdrawn", "Withdrawn"]]
          .forEach(([v, l]) => { if (v !== a.status) mv.appendChild(new Option(l, v)); });
        mv.addEventListener("click", (ev) => ev.stopPropagation());
        mv.addEventListener("change", async () => {
          if (!mv.value) return;
          try {
            await api(`/applications/${a.uuid}`, { method: "PATCH", body: JSON.stringify({ action: "setStatus", status: mv.value }) });
            toast("Moved to " + mv.options[mv.selectedIndex].text);
            loadApplications(true); refreshStrip();
          } catch (e) { toast(e.message, 3000); }
        });
        actions.appendChild(mv);
      }
      // pre-submit apps can be sent back to the Jobs list (un-apply)
      if (["readyToApply", "approved", "actionRequired", "queued", "preparing"].includes(a.status)) {
        const back = el("button", "btn ghost", "← Back to Jobs");
        back.title = "Move this out of the funnel and back into your Jobs list";
        back.addEventListener("click", async (ev) => {
          ev.stopPropagation();
          try {
            await api(`/applications/${a.uuid}`, { method: "PATCH", body: JSON.stringify({ action: "moveBack" }) });
            toast("Moved back to Jobs"); loadApplications(true);
            if (typeof refreshStrip === "function") refreshStrip();
          } catch (e) { toast(e.message, 3000); }
        });
        actions.appendChild(back);
      }
      const discard = el("button", "btn ghost", "Discard");
      discard.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        try {
          await api(`/applications/${a.uuid}`, { method: "PATCH", body: JSON.stringify({ action: "discard" }) });
          toast("Discarded"); loadApplications(true); refreshStrip();
        } catch (e) { toast(e.message, 3000); }
      });
      actions.appendChild(discard);
      const openBtn = el("button", "btn primary", a.status === "actionRequired" ? "Finish it" : "Review");
      openBtn.addEventListener("click", () => openApplication(a.uuid));
      actions.appendChild(openBtn);
      mid.appendChild(actions);
      card.appendChild(mid);

      // live status line
      const working = PREP.has(a.status);
      const line = el("div", "statusline");
      line.appendChild(el("span", "sl-label", "Status:"));
      const step = (label, cls) => {
        const s = el("span", "sl-step" + (cls ? " " + cls : ""));
        s.appendChild(el("span", "sl-mark"));
        s.appendChild(document.createTextNode(label));
        return s;
      };
      if (a.status === "applying") {
        line.appendChild(step("Submitting application", "busy"));
      } else if (a.status === "expired") {
        line.appendChild(el("span", null, "Expired"));
      } else if (a.status === "applied" || a.status === "interview" || a.status === "offer") {
        line.appendChild(step("Submitted", "done"));
      } else {
        const formDone = !working && a.fields.total > 0 && a.fields.needsHuman === 0;
        line.appendChild(step("Resume", a.cvUuid ? "done" : (working ? "busy" : "")));
        line.appendChild(step("Cover letter", a.coverLetterUuid ? "done" : (working ? "busy" : "")));
        line.appendChild(step("Apply form", formDone ? "done" : (working ? "busy" : "")));
      }
      card.appendChild(line);

      if (a.prepareError) card.appendChild(el("p", "job-snip err", a.prepareError));
      box.appendChild(card);
    });
  }

  // Log an application the user submitted themselves, off-platform. Lightweight
  // self-contained modal (no CSS dependency) → POST /applications/manual.
  function openManualApply() {
    const ov = el("div", "manual-ov");
    ov.style.cssText = "position:fixed;inset:0;background:rgba(15,20,30,.55);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px";
    const card = el("div");
    card.style.cssText = "background:var(--panel,#fff);color:var(--text,#14181d);border-radius:14px;max-width:440px;width:100%;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.35);max-height:90vh;overflow:auto";
    card.addEventListener("click", (e) => e.stopPropagation());
    card.appendChild(el("h3", null, "Log an application"));
    const sub = el("p", null, "Record something you applied to yourself, off-platform. It drops straight into your funnel.");
    sub.style.cssText = "margin:4px 0 16px;font-size:13px;color:var(--muted)";
    card.appendChild(sub);
    const field = (label, ph, type) => {
      const w = el("label"); w.style.cssText = "display:block;margin-bottom:12px;font-size:13px;font-weight:600";
      w.appendChild(el("span", null, label));
      const i = el("input");
      if (type) i.type = type;
      i.placeholder = ph || "";
      i.style.cssText = "display:block;width:100%;margin-top:5px;padding:9px 11px;border:1px solid var(--border,#d7dbe3);border-radius:8px;font:inherit;font-weight:400;box-sizing:border-box";
      w.appendChild(i); card.appendChild(w); return i;
    };
    const company = field("Company *", "Acme Corp");
    const title = field("Job title *", "Data Analyst");
    const url = field("Posting link", "https://…", "url");
    const location = field("Location", "Remote · Tampa, FL");
    const row = el("div"); row.style.cssText = "display:flex;gap:10px";
    const stW = el("label"); stW.style.cssText = "flex:1;font-size:13px;font-weight:600";
    stW.appendChild(el("span", null, "Stage"));
    const stage = el("select");
    stage.style.cssText = "display:block;width:100%;margin-top:5px;padding:9px 11px;border:1px solid var(--border,#d7dbe3);border-radius:8px;font:inherit;font-weight:400";
    [["applied", "Applied"], ["interview", "Interview"], ["offer", "Offer"], ["rejected", "Rejected"]].forEach(([v, l]) => stage.appendChild(new Option(l, v)));
    stW.appendChild(stage); row.appendChild(stW);
    const dtW = el("label"); dtW.style.cssText = "flex:1;font-size:13px;font-weight:600";
    dtW.appendChild(el("span", null, "Date applied"));
    const date = el("input"); date.type = "date";
    date.style.cssText = "display:block;width:100%;margin-top:5px;padding:8px 11px;border:1px solid var(--border,#d7dbe3);border-radius:8px;font:inherit;font-weight:400;box-sizing:border-box";
    try { date.value = new Date().toISOString().slice(0, 10); } catch {}
    dtW.appendChild(date); row.appendChild(dtW);
    card.appendChild(row);
    const btns = el("div"); btns.style.cssText = "display:flex;gap:10px;justify-content:flex-end;margin-top:18px";
    const cancel = el("button", "btn ghost", "Cancel");
    cancel.addEventListener("click", () => ov.remove());
    const save = el("button", "btn primary", "Add to funnel");
    save.addEventListener("click", async () => {
      if (!company.value.trim() || !title.value.trim()) { toast("Company and job title are required"); return; }
      save.disabled = true; save.textContent = "Adding…";
      try {
        await api("/applications/manual", { method: "POST", body: JSON.stringify({
          company: company.value.trim(), title: title.value.trim(), url: url.value.trim(),
          location: location.value.trim(), status: stage.value,
          appliedAt: (() => {
            if (!date.value) return undefined;
            const [y, m, dd] = date.value.split("-").map(Number);
            return new Date(y, m - 1, dd, 12, 0, 0).toISOString(); // local noon → no day-shift
          })(),
        }) });
        ov.remove(); toast("Logged"); loadApplications(true);
        if (typeof refreshStrip === "function") refreshStrip();
      } catch (e) { toast(e.message, 3000); save.disabled = false; save.textContent = "Add to funnel"; }
    });
    btns.appendChild(cancel); btns.appendChild(save);
    card.appendChild(btns);
    ov.appendChild(card);
    ov.addEventListener("click", () => ov.remove());
    document.body.appendChild(ov);
    company.focus();
  }

  // ---- detail: resume redline, cover letter, mirrored form ------------------
  async function openApplication(uuid) {
    switchView("applications");
    const box = $("#appList");
    const stats = $("#appStats"); if (stats) stats.hidden = true;
    box.innerHTML = "";
    box.appendChild(el("div", "muted", "Loading application…"));
    let d;
    try { d = (await api(`/applications/${uuid}`)).data; }
    catch (e) { box.innerHTML = ""; box.appendChild(el("div", "banner bad", e.message)); return; }
    box.innerHTML = "";

    const back = el("button", "btn ghost", "← All applications");
    back.addEventListener("click", () => loadApplications(true));
    box.appendChild(back);

    const head = el("div", "card job");
    const top = el("div", "job-top");
    const id = el("div", "job-id");
    id.appendChild(el("h3", null, d.job.title));
    id.appendChild(el("div", "co", d.job.company || ""));
    top.appendChild(id);
    if (d.matchScore != null) {
      const sc = el("div", "job-score score-" + scoreClass(d.matchScore));
      sc.appendChild(el("b", null, d.matchScore + "%")); sc.appendChild(el("span", null, "match"));
      top.appendChild(sc);
    }
    head.appendChild(top);
    const chips = el("div", "chips"); chips.style.marginTop = "10px";
    chips.appendChild(chip(STATUS_LABEL[d.status] || d.status, null, STATUS_CLASS[d.status] || "plain"));
    if (d.ats) chips.appendChild(chip("Real application: " + d.ats, null, "green"));
    else chips.appendChild(chip("No supported ATS found: manual submit", null, "amber"));
    if (d.gateVerdict) chips.appendChild(chip("Hiring-manager gate: " + d.gateVerdict, null, d.gateVerdict === "PASS" ? "green" : "amber"));
    head.appendChild(chips);
    if (d.gateNotes && d.gateNotes.length) {
      const gb = el("div", "banner " + (d.gateVerdict === "PASS" ? "info" : "warn"));
      gb.style.marginTop = "10px"; gb.style.marginBottom = "0";
      gb.textContent = d.gateNotes.join(" · ");
      head.appendChild(gb);
    }
    // Regenerate: re-tailor résumé + cover + form from the current profile,
    // for anything not yet submitted. Sharpen your answers, then refresh here.
    if (!["applied", "interview", "offer", "rejected", "withdrawn"].includes(d.status)) {
      const regen = el("button", "btn", "↻ Regenerate resume & cover letter");
      regen.style.marginTop = "11px";
      regen.title = "Re-write both documents from your latest profile answers and template";
      regen.addEventListener("click", async () => {
        regen.disabled = true; regen.textContent = "Regenerating…";
        try {
          await api(`/applications/${uuid}`, { method: "PATCH", body: JSON.stringify({ action: "regenerate" }) });
          toast("Rewriting from your current profile… this takes a few seconds.", 3200);
          setTimeout(() => openApplication(uuid), 6000);
        } catch (e) { regen.disabled = false; regen.textContent = "↻ Regenerate resume & cover letter"; toast(e.message, 3200); }
      });
      head.appendChild(regen);
    }
    // document links (Drive) when Cowork has attached them
    if (d.resumeUrl || d.coverUrl) {
      const docs = el("div", null); docs.style.cssText = "display:flex;gap:16px;margin-top:11px;font-size:13px";
      if (d.resumeUrl) { const a = el("a", "doclink", "📄 Résumé"); a.href = d.resumeUrl; a.target = "_blank"; a.rel = "noopener"; docs.appendChild(a); }
      if (d.coverUrl) { const a = el("a", "doclink", "✉️ Cover letter"); a.href = d.coverUrl; a.target = "_blank"; a.rel = "noopener"; docs.appendChild(a); }
      head.appendChild(docs);
    }
    box.appendChild(head);

    // activity timeline — the story of this job, newest first
    if (d.activity && d.activity.length) {
      const tl = el("div", "card block-body"); tl.style.marginTop = "12px";
      tl.appendChild(el("h4", null, "Activity"));
      const list = el("div", "timeline");
      d.activity.forEach((e) => {
        const row = el("div", "tl-row");
        row.style.cssText = "display:flex;gap:10px;padding:7px 0;border-top:1px solid var(--border,#eceef2);font-size:13px";
        const when = el("div", "muted", fmtDateTime(e.createdAt));
        when.style.cssText = "flex:0 0 128px;color:var(--muted);font-size:12px";
        const msg = el("div", null);
        msg.appendChild(el("span", "tl-kind", (ACT_ICON[e.kind] || "•") + " "));
        msg.appendChild(document.createTextNode(e.message));
        row.appendChild(when); row.appendChild(msg); list.appendChild(row);
      });
      tl.appendChild(list); box.appendChild(tl);
    }

    // tabs
    const tabs = el("div", "tabs");
    const panels = {};
    const needBadge = d.fields.filter((f) => f.fillStatus === "needs_human").length;
    [["resume", "Resume"], ["cover", "Cover letter"],
     ["form", "Apply form" + (needBadge ? ` (${needBadge})` : "")]].forEach(([k, lbl], i) => {
      const b = el("button", "tab" + (i === 0 ? " active" : ""), lbl);
      b.addEventListener("click", () => {
        tabs.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        Object.entries(panels).forEach(([pk, p]) => (p.hidden = pk !== k));
      });
      tabs.appendChild(b);
    });
    box.appendChild(tabs);

    // resume panel: redline against the base
    const pr = el("div", "card block-body");
    if (d.cv?.diff) {
      const legend = el("p", "muted", "Tracked changes against your base resume: ");
      legend.appendChild(el("ins", null, "added"));
      legend.appendChild(document.createTextNode(" / "));
      legend.appendChild(el("del", null, "removed"));
      pr.appendChild(legend);
      const body = el("div", "redline");
      d.cv.diff.forEach((r) => {
        const node = r.op === "add" ? el("ins", null, r.text) : r.op === "del" ? el("del", null, r.text) : document.createTextNode(r.text);
        body.appendChild(node);
      });
      pr.appendChild(body);
    } else if (d.cv?.content) {
      const c = d.cv.content;
      pr.appendChild(el("p", null, c.summary));
      c.sections.forEach((s) => {
        pr.appendChild(el("h3", null, s.heading));
        const ul = el("ul"); s.bullets.forEach((b) => ul.appendChild(el("li", null, b))); pr.appendChild(ul);
      });
      pr.appendChild(el("p", "muted", "Skills: " + c.skills.join(", ")));
    } else pr.appendChild(el("p", "muted", "No resume was generated."));
    if (d.cv?.verifyReport && !d.cv.verifyPassed) {
      const vb = el("div", "banner bad");
      vb.textContent = "Blocked by the quality gate: " + (d.cv.verifyReport.failures || []).join(" · ");
      pr.insertBefore(vb, pr.firstChild);
    }
    if (d.cv?.uuid) {
      const dl = el("a", "btn primary", "Download resume (PDF)");
      dl.href = `/api/v1/documents/${d.cv.uuid}/pdf`; dl.target = "_blank"; dl.rel = "noopener";
      dl.style.marginTop = "14px";
      pr.appendChild(dl);
    }
    panels.resume = pr; box.appendChild(pr);

    // cover letter panel
    const pc = el("div", "card block-body"); pc.hidden = true;
    if (d.coverLetter?.content) {
      const c = d.coverLetter.content;
      pc.appendChild(el("p", null, c.greeting));
      c.paragraphs.forEach((p) => pc.appendChild(el("p", null, p)));
      pc.appendChild(el("p", null, c.closing));
    } else pc.appendChild(el("p", "muted", "No cover letter was generated."));
    if (d.coverLetter?.uuid) {
      const dl = el("a", "btn primary", "Download cover letter (PDF)");
      dl.href = `/api/v1/documents/${d.coverLetter.uuid}/pdf`; dl.target = "_blank"; dl.rel = "noopener";
      dl.style.marginTop = "14px";
      pc.appendChild(dl);
    }
    panels.cover = pc; box.appendChild(pc);

    // form panel: the employer's real questions, prefilled
    const pf = el("div", "card block-body"); pf.hidden = true;
    if (!d.fields.length) {
      // Manual apply: be explicit about where the documents are and what to do.
      pf.appendChild(el("h3", null, "This one is a manual submit"));
      const expl = el("p", "muted");
      expl.textContent = d.ats
        ? "We found this employer's system but couldn't mirror this particular form. Your tailored documents are still ready below."
        : "This employer's application system isn't one we can fill for you yet. Your tailored resume and cover letter are still written, gated and ready: download both, then attach them on the employer's page.";
      pf.appendChild(expl);
      const steps = el("ol");
      steps.style.cssText = "font-size:13px;margin:8px 0 14px;padding-left:20px;line-height:1.9";
      [["Download your tailored resume and cover letter below."],
       ["Open the employer's application page."],
       ["Attach the PDFs and submit: the rest of the form is usually just your contact details, which are on your Profile page."]]
        .forEach(([t]) => steps.appendChild(el("li", null, t)));
      pf.appendChild(steps);
      const row = el("div", "job-actions"); row.style.justifyContent = "flex-start";
      if (d.cv?.uuid) {
        const a1 = el("a", "btn primary", "Download resume (PDF)");
        a1.href = `/api/v1/documents/${d.cv.uuid}/pdf`; a1.target = "_blank"; a1.rel = "noopener";
        row.appendChild(a1);
      }
      if (d.coverLetter?.uuid) {
        const a2 = el("a", "btn primary", "Download cover letter (PDF)");
        a2.href = `/api/v1/documents/${d.coverLetter.uuid}/pdf`; a2.target = "_blank"; a2.rel = "noopener";
        row.appendChild(a2);
      }
      if (d.job.applyUrl) {
        const a3 = el("a", "btn", "Open the employer's application \u2197");
        a3.href = d.job.applyUrl; a3.target = "_blank"; a3.rel = "noopener noreferrer";
        row.appendChild(a3);
      }
      pf.appendChild(row);
      const done = el("button", "btn ghost", "I submitted it \u2014 mark as applied");
      done.style.marginTop = "10px";
      done.addEventListener("click", async () => {
        try {
          await api(`/applications/${uuid}`, { method: "PATCH", body: JSON.stringify({ action: "markApplied" }) });
          toast("Marked as applied. Replies will be tracked in your inbox.");
          loadApplications(true);
        } catch (e) { toast(e.message, 3000); }
      });
      pf.appendChild(done);
    } else {
      const pending = new Map();
      d.fields.forEach((f) => {
        const row = el("div", "field");
        const lab = el("label", null, f.label);
        if (f.required) lab.appendChild(el("span", "req", "*"));
        row.appendChild(lab);
        const src = f.fillSource ? ({ enum: "matched to their options", llm: "written for you", human: "your answer" }[f.fillSource] || "from your profile") : null;

        if (f.fillStatus === "needs_human") {
          let input;
          if (f.options.length) {
            input = el("select");
            input.appendChild(new Option("— choose —", ""));
            f.options.forEach((o) => input.appendChild(new Option(o.label, o.value)));
          } else {
            input = el(f.type === "textarea" ? "textarea" : "input");
            if (input.tagName === "INPUT") input.type = "text";
          }
          input.addEventListener("change", () => pending.set(f.uuid, input.value));
          row.appendChild(input);
          row.appendChild(el("div", "help err", "Needs your answer"));
        } else if (f.type === "file") {
          row.appendChild(el("div", "help", "Your tailored resume is attached at submit time."));
        } else {
          const shown = f.options.length
            ? (f.options.find((o) => o.value === f.value)?.label ?? f.value ?? "")
            : (f.value ?? "");
          const input = el(f.type === "textarea" ? "textarea" : "input");
          if (input.tagName === "INPUT") input.type = "text";
          input.value = shown; input.readOnly = true;
          row.appendChild(input);
          if (src) row.appendChild(el("div", "help", src));
        }
        pf.appendChild(row);
      });

      const bar = el("div", "job-actions"); bar.style.marginTop = "16px";
      const save = el("button", "btn", "Save answers");
      save.addEventListener("click", async () => {
        if (!pending.size) { toast("Nothing to save yet"); return; }
        const answers = [...pending.entries()].map(([fieldUuid, value]) => ({ fieldUuid, value }));
        try {
          await api(`/applications/${uuid}`, { method: "PATCH", body: JSON.stringify({ answers }) });
          toast("Saved"); openApplication(uuid);
        } catch (e) { toast(e.message, 3000); }
      });
      const approve = el("button", "btn primary", "Approve application");
      approve.addEventListener("click", async () => {
        try {
          if (pending.size) {
            const answers = [...pending.entries()].map(([fieldUuid, value]) => ({ fieldUuid, value }));
            await api(`/applications/${uuid}`, { method: "PATCH", body: JSON.stringify({ answers }) });
          }
          await api(`/applications/${uuid}`, { method: "PATCH", body: JSON.stringify({ action: "approve" }) });
          toast("Approved. It will be submitted from your desktop session.", 4000);
          loadApplications(true);
        } catch (e) { toast(e.message, 4000); }
      });
      bar.appendChild(save); bar.appendChild(approve);
      pf.appendChild(bar);
      pf.appendChild(el("p", "help", "Approve locks your answers. The browser step then replays them into the employer's page and stops before final submit for your confirmation. Nothing is ever sent without you."));
    }
    panels.form = pf; box.appendChild(pf);
  }

  // ======================= TEMPLATES =======================================
  const TPL_META = [
    ["classic",   "Classic",   "Traditional serif, centered header. The safe pick for any industry."],
    ["modern",    "Modern",    "Clean sans-serif with blue accents. Tech, startups, product."],
    ["compact",   "Compact",   "Dense single page. Long work histories that must fit."],
    ["executive", "Executive", "Wide margins, double rules. Senior and leadership roles."],
    ["swiss",     "Swiss Grid", "Designer grid: monospace margin labels, hairline rules, four grays. Stands out quietly."],
  ];
  let TPL_CURRENT = "classic";
  async function renderTemplates() {
    const grid = $("#tplGrid"); grid.innerHTML = "";
    try {
      const r = await api("/profile");
      const blocks = r.data.blocks || [];
      for (const b of blocks) for (const c of b.categories || []) for (const f of c.fields || []) {
        if (f.fieldKey === "resumeTemplate" && f.value) TPL_CURRENT = String(f.value).toLowerCase();
      }
    } catch { /* default */ }
    TPL_META.forEach(([key, name, desc]) => {
      const card = el("button", "tplcard" + (TPL_CURRENT === key ? " on" : ""));
      const mini = el("div", "mini");
      mini.style.padding = "0";
      // real rendered screenshot of each template (public/img/tpl-*.png)
      const img = el("img");
      img.src = `/img/tpl-${key}.png`; img.alt = `${name} template preview`; img.loading = "lazy";
      img.style.cssText = "width:100%;height:100%;object-fit:cover;object-position:top";
      mini.appendChild(img);
      card.appendChild(mini);
      card.appendChild(el("h4", null, name + (TPL_CURRENT === key ? "  ✓" : "")));
      card.appendChild(el("p", null, desc));
      const row = el("div", "chips");
      const preview = el("a", "chip", "Preview with my resume");
      preview.href = "#"; preview.addEventListener("click", async (e) => {
        e.preventDefault(); e.stopPropagation();
        try {
          const r = await api("/applications");
          // any existing cv doc works for preview; fall back to base
          window.open(`/api/v1/documents/${await anyCvUuid()}/pdf?template=${key}`, "_blank");
        } catch { toast("Generate or upload a resume first"); }
      });
      row.appendChild(preview);
      card.appendChild(row);
      card.addEventListener("click", async () => {
        try {
          await api("/profile/values", { method: "PATCH",
            body: JSON.stringify({ values: [{ fieldKey: "resumeTemplate", value: key.toUpperCase() }] }) });
          TPL_CURRENT = key;
          toast("Template set: every PDF now uses " + name);
          renderTemplates();
        } catch (e2) { toast(e2.message, 2600); }
      });
      grid.appendChild(card);
    });
  }
  async function anyCvUuid() {
    const r = await fetch("/api/v1/documents/any-cv", { credentials: "same-origin" });
    const b = await r.json();
    if (!r.ok || !b.data?.uuid) throw new Error("none");
    return b.data.uuid;
  }

  // ======================= INBOX ============================================
  const CAT_LABEL = { all: "All", info: "Info", interview: "Interviews", offer: "Offers", rejection: "Rejections" };
  // Gmail connect / status panel — for applications the user files themselves,
  // off-platform. Reads status; shows a connect form or a "Scan now" control.
  async function renderGmailPanel(list) {
    let s;
    try { s = (await api("/gmail")).data; } catch { return; }
    const card = el("div", "card");
    card.style.cssText = "padding:14px 16px;margin-bottom:12px;border:1px solid var(--border,#e5e7eb)";
    if (s.connected) {
      card.appendChild(el("div", null, `📥 Gmail connected${s.email ? " — " + s.email : ""}. Your outside applications and their updates sync on each board refresh.`));
      const scan = el("button", "btn ghost", "Scan now"); scan.style.marginTop = "10px";
      scan.addEventListener("click", async () => {
        scan.disabled = true; scan.textContent = "Scanning…";
        try {
          const r = (await api("/gmail?scan=1", { method: "POST" })).data;
          toast(`Scanned ${r.scanned} · filed ${r.filed} · ${r.created} new · ${r.advanced} updated`, 5000);
          loadInbox(cat); loadApplications(true);
        } catch (e) { toast(e.message, 3000); scan.disabled = false; scan.textContent = "Scan now"; }
      });
      card.appendChild(scan);
    } else if (s.configured) {
      // creds saved, just needs the consent step — don't show blank inputs
      card.appendChild(el("h4", null, "Finish connecting Gmail"));
      const ok = el("p", "help"); ok.innerHTML = "✓ Your Google credentials are saved. Click below to authorize access and finish (you'll see Google's approval screen).";
      card.appendChild(ok);
      const go = el("a", "btn primary", "Connect Gmail"); go.href = "/api/v1/gmail/connect"; go.style.display = "inline-block";
      card.appendChild(go);
      const re = el("button", "btn ghost", "Re-enter credentials"); re.style.marginLeft = "8px";
      re.addEventListener("click", async () => {
        try { await api("/gmail", { method: "POST", body: JSON.stringify({ clientId: "", clientSecret: "" }) }); } catch {}
        loadInbox(cat);
      });
      // (only offer re-enter if they think the creds are wrong)
      card.appendChild(el("p", "help", "Wrong Client ID/Secret? Use the JSON download from Google, or re-create the OAuth client, then reconnect."));
    } else {
      card.appendChild(el("h4", null, "Connect Gmail — required"));
      const req = el("p", "help");
      req.innerHTML = "This tool applies to jobs using <strong>your Gmail address</strong> and tracks every recruiter reply for you, so a Gmail account is required. " +
        'Don\'t have one? <a href="https://accounts.google.com/signup" target="_blank" rel="noopener">Create a free Gmail</a> first, then come back here.';
      card.appendChild(req);
      card.appendChild(el("p", "help", "Paste the Client ID and Secret from your Google Cloud OAuth app (redirect URI: /api/v1/gmail/callback). Read-only — we only detect application confirmations and status updates."));
      const mk = (ph, type) => { const i = el("input"); i.placeholder = ph; if (type) i.type = type;
        i.style.cssText = "display:block;width:100%;margin:6px 0;padding:8px 10px;border:1px solid var(--border,#d7dbe3);border-radius:8px;box-sizing:border-box;font:inherit"; card.appendChild(i); return i; };
      const cid = mk("Google Client ID"); const csec = mk("Google Client Secret", "password");
      const btn = el("button", "btn primary", s.configured ? "Reconnect Gmail" : "Save & Connect"); btn.style.marginTop = "6px";
      btn.addEventListener("click", async () => {
        try {
          if (cid.value.trim() && csec.value.trim()) {
            await api("/gmail", { method: "POST", body: JSON.stringify({ clientId: cid.value.trim(), clientSecret: csec.value.trim() }) });
          } else if (!s.configured) { toast("Enter your Client ID and Secret"); return; }
          window.location.href = "/api/v1/gmail/connect";
        } catch (e) { toast(e.message, 3000); }
      });
      card.appendChild(btn);
    }
    list.prepend(card);
  }

  async function loadInbox(cat) {
    const chipsBox = $("#inboxCats"); const list = $("#inboxList");
    list.innerHTML = ""; list.appendChild(el("div", "muted", "Loading…"));
    let d;
    try { d = (await api("/inbox?category=" + cat)).data; }
    catch (e) { list.innerHTML = ""; list.appendChild(el("div", "banner bad", e.message)); return; }
    chipsBox.innerHTML = "";
    ["all", "info", "interview", "offer", "rejection"].forEach((k) => {
      const c = d.counts[k] || { total: 0, unread: 0 };
      const total = k === "all" ? Object.values(d.counts).reduce((a, x) => a + x.total, 0) : c.total;
      const chip2 = el("button", "chip" + (cat === k ? " green" : ""), `${CAT_LABEL[k]}${total ? " " + total : ""}`);
      chip2.addEventListener("click", () => loadInbox(k));
      chipsBox.appendChild(chip2);
    });
    list.innerHTML = "";
    await renderGmailPanel(list);
    if (!d.emails.length) {
      const p = el("div", "card placeholder");
      p.innerHTML = '<div class="ph-icon"><svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg></div>' +
        "<h3>Nothing here yet</h3><p>Each application you approve gets its own private address. When employers reply, it lands here sorted into Info, Interviews, Offers and Rejections, and your application statuses update on their own.</p>";
      list.appendChild(p);
      return;
    }
    d.emails.forEach((m) => {
      const it = el("article", "card inbox-item" + (m.read ? "" : " unread"));
      const meta = el("div", "meta");
      meta.appendChild(el("div", "from", (m.from || "") + (m.job ? ` · ${m.job.title} @ ${m.job.company}` : "")));
      meta.appendChild(el("div", "subj", m.subject || "(no subject)"));
      meta.appendChild(el("div", "snip", m.snippet));
      it.appendChild(meta);
      const right = el("div", "inbox-right");
      right.appendChild(el("span", `cat-pill cat-${m.category}`, CAT_LABEL[m.category] || m.category));
      const del = el("button", "btn ghost inbox-del", "Delete");
      del.title = "Remove this message";
      del.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        try { await api("/inbox", { method: "DELETE", body: JSON.stringify({ id: m.id }) });
              it.remove(); toast("Deleted"); } catch (e) { toast(e.message, 3000); }
      });
      right.appendChild(del);
      it.appendChild(right);
      it.addEventListener("click", async () => {
        if (!m.read) { try { await api("/inbox", { method: "PATCH", body: JSON.stringify({ id: m.id, read: true }) }); } catch {} }
        if (m.applicationUuid) openApplication(m.applicationUuid);
      });
      list.appendChild(it);
    });
  }

  // ---- base resume: generate from profile answers + PDF download ----------
  $("#btnGenResume").addEventListener("click", async () => {
    const btn = $("#btnGenResume"); const out = $("#genResult");
    btn.disabled = true; btn.textContent = "Writing your resume…";
    out.innerHTML = "";
    try {
      const r = await api("/documents/base", { method: "POST" });
      const d = r.data;
      const dl = $("#btnDlResume");
      dl.href = `/api/v1/documents/${d.uuid}/pdf`; dl.hidden = false;
      const rev = d.expertReview || {};
      const box = el("div", "banner " + (rev.verdict === "PASS" ? "info" : "warn"));
      const head = rev.verdict === "PASS"
        ? "Your resume is ready, and it clears the hiring-manager screen. Download it below or keep sharpening your answers: every improvement flows into it."
        : "Your resume is ready. The hiring-manager reviewer left notes to make it stronger: each one is fixable from your profile answers.";
      box.appendChild(el("strong", null, head));
      (rev.notes || []).slice(0, 5).forEach((n) => { const li = el("div"); li.textContent = "\u2022 " + n; box.appendChild(li); });
      out.appendChild(box);
      toast("Base resume created", 2400);
    } catch (e) {
      const box = el("div", "banner bad");
      box.textContent = e.message || "Could not generate the resume.";
      out.appendChild(box);
    } finally {
      btn.disabled = false; btn.textContent = "Write my resume from my answers";
    }
  });

  // ---- resume upload ------------------------------------------------------
  $("#btnResume").addEventListener("click", () => $("#resumeFile").click());
  $("#resumeFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const btn = $("#btnResume");
    btn.disabled = true; btn.textContent = "Reading resume…";
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/v1/profile/import-resume", { method: "POST", body: fd, credentials: "same-origin" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Import failed");
      const n = body.data.appliedCount, s = body.data.suggestionCount;
      toast(n ? `Filled in ${n} field${n === 1 ? "" : "s"}${s ? ` (${s} already had answers)` : ""}` : "Nothing new to add", 3200);
      await loadProfile();
    } catch (err) {
      toast(err.message || "Could not read that resume", 3600);
    } finally {
      btn.disabled = false; btn.textContent = "Upload resume";
      e.target.value = "";
    }
  });

  async function boot() {
    try {
      const me = await api("/auth/me");
      if (!me.data.user) { showAuth(); return; }
      const u = me.data.user;
      SWEEP_RUNNING = !!me.data.sweepStarted;
      if (me.data.tipjarUrl) {
        const foot = document.querySelector(".side-foot");
        if (foot && !$("#tipjar")) {
          const a2 = el("a", "btn ghost", "\u2615 Chip in for server costs");
          a2.id = "tipjar"; a2.href = me.data.tipjarUrl; a2.target = "_blank"; a2.rel = "noopener";
          a2.style.cssText = "width:100%;justify-content:center;font-size:12px;margin-bottom:4px";
          a2.title = "This site takes real time to build and real money to run. Tips keep it free.";
          foot.insertBefore(a2, foot.firstChild);
        }
      }
      $("#userName").textContent = u.name || u.email;
      $("#userEmail").textContent = u.name ? u.email : "";
      $("#userAva").textContent = (u.name || u.email || "?").trim()[0];
      MODEL = null; MATCHES_LOADED = false;
      refreshStrip();
      // Deep link from a notification email: /#application=<uuid> opens that
      // application's review screen directly.
      const deep = location.hash.match(/^#application=([a-f0-9-]{8,})$/i);
      if (deep) { switchView("applications"); openApplication(deep[1]); }
      else switchView("matches");
      loadProfile().catch(() => {});
    } catch (e) {
      if (e.message !== "unauthorized") toast("Could not load: " + e.message);
    }
  }

  // ---- init --------------------------------------------------------------
  setMode("login");
  (async () => {
    try {
      const me = await api("/auth/me");
      if (me.data.user) { showApp(); boot(); } else { showAuth(); }
    } catch { showAuth(); }
  })();
})();
