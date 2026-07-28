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

  $("#logout").addEventListener("click", async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch {}
    showAuth();
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
    $("#overallFill").style.width = c.score + "%";
    $("#overallPct").textContent = c.score + "%";
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

    model.blocks.forEach((b) => {
      // nav
      const nb = el("button");
      nb.appendChild(document.createTextNode(b.label));
      const mini = el("span", "mini", `${b.completion.filledCount}/${b.completion.totalCount}`);
      mini.dataset.navMini = b.key; nb.appendChild(mini);
      nb.addEventListener("click", () => {
        document.getElementById("block-" + b.key).scrollIntoView({ behavior: "smooth", block: "start" });
        nav.querySelectorAll("button").forEach((x) => x.classList.remove("active"));
        nb.classList.add("active");
      });
      nav.appendChild(nb);

      // block panel
      const panel = el("section", "block"); panel.id = "block-" + b.key;
      panel.appendChild(el("h2", null, b.label));
      if (b.description) panel.appendChild(el("p", "desc muted", b.description));
      const strength = el("div", "block-strength");
      const bar = el("div", "bar"); const fill = el("div", "fill");
      fill.dataset.blockFill = b.key; fill.style.width = pct(b.completion.filledCount, b.completion.totalCount) + "%";
      bar.appendChild(fill);
      const lbl = el("span", "lbl", `${b.completion.filledCount}/${b.completion.totalCount}`); lbl.dataset.blockLbl = b.key;
      strength.appendChild(bar); strength.appendChild(lbl);
      panel.appendChild(strength);

      b.categories.forEach((cat) => {
        const c = el("div", "category");
        c.appendChild(el("h3", null, cat.label));
        const grid = el("div", "fieldgrid");
        cat.fields.forEach((f) => grid.appendChild(renderField(f)));
        c.appendChild(grid);
        panel.appendChild(c);
      });
      main.appendChild(panel);
    });

    if (nav.firstChild) nav.firstChild.classList.add("active");
    applyCompletion({ score: model.completion.score, blocks: Object.fromEntries(model.blocks.map((b) => [b.key, b.completion])) });
  }

  async function renderActions() {
    const banner = $("#actionBanner");
    try {
      const r = await api("/actions");
      const items = r.data.items || [];
      if (!items.length) { banner.hidden = true; return; }
      banner.innerHTML = "";
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

  async function boot() {
    try {
      const me = await api("/auth/me");
      if (!me.data.user) { showAuth(); return; }
      $("#whoami").textContent = me.data.user.name || me.data.user.email;
      const r = await api("/profile");
      render(r.data);
      renderActions();
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
