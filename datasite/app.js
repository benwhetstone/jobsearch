/* Ben Whetstone — Data Portfolio
   Data-driven renderer. All content lives in projects.json.
   To add a module: add one entry to projects.json (see README). */

(function () {
  'use strict';

  var CAT = { apps: 'Shipped Application', data: 'Data Portfolio', certs: 'Learning + Certs', proficiency: 'Proficiency' };
  var FILTER_LABELS = { all: 'All', apps: 'Apps', data: 'Data Portfolio', certs: 'Learning + Certs', proficiency: 'Proficiency' };
  var FILTER_ORDER = ['all', 'apps', 'data', 'certs', 'proficiency'];
  var STATUS = {
    'live':        { label: 'Live',        cls: 'badge--live' },
    'in-progress': { label: 'In progress', cls: 'badge--in-progress' },
    'planned':     { label: 'Coming soon', cls: 'badge--planned' }
  };
  var STATUS_SORT = { 'live': 0, 'in-progress': 1, 'planned': 2 };

  // Secondary status toggle shown only for the Learning + Certs filter.
  var CERT_STATES = [
    { k: 'all',         label: 'All' },
    { k: 'in-progress', label: 'In Progress' },
    { k: 'completed',   label: 'Completed' }
  ];

  // Silent progress sync (no visible link on the page). Any projects.json entry
  // with a `roadmapId` mirrors the completion state I check off on my private
  // roadmap: done = complete = Live/Completed, in progress = In progress.
  // The key is read-only for this purpose; GET via ?key= avoids a CORS preflight.
  var ROADMAP_API = 'https://roadmap.benwhetstone.info/api/progress';
  var ROADMAP_KEY = '46444d84816b31186e75551c5bee4a15';

  // Catalog of roadmap cert pills that have NO hand-written card in
  // projects.json. When the roadmap marks one In Progress or Complete, a cert
  // card is generated for it automatically; unmarked ones never appear.
  // Every roadmap item that has no hand-written card in projects.json — exam certs
  // AND DataCamp skill courses. (pl-300 already has a manual card, so it's omitted.)
  var ROADMAP_CERT_CATALOG = {
    /* --- exam certs --- */
    's1:datacamp-data-analyst-professional': { title: 'Data Analyst Professional', issuer: 'DataCamp · Certification', summary: 'Professional certification validating SQL + Python data-analysis skills — timed exams plus a practical coding and reporting case study.', tags: ['SQL', 'Python', 'Analysis'] },
    's1:dp-600-fabric-analytics-engineer': { title: 'Fabric Analytics Engineer (DP-600)', issuer: 'Microsoft · Certification', summary: 'Microsoft Fabric certification — preparing and transforming data, building lakehouses and warehouses, and implementing semantic models with DAX. The Power BI line of work, one level up.', tags: ['Microsoft Fabric', 'Power BI', 'DAX', 'Semantic models', 'DP-600'] },
    's1:microsoft-fabric': { title: 'Microsoft Fabric', issuer: 'Microsoft Learn · Training path', summary: 'Hands-on Fabric training — OneLake, lakehouses, dataflows, and Direct Lake semantic models; the practical groundwork behind the DP-600 exam.', tags: ['Microsoft Fabric', 'Lakehouse', 'OneLake', 'Power BI'] },
    's1:tableau-desktop-specialist': { title: 'Tableau Desktop Specialist', issuer: 'Tableau · Certification', summary: 'Foundational Tableau certification — building views, calculations, and dashboards; the entry BI-tool credential alongside Power BI.', tags: ['Tableau', 'BI'] },
    's2:tableau-certified-data-analyst': { title: 'Tableau Certified Data Analyst', issuer: 'Tableau · Certification', summary: 'Advanced Tableau certification — data prep, modeling, LOD calculations, and dashboards for a working data analyst.', tags: ['Tableau', 'Dashboards', 'Analysis'] },
    /* --- DataCamp skill courses --- */
    's0:sql-associate-data-analyst-track': { title: 'Associate Data Analyst in SQL', issuer: 'DataCamp · Track', summary: 'Career track covering SQL for data analysis — querying, joining, aggregating, and reporting on relational data.', tags: ['SQL', 'Analysis'] },
    's0:power-bi-fundamentals': { title: 'Power BI Fundamentals', issuer: 'DataCamp · Track', summary: 'Intermediate ~17-hour track — 6 courses covering Power BI reports, DAX, data preparation, data modeling, and visualization.', tags: ['Power BI', 'DAX', 'Intermediate · 17 hrs'] },
    's0:data-analyst-in-power-bi': { title: 'Data Analyst in Power BI', issuer: 'DataCamp · Career Track', summary: 'Advanced ~50-hour career track — 17 courses and 1 assessment covering data modeling, DAX, reporting, and dashboards, aligned to the Microsoft PL-300 exam (includes a 50%-off PL-300 voucher).', tags: ['Power BI', 'DAX', 'PL-300', 'Advanced · 50 hrs'] },
    's0:excel-fundamentals': { title: 'Excel Fundamentals', issuer: 'DataCamp · Track', summary: 'Five-course track — Excel analysis, data preparation with lookups and PivotTables, visualization, what-if analysis and forecasting, plus a churn case study.', tags: ['Excel', 'PivotTables', 'Analysis'] },
    's0:excel-power-tools': { title: 'Data Analysis with Excel Power Tools', issuer: 'DataCamp · Track', summary: 'Excel power tools — Power Query, Power Pivot, and data modeling for analysis beyond basic spreadsheets.', tags: ['Excel', 'Power Query', 'Power Pivot'] },
    's0:data-storytelling-data-communication': { title: 'Data Communication Concepts', issuer: 'DataCamp · Course', summary: 'Communicating data insights — structuring findings and storytelling for non-technical stakeholders.', tags: ['Communication', 'Storytelling'] },
    's1:python-data-analyst-track': { title: 'Data Analyst in Python', issuer: 'DataCamp · Track', summary: 'Career track — pandas, data manipulation, joining, exploratory analysis, and visualization in Python.', tags: ['Python', 'pandas', 'EDA'] },
    's1:tableau-fundamentals': { title: 'Tableau Fundamentals', issuer: 'DataCamp · Track', summary: 'Five-course track — building Tableau views, calculations, and dashboards; preparation for the Desktop Specialist exam.', tags: ['Tableau', 'Dashboards'] },
    's1:statistics-fundamentals': { title: 'Statistics Fundamentals in Python', issuer: 'DataCamp · Track', summary: 'Five-course track — summary statistics, probability, distributions, and hypothesis testing in Python.', tags: ['Statistics', 'Hypothesis testing'] },
    's2:a-b-testing-customer-analytics': { title: 'Customer Analytics & A/B Testing in Python', issuer: 'DataCamp · Course', summary: 'Designing and analyzing A/B tests and measuring customer behavior in Python.', tags: ['A/B testing', 'Experimentation'] },
    's2:applied-ai-ai-fundamentals': { title: 'AI Fundamentals', issuer: 'DataCamp · Track', summary: 'Foundations of AI — machine learning concepts, generative AI, and applying AI to business problems.', tags: ['AI', 'Applied AI'] },
    's2:machine-learning-fundamentals': { title: 'Machine Learning Fundamentals in Python', issuer: 'DataCamp · Track', summary: 'Four-course track — supervised and unsupervised learning, model building, and evaluation in Python.', tags: ['Machine learning', 'Python'] },
    's2:marketing-analytics': { title: 'Marketing Analytics in Python', issuer: 'DataCamp · Track', summary: 'Six-course track — analyzing marketing campaigns, customer segmentation, and marketing ROI in Python.', tags: ['Marketing analytics', 'Python'] }
  };

  // Hero links. Email assembled at runtime from parts so the raw address isn't a
  // harvestable mailto: string in the static HTML source.
  var EMAIL_PARTS = { user: 'brwhetstone', domain: 'gmail', tld: 'com' };
  function emailUrl() {
    return 'mailto:' + EMAIL_PARTS.user + '@' + EMAIL_PARTS.domain + '.' + EMAIL_PARTS.tld;
  }
  var HERO_LINKS = [
    { label: 'LinkedIn', url: 'https://linkedin.com/in/benwhetstone', primary: true },
    { label: 'Contact',  email: true },
    { label: 'Request Resume', resume: true }
  ];
  function resumeUrl() {
    var addr = EMAIL_PARTS.user + '@' + EMAIL_PARTS.domain + '.' + EMAIL_PARTS.tld;
    return 'mailto:' + addr
      + '?subject=' + encodeURIComponent('Resume Request — data.benwhetstone.info')
      + '&body=' + encodeURIComponent("Hi Ben,\n\nI'd like to request a copy of your resume. A bit about the role / company:\n\n");
  }

  var state = { filter: 'all', certStatus: 'all', projects: [] };

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  /* ---------- Theme ---------- */
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  function renderThemeButton() {
    var btn = document.getElementById('theme-toggle');
    btn.textContent = currentTheme() === 'dark' ? '☀ Light' : '☾ Dark';
  }
  function toggleTheme() {
    var t = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('bw_theme', t); } catch (e) {}
    renderThemeButton();
  }

  /* ---------- Hero ---------- */
  function renderHero() {
    var host = document.getElementById('hero-links');
    host.innerHTML = '';
    HERO_LINKS.forEach(function (l) {
      var a = el('a', {
        class: 'btn' + (l.primary ? ' btn--accent' : ''),
        href: l.email ? emailUrl() : l.resume ? resumeUrl() : l.url, text: l.label
      });
      if (!l.email && !l.resume) { a.target = '_blank'; a.rel = 'noopener'; }
      host.appendChild(a);
    });
  }

  /* ---------- Filters ---------- */
  function count(k) {
    return k === 'all' ? state.projects.length
      : state.projects.filter(function (p) { return p.category === k; }).length;
  }
  function renderFilters() {
    var host = document.getElementById('filters');
    host.innerHTML = '';
    FILTER_ORDER.forEach(function (k) {
      var btn = el('button', {
        class: 'filter', type: 'button', role: 'tab',
        'aria-selected': state.filter === k ? 'true' : 'false'
      });
      btn.appendChild(document.createTextNode(FILTER_LABELS[k]));
      btn.appendChild(el('span', { text: String(count(k)) }));
      btn.addEventListener('click', function () { state.filter = k; render(); });
      host.appendChild(btn);
    });
  }

  // Maps a cert-toggle key to the underlying status value.
  function certMatch(p, k) {
    if (k === 'all') return true;
    if (k === 'completed') return p.status === 'live';
    return p.status === k; // 'in-progress'
  }
  function certCount(k) {
    return state.projects.filter(function (p) {
      return p.category === 'certs' && certMatch(p, k);
    }).length;
  }
  function renderCertToggle() {
    var host = document.getElementById('cert-toggle');
    if (!host) {
      host = el('div', { id: 'cert-toggle', class: 'cert-toggle', role: 'tablist' });
      document.getElementById('work').appendChild(host);
    }
    if (state.filter !== 'certs') { host.style.display = 'none'; host.innerHTML = ''; return; }
    host.style.display = 'flex';
    host.innerHTML = '';
    host.appendChild(el('span', { class: 'cert-toggle__label', text: 'Status' }));
    CERT_STATES.forEach(function (o) {
      var b = el('button', {
        class: 'cert-btn', type: 'button', role: 'tab',
        'aria-selected': state.certStatus === o.k ? 'true' : 'false'
      });
      b.appendChild(document.createTextNode(o.label));
      b.appendChild(el('span', { text: String(certCount(o.k)) }));
      b.addEventListener('click', function () { state.certStatus = o.k; render(); });
      host.appendChild(b);
    });
  }

  // Inline tool marks for Proficiency cards — uniform rounded tiles, brand color where a
  // brand exists (Excel/Sheets green, Power BI amber) else the page accent; simple white glyph.
  var T = function (fill, glyph) {
    return '<svg viewBox="0 0 40 40" width="40" height="40" xmlns="http://www.w3.org/2000/svg">'
         + '<rect width="40" height="40" rx="10" fill="' + fill + '"/>' + glyph + '</svg>';
  };
  var PROF_ICONS = {
    'prof-excel': T('#217346', '<path d="M15 14l10 12M25 14L15 26" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>'),
    'prof-google-sheets': T('#0f9d58', '<rect x="13" y="12.5" width="14" height="15" rx="2" fill="none" stroke="#fff" stroke-width="2"/><path d="M13 18.5h14M13 23h14M18.5 12.5v15" stroke="#fff" stroke-width="1.6"/>'),
    'prof-power-bi': T('#b7791f', '<path d="M15 26v-5M20 26v-9M25 26v-13" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>'),
    'prof-azure': T('#0078d4', '<path d="M25.5 26H15a4 4 0 0 1-.45-7.97 6 6 0 0 1 11.5-1.1A4 4 0 0 1 25.5 26z" fill="#fff"/>'),
    'prof-sql': T('#2f6bd6', '<g fill="none" stroke="#fff" stroke-width="2"><ellipse cx="20" cy="15" rx="6.5" ry="2.8"/><path d="M13.5 15v10c0 1.6 2.9 2.8 6.5 2.8s6.5-1.2 6.5-2.8V15"/><path d="M13.5 20c0 1.6 2.9 2.8 6.5 2.8s6.5-1.2 6.5-2.8"/></g>'),
    'prof-tsql': T('#2f6bd6', '<g fill="none" stroke="#fff" stroke-width="2"><ellipse cx="20" cy="15" rx="6.5" ry="2.8"/><path d="M13.5 15v10c0 1.6 2.9 2.8 6.5 2.8s6.5-1.2 6.5-2.8V15"/><path d="M13.5 20c0 1.6 2.9 2.8 6.5 2.8s6.5-1.2 6.5-2.8"/></g>'),
    'prof-data-analysis': T('#2f6bd6', '<g fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><circle cx="18.5" cy="18.5" r="5.5"/><path d="M22.7 22.7l4 4"/></g>'),
    'prof-crm': T('#2f6bd6', '<g stroke="#fff" stroke-width="1.7"><path d="M20 20l-7-6M20 20l7-6M20 20v8"/></g><g fill="#fff"><circle cx="20" cy="20" r="3"/><circle cx="13" cy="14" r="2.4"/><circle cx="27" cy="14" r="2.4"/><circle cx="20" cy="28" r="2.4"/></g>'),
    'prof-management': T('#2f6bd6', '<g stroke="#fff" stroke-width="1.6" fill="none"><path d="M20 15.5V20M13.5 20h13M13.5 20v4.5M26.5 20v4.5"/></g><g fill="#fff"><rect x="16.5" y="10.5" width="7" height="5" rx="1.3"/><rect x="10" y="24.5" width="7" height="5" rx="1.3"/><rect x="23" y="24.5" width="7" height="5" rx="1.3"/></g>'),
    'prof-data-viz': T('#2f6bd6', '<path d="M13 26l5-6 4 3 5-8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="27" cy="15" r="2.2" fill="#fff"/>')
  };

  /* ---------- Cards ---------- */
  function card(p) {
    var status = STATUS[p.status] || STATUS.planned;
    var statusLabel = (p.category === 'certs' && p.status === 'live') ? 'Completed' : status.label;
    var badgeCls = status.cls;
    if (p.category === 'proficiency') { statusLabel = p.level || 'Proficient'; badgeCls = 'badge--prof'; }
    var links = (p.category === 'certs' || p.category === 'proficiency') ? [] : (Array.isArray(p.links) ? p.links.slice() : []);
    var hasShots = Array.isArray(p.screenshots) && p.screenshots.length;
    var hasSpec = Array.isArray(p.spec) && p.spec.length;
    var hasBody = Array.isArray(p.body) && p.body.length;
    // Only link to the detail page when there's actually something to show there.
    if (hasShots || hasBody || (p.category === 'data' && hasSpec)) {
      links.unshift({ label: p.detailLabel || (p.category === 'data' ? 'Spec' : 'View screenshots & details'), url: 'app.html?id=' + p.id, internal: true });
    }
    var tags = Array.isArray(p.tags) ? p.tags : [];
    var shots = Array.isArray(p.screenshots) ? p.screenshots : [];
    var kids = [];

    if (p.hero) {
      kids.push(el('div', { class: 'card__hero' }, [ el('img', { src: p.hero, alt: '' }) ]));
    }

    if (p.category === 'proficiency' && PROF_ICONS[p.id]) {
      var logo = el('div', { class: 'card__logo' });
      logo.innerHTML = PROF_ICONS[p.id];
      kids.push(logo);
    }

    kids.push(el('div', { class: 'card__head' }, [
      el('span', { class: 'card__cat', text: CAT[p.category] || p.category }),
      el('span', { class: 'badge ' + badgeCls, text: statusLabel })
    ]));
    kids.push(el('h3', { text: p.title }));

    if (p.warning) {
      kids.push(el('div', { class: 'card__warn' }, [
        el('span', { class: 'card__warn-label', text: '⚠ Content note' }),
        el('span', { class: 'card__warn-text', text: p.warning })
      ]));
    }

    if (p.issuer) {
      var cred = p.date ? (p.issuer + ' · ' + p.date) : p.issuer;
      kids.push(el('div', { class: 'card__cred', text: cred }));
    }
    kids.push(el('p', { class: 'card__summary', text: p.summary }));

    if (shots.length) {
      var strip = el('div', { class: 'card__shots' });
      shots.forEach(function (src) { strip.appendChild(el('img', { src: src, alt: '', loading: 'lazy' })); });
      kids.push(strip);
    }
    if (tags.length) {
      var tagRow = el('div', { class: 'tags' });
      tags.forEach(function (t) { tagRow.appendChild(el('span', { class: 'tag', text: t })); });
      kids.push(tagRow);
    }
    if (p.note) kids.push(el('div', { class: 'card__note', text: p.note }));
    if (links.length) {
      var linkRow = el('div', { class: 'card__links' });
      links.forEach(function (l) {
        var a = el('a', { href: l.url, text: l.label + (l.internal ? ' →' : ' ↗') });
        if (!l.internal) { a.target = '_blank'; a.rel = 'noopener'; }
        linkRow.appendChild(a);
      });
      kids.push(linkRow);
    }

    var planned = p.status === 'planned' ? ' card--planned' : '';
    if (p.hero) {
      var hero = kids.shift(); // hero is the first child; keep it pinned, scroll the rest
      var scroll = el('div', { class: 'card__scroll' }, kids);
      return el('article', { class: 'card card--hero' + planned }, [hero, scroll]);
    }
    return el('article', { class: 'card' + planned }, kids);
  }

  function render() {
    renderFilters();
    renderCertToggle();
    var grid = document.getElementById('grid');
    grid.innerHTML = '';
    state.projects
      .filter(function (p) {
        if (state.filter !== 'all' && p.category !== state.filter) return false;
        if (state.filter === 'certs' && !certMatch(p, state.certStatus)) return false;
        return true;
      })
      .slice()
      .sort(function (a, b) {
        return (STATUS_SORT[a.status] === undefined ? 3 : STATUS_SORT[a.status])
             - (STATUS_SORT[b.status] === undefined ? 3 : STATUS_SORT[b.status]);
      })
      .forEach(function (p) { grid.appendChild(card(p)); });
  }

  /* ---------- Silent roadmap sync ---------- */
  function applyRoadmapProgress(projects, prog) {
    var done = new Set(Array.isArray(prog.done) ? prog.done : []);
    var doing = new Set(Array.isArray(prog.inProgress) ? prog.inProgress : []);
    projects.forEach(function (p) {
      if (!p.roadmapId) return;
      if (done.has(p.roadmapId)) p.status = 'live';           // done = complete
      else if (doing.has(p.roadmapId)) p.status = 'in-progress';
      // not on either list → keep the status from projects.json
    });
  }
  // Generate cert cards for roadmap pills that are marked but have no manual card.
  function injectRoadmapCerts(prog) {
    var done = new Set(Array.isArray(prog.done) ? prog.done : []);
    var doing = new Set(Array.isArray(prog.inProgress) ? prog.inProgress : []);
    var covered = {};
    state.projects.forEach(function (p) { if (p.roadmapId) covered[p.roadmapId] = true; });
    Object.keys(ROADMAP_CERT_CATALOG).forEach(function (rid) {
      if (covered[rid]) return;                          // a manual card already handles it
      var st = done.has(rid) ? 'live' : (doing.has(rid) ? 'in-progress' : null);
      if (!st) return;                                   // only surface when marked
      var genId = 'rc-' + rid.replace(/[^a-z0-9]+/g, '-');
      if (state.projects.some(function (p) { return p.id === genId; })) return; // no dup
      var meta = ROADMAP_CERT_CATALOG[rid];
      state.projects.push({
        id: genId, category: 'certs', roadmapId: rid, status: st,
        title: meta.title, issuer: meta.issuer, summary: meta.summary,
        tags: meta.tags || [], screenshots: [], links: []
      });
    });
  }

  function syncRoadmap() {
    fetch(ROADMAP_API + '?key=' + ROADMAP_KEY, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (prog) {
        if (!prog) return;
        injectRoadmapCerts(prog);                 // add marked-only roadmap certs
        applyRoadmapProgress(state.projects, prog); // sync statuses of mapped cards
        render();
      })
      .catch(function () { /* offline or blocked — keep projects.json statuses */ });
  }

  /* ---------- Boot ---------- */
  function init() {
    document.getElementById('year').textContent = new Date().getFullYear();
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
    renderThemeButton();
    renderHero();

    fetch('projects.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('projects.json ' + r.status); return r.json(); })
      .then(function (data) {
        state.projects = Array.isArray(data) ? data : (data && data.projects) || [];
        render();          // paint immediately from projects.json
        syncRoadmap();     // then silently reflect roadmap check-offs
      })
      .catch(function (err) {
        console.error('Could not load projects.json —', err);
        document.getElementById('grid').innerHTML =
          '<p style="color:var(--text-2)">Could not load projects.json. If opened directly from disk, run a local server (see README).</p>';
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
