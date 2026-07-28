/* Job Search Engine — profile editor (Phase 1). Vanilla JS, no build step. */
(() => {
  "use strict";
  const TOKEN_KEY = "jse_token";
  let TOKEN = localStorage.getItem(TOKEN_KEY) || "";
  let MODEL = null; // last /profile payload

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  async function api(path, opts = {}) {
    const res = await fetch(`/api/v1${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}`, ...(opts.headers || {}) },
    });
    if (res.status === 401) { lock(); throw new Error("unauthorized"); }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { body, status: res.status });
    return body;
  }

  // ---- auth --------------------------------------------------------------
  function lock() {
    TOKEN = "";
    localStorage.removeItem(TOKEN_KEY);
    $("#app").hidden = true;
    $("#login").hidden = false;
  }
  function unlockUI() { $("#login").hidden = true; $("#app").hidden = false; }

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = $("#token").value.trim();
    if (!t) return;
    TOKEN = t;
    try {
      await api("/health");
      localStorage.setItem(TOKEN_KEY, t);
      unlockUI();
      boot();
    } catch {
      $("#loginErr").hidden = false;
      $("#loginErr").textContent = "That token was rejected.";
      TOKEN = "";
    }
  });
  $("#logout").addEventListener("click", lock);

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

  function objectArray(f, wrap) {
    const container = el("div", "objlist");
    const list = el("div", "objlist");
    function summary() {
      list.innerHTML = "";
      const arr = Array.isArray(f.value) ? f.value : [];
      if (!arr.length) { list.appendChild(el("div", "help", "None yet.")); return; }
      arr.forEach((o) => {
        const card = el("div", "objcard");
        const title = o.title || o.name || o.employer || Object.values(o)[0] || "item";
        card.appendChild(el("div", "t", String(title)));
        const rest = Object.entries(o).filter(([k]) => !["title", "name"].includes(k))
          .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("  ·  ");
        if (rest) card.appendChild(el("div", "muted", rest));
        list.appendChild(card);
      });
    }
    const editBtn = el("button", "linkbtn", "Edit as JSON");
    const ta = el("textarea", "objedit"); ta.hidden = true;
    ta.value = JSON.stringify(Array.isArray(f.value) ? f.value : [], null, 2);
    editBtn.addEventListener("click", () => {
      if (ta.hidden) { ta.hidden = false; editBtn.textContent = "Save JSON"; }
      else {
        try {
          const parsed = JSON.parse(ta.value);
          if (!Array.isArray(parsed)) throw new Error("must be a JSON array");
          f.value = parsed; queueSave(f.fieldKey, parsed, wrap);
          ta.hidden = true; editBtn.textContent = "Edit as JSON"; summary();
          $(".fieldmsg", wrap).textContent = "";
        } catch (e) { $(".fieldmsg", wrap).textContent = e.message; }
      }
    });
    summary();
    container.appendChild(list); container.appendChild(editBtn); container.appendChild(ta);
    return container;
  }

  function pretty(v) {
    return String(v).replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
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
        cat.fields.forEach((f) => c.appendChild(renderField(f)));
        panel.appendChild(c);
      });
      main.appendChild(panel);
    });

    if (nav.firstChild) nav.firstChild.classList.add("active");
    applyCompletion({ score: model.completion.score, blocks: Object.fromEntries(model.blocks.map((b) => [b.key, b.completion])) });
  }

  async function boot() {
    try {
      const r = await api("/profile");
      render(r.data);
    } catch (e) {
      if (e.message !== "unauthorized") toast("Could not load profile: " + e.message);
    }
  }

  // ---- init --------------------------------------------------------------
  if (TOKEN) { unlockUI(); boot(); } else { lock(); }
})();
