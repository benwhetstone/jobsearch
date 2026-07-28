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

  // ---- view switching (sidebar + mobile tab bar) --------------------------
  let CURRENT_VIEW = "matches";
  function switchView(view) {
    CURRENT_VIEW = view;
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== "view-" + view; });
    document.querySelectorAll("#sidenav button, #tabbar button").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === view);
    });
    if (view === "matches" && !MATCHES_LOADED) loadMatches();
    if (view === "applications") loadApplications();
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
    setTimeout(() => fieldEl.classList.remove("saved-flash"), 1200);
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
    if (f.isRequired) { const s = el("span", "req", "*"); label.appendChild(s); }
    if (f.isMatchingInput) { label.appendChild(el("span", "match-badge", "match")); }
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

    // default string -> text
    const i = el("input"); i.type = "text"; if (f.value != null) i.value = f.value;
    i.addEventListener("input", () => queueSave(f.fieldKey, i.value === "" ? null : i.value, wrap));
    return i;
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
    // Résumé & Voice block
    employerDescriptions: { kind: "records", singular: "employer description", fields: [
      { key: "employer", label: "Employer" },
      { key: "description", label: "Exact wording to use", type: "textarea" },
    ] },
    signatureAchievements: { kind: "records", singular: "achievement", fields: [
      { key: "result", label: "The result", type: "textarea" },
      { key: "metric", label: "The number that proves it" },
      { key: "employer", label: "Where it happened" },
    ] },
    metricPhrasing: { kind: "records", singular: "phrasing rule", fields: [
      { key: "number", label: "The number" },
      { key: "phrasing", label: "How it must be phrased", type: "textarea" },
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
          const inp = fld.type === "textarea" ? el("textarea") : el("input");
          if (fld.type !== "textarea") inp.type = "text";
          inp.value = rec[fld.key] != null ? rec[fld.key] : "";
          inp.addEventListener("input", () => { rec[fld.key] = inp.value || undefined; commit(); });
          w.appendChild(inp); card.appendChild(w);
        });
        list.appendChild(card);
      });
    }
    const add = el("button", "addbtn", "Add a " + (spec.singular || "entry")); add.type = "button";
    add.addEventListener("click", () => { arr.push({}); render(); commit(); });
    box.appendChild(list); box.appendChild(add);
    render();
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

    // One block shown at a time — the reference product pages through blocks
    // rather than rendering 60+ questions in one endless scroll.
    const panels = new Map();
    const navBtns = new Map();

    model.blocks.forEach((b, idx) => {
      const nb = el("button");
      nb.appendChild(document.createTextNode(b.label));
      const frac = el("span", "frac", `${b.completion.filledCount}/${b.completion.totalCount}`);
      frac.dataset.navMini = b.key; nb.appendChild(frac);
      nb.addEventListener("click", () => showBlock(b.key));
      nav.appendChild(nb);
      navBtns.set(b.key, nb);

      const panel = el("section", "card block-body"); panel.id = "block-" + b.key;
      panel.hidden = idx !== 0;
      panel.appendChild(el("h2", null, b.label));
      if (b.description) panel.appendChild(el("p", "desc", b.description));

      const row = el("div", "bar-row");
      const bar = el("div", "progress"); const fill = el("i");
      fill.dataset.blockFill = b.key;
      fill.style.width = pct(b.completion.filledCount, b.completion.totalCount) + "%";
      bar.appendChild(fill);
      const lbl = el("span", "frac", `${b.completion.filledCount}/${b.completion.totalCount}`);
      lbl.dataset.blockLbl = b.key;
      row.appendChild(bar); row.appendChild(lbl);
      panel.appendChild(row);

      b.categories.forEach((cat) => {
        const c = el("div", "cat");
        c.appendChild(el("h3", null, cat.label));
        const grid = el("div", "fieldgrid");
        cat.fields.forEach((f) => grid.appendChild(renderField(f)));
        c.appendChild(grid);
        panel.appendChild(c);
      });
      main.appendChild(panel);
      panels.set(b.key, panel);
    });

    function showBlock(key) {
      panels.forEach((p, k) => { p.hidden = k !== key; });
      navBtns.forEach((n, k) => n.classList.toggle("active", k === key));
      window.scrollTo(0, 0);
    }
    if (model.blocks.length) showBlock(model.blocks[0].key);
    applyCompletion({ score: model.completion.score, blocks: Object.fromEntries(model.blocks.map((b) => [b.key, b.completion])) });
  }

  async function renderActions() {
    const banner = $("#actionBanner");
    try {
      const r = await api("/actions");
      const items = r.data.items || [];
      if (!items.length) { banner.hidden = true; return; }
      banner.innerHTML = "";
      banner.className = "banner warn";
      banner.appendChild(el("strong", null, `${items.length} thing${items.length === 1 ? "" : "s"} need your attention`));
      const ul = el("ul");
      items.slice(0, 5).forEach((i) => {
        const li = el("li");
        if (i.url) { const a = el("a", null, i.title); a.href = i.url; li.appendChild(a); }
        else li.appendChild(document.createTextNode(i.title));
        ul.appendChild(li);
      });
      banner.appendChild(ul);
      banner.hidden = false;
    } catch { banner.hidden = true; }
  }

  async function loadProfile() {
    const r = await api("/profile");
    render(r.data);
    renderActions();
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
    const [bg, fg] = avaFor(j.company);
    const ava = el("span", "job-ava", (j.company || "?").trim()[0].toUpperCase());
    ava.style.background = bg; ava.style.color = fg;
    top.appendChild(ava);

    const id = el("div", "job-id");
    id.appendChild(el("h3", null, j.title));
    id.appendChild(el("div", "co", j.company || "Company not listed"));
    top.appendChild(id);

    const sc = el("div", "job-score " + "score-" + scoreClass(m.totalScore));
    sc.appendChild(el("b", null, m.totalScore + "%"));
    sc.appendChild(el("span", null, "match"));
    top.appendChild(sc);
    card.appendChild(top);

    const mid = el("div", "job-mid");
    const chips = el("div", "chips");
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
    const view = el("a", "btn ghost", "View posting");
    view.href = j.url; view.target = "_blank"; view.rel = "noopener noreferrer";
    // Apply = start autopilot: tailor the résumé and cover letter, run the
    // hiring-manager gate, mirror the employer's real form and prefill it.
    // It never opens the posting and it never submits anything.
    const apply = el("button", "btn primary", "Apply");
    apply.addEventListener("click", async () => {
      apply.disabled = true; apply.textContent = "Preparing…";
      toast("Tailoring your documents and mirroring the application…", 4000);
      try {
        const r = await api("/applications", { method: "POST", body: JSON.stringify({ jobUuid: m.jobUuid }) });
        card.remove();
        switchView("applications");
        await loadApplications(true);
        if (r.data.uuid) openApplication(r.data.uuid);
      } catch (e) {
        apply.disabled = false; apply.textContent = "Apply";
        toast("Could not start: " + e.message, 3600);
      }
    });
    actions.appendChild(why); actions.appendChild(skip); actions.appendChild(view); actions.appendChild(apply);
    mid.appendChild(actions);
    card.appendChild(mid);

    if (j.snippet) {
      const s = el("p", "job-snip", j.snippet.replace(/\s+/g, " ").slice(0, 230) + "…");
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

  function renderMatches(list) {
    const box = $("#matchList"); box.innerHTML = "";
    if (!list.length) {
      const p = el("div", "card placeholder");
      p.innerHTML =
        '<div class="ph-icon"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg></div>' +
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
  async function loadMatches() {
    MATCHES_LOADED = true;
    await loadSearchPrefs();
    try {
      const r = await api("/matches");
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
    msg.innerHTML = "";
    try {
      await api("/search", { method: "PATCH", body: JSON.stringify(currentPrefs()) });
      const r = await api("/jobs/refresh", { method: "POST" });
      const d = r.data;
      const live = Object.entries(d.sources || {}).filter(([, n]) => n > 0).map(([s, n]) => `${s} ${n}`).join(" · ");
      msg.innerHTML = "";
      const b = el("div", "banner info");
      b.textContent = `Found ${d.fetched} postings, ${d.deduped} unique, ${d.matched} scored${live ? " — " + live : ""}.`;
      msg.appendChild(b);
      const m = await api("/matches");
      renderMatches(m.data.matches || []);
    } catch (e) {
      const b = el("div", "banner bad");
      b.textContent = e.message || "Search failed.";
      msg.appendChild(b);
    } finally {
      btn.disabled = false; btn.textContent = "Find jobs";
    }
  });

  // ======================= APPLICATIONS ====================================
  const STATUS_LABEL = {
    preparing: "Preparing", actionRequired: "Action required", readyToApply: "Ready to apply",
    approved: "Approved", applied: "Applied", failed: "Failed",
  };
  const STATUS_CLASS = {
    preparing: "plain", actionRequired: "amber", readyToApply: "green", approved: "green",
    applied: "green", failed: "amber",
  };

  async function loadApplications(force) {
    const box = $("#appList");
    try {
      const r = await api("/applications");
      const apps = r.data.applications || [];
      const c = $("#cntApps");
      if (c) { c.textContent = apps.length; c.hidden = apps.length === 0; }
      renderApplications(apps, r.data.counts || {});
    } catch (e) {
      if (e.message !== "unauthorized") { box.innerHTML = ""; box.appendChild(el("div", "banner bad", e.message)); }
    }
  }

  function renderApplications(apps, counts) {
    const box = $("#appList"); box.innerHTML = "";
    const stats = $("#appStats");
    if (stats) {
      stats.innerHTML = ""; stats.hidden = false;
      [["actionRequired", "Action required", "amber"], ["readyToApply", "Ready to apply", ""],
       ["approved", "Approved", ""], ["applied", "Applied", "solid"]].forEach(([k, lbl, cls]) => {
        const s = el("div", "stat" + (cls ? " " + cls : ""));
        s.appendChild(el("div", "label", lbl));
        s.appendChild(el("div", "num", String(counts[k] || 0)));
        stats.appendChild(s);
      });
    }
    if (!apps.length) {
      const p = el("div", "card placeholder");
      p.innerHTML =
        '<div class="ph-icon"><svg viewBox="0 0 24 24"><path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg></div>' +
        "<h3>No applications yet</h3><p>Hit <strong>Apply</strong> on a job. We tailor the résumé and cover letter, run the hiring-manager check, and prefill the employer's real application for your approval.</p>";
      box.appendChild(p);
      return;
    }
    apps.forEach((a) => {
      const card = el("article", "card job appcard");
      const top = el("div", "job-top");
      const [bg, fg] = avaFor(a.job.company);
      const ava = el("span", "job-ava", (a.job.company || "?").trim()[0].toUpperCase());
      ava.style.background = bg; ava.style.color = fg;
      top.appendChild(ava);
      const id = el("div", "job-id");
      id.appendChild(el("h3", null, a.job.title));
      id.appendChild(el("div", "co", a.job.company || "Company not listed"));
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
      const openBtn = el("button", "btn primary", a.status === "actionRequired" ? "Finish it" : "Review");
      openBtn.addEventListener("click", () => openApplication(a.uuid));
      actions.appendChild(openBtn);
      mid.appendChild(actions);
      card.appendChild(mid);
      if (a.prepareError) card.appendChild(el("p", "job-snip err", a.prepareError));
      box.appendChild(card);
    });
  }

  // ---- detail: résumé redline, cover letter, mirrored form ------------------
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
    box.appendChild(head);

    // tabs
    const tabs = el("div", "tabs");
    const panels = {};
    const needBadge = d.fields.filter((f) => f.fillStatus === "needs_human").length;
    [["resume", "Résumé"], ["cover", "Cover letter"],
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

    // résumé panel: redline against the base
    const pr = el("div", "card block-body");
    if (d.cv?.diff) {
      const legend = el("p", "muted", "Tracked changes against your base résumé: ");
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
    } else pr.appendChild(el("p", "muted", "No résumé was generated."));
    if (d.cv?.verifyReport && !d.cv.verifyPassed) {
      const vb = el("div", "banner bad");
      vb.textContent = "Blocked by the quality gate: " + (d.cv.verifyReport.failures || []).join(" · ");
      pr.insertBefore(vb, pr.firstChild);
    }
    if (d.cv?.uuid) {
      const dl = el("a", "btn primary", "Download r\u00e9sum\u00e9 (PDF)");
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
      pf.appendChild(el("p", "muted", d.ats
        ? "The form could not be mirrored for this posting."
        : "This employer's system isn't one we can mirror yet, so this one is a manual submit. Your tailored documents above are ready to use."));
      if (d.job.applyUrl) {
        const a = el("a", "btn", "Open the employer's application");
        a.href = d.job.applyUrl; a.target = "_blank"; a.rel = "noopener noreferrer";
        pf.appendChild(a);
      }
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
          row.appendChild(el("div", "help", "Your tailored résumé is attached at submit time."));
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

  // ---- base résumé: generate from profile answers + PDF download ----------
  $("#btnGenResume").addEventListener("click", async () => {
    const btn = $("#btnGenResume"); const out = $("#genResult");
    btn.disabled = true; btn.textContent = "Writing your résumé…";
    out.innerHTML = "";
    try {
      const r = await api("/documents/base", { method: "POST" });
      const d = r.data;
      const dl = $("#btnDlResume");
      dl.href = `/api/v1/documents/${d.uuid}/pdf`; dl.hidden = false;
      const rev = d.expertReview || {};
      const box = el("div", "banner " + (rev.verdict === "PASS" ? "info" : "warn"));
      const head = rev.verdict === "PASS"
        ? "Your résumé is ready, and it clears the hiring-manager screen. Download it below or keep sharpening your answers: every improvement flows into it."
        : "Your résumé is ready. The hiring-manager reviewer left notes to make it stronger: each one is fixable from your profile answers.";
      box.appendChild(el("strong", null, head));
      (rev.notes || []).slice(0, 5).forEach((n) => { const li = el("div"); li.textContent = "\u2022 " + n; box.appendChild(li); });
      out.appendChild(box);
      toast("Base r\u00e9sum\u00e9 created", 2400);
    } catch (e) {
      const box = el("div", "banner bad");
      box.textContent = e.message || "Could not generate the r\u00e9sum\u00e9.";
      out.appendChild(box);
    } finally {
      btn.disabled = false; btn.textContent = "Write my r\u00e9sum\u00e9 from my answers";
    }
  });

  // ---- résumé upload ------------------------------------------------------
  $("#btnResume").addEventListener("click", () => $("#resumeFile").click());
  $("#resumeFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const btn = $("#btnResume");
    btn.disabled = true; btn.textContent = "Reading résumé…";
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/v1/profile/import-resume", { method: "POST", body: fd, credentials: "same-origin" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Import failed");
      const n = body.data.appliedCount, s = body.data.suggestionCount;
      toast(n ? `Filled in ${n} field${n === 1 ? "" : "s"}${s ? ` (${s} already had answers)` : ""}` : "Nothing new to add", 3200);
      await loadProfile();
    } catch (err) {
      toast(err.message || "Could not read that résumé", 3600);
    } finally {
      btn.disabled = false; btn.textContent = "Upload résumé";
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
