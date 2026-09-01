// Minimal PDF writer for résumés and cover letters. No dependencies: Workers
// can't run weasyprint or a headless browser, and the tailored document HAS to
// come out as a real .pdf because that's the file the ATS upload takes.
//
// Base-14 fonts only (Times/Helvetica + bold), WinAnsi encoding, US Letter.
// Four templates share one layout engine and differ in fonts, sizes, accents
// and margins. The user picks theirs once in Résumé & Voice (resumeTemplate).
import type { CvContent, CoverContent } from "./_docs";

export interface Contact {
  name: string; email?: string | null; phone?: string | null;
  city?: string | null; state?: string | null; linkedin?: string | null;
  website?: string | null;
}

// Sections a résumé needs beyond the tailored core: pulled from the profile at
// render time so every template shows the whole person.
export interface CvExtras {
  education?: { degree?: string; school?: string; fieldOfStudy?: string; endDate?: string }[];
  certs?: string[];
  tagline?: string | null;        // 3-5 core tools, " · " separated (swiss header)
  credentialLine?: string | null; // e.g. "U.S. ARMY VETERAN" — derived, optional
  // one-line "what the company is" sublines, keyed by employer name match
  employerSublines?: { employer: string; description: string }[];
  // skills grouped for the swiss SKILLS row: "Label: item, item" lines
  skillGroups?: { label: string; items: string[] }[];
}

// ---- WinAnsi text handling ---------------------------------------------------
const REPLACE: Record<string, string> = {
  "‘": "'", "’": "'", "“": '"', "”": '"',
  "–": "-", "—": "-", "•": "\x95", "·": "\xb7",
  "…": "...", " ": " ",
};
function winAnsi(s: string): string {
  let out = "";
  for (const ch of s) {
    if (REPLACE[ch] != null) { out += REPLACE[ch]; continue; }
    const c = ch.codePointAt(0)!;
    out += c >= 32 && c <= 255 ? ch : "?";
  }
  return out.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// Width model (1000-unit em). Class-based approximation, deliberately a touch
// wide so wrapped lines never overflow the measure.
function charW(ch: string, bold: boolean): number {
  if ("iljI.,;:'|!()[] ".includes(ch)) return 285;
  if ("ftr-\"/".includes(ch)) return 360;
  if ("mwMW@".includes(ch)) return 920;
  if (ch >= "A" && ch <= "Z") return 700;
  if (ch >= "0" && ch <= "9") return 540;
  return bold ? 580 : 540;
}
export function textWidth(s: string, size: number, bold = false): number {
  let u = 0;
  for (const ch of s) u += charW(ch, bold);
  return (u / 1000) * size;
}
function wrap(s: string, size: number, maxW: number, bold = false): string[] {
  const words = (s || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (textWidth(t, size, bold) <= maxW || !line) line = t;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

// ---- tiny PDF document builder ------------------------------------------------
type RGB = [number, number, number];
class Pdf {
  private pages: string[] = [];
  private buf: string[] = [];
  private fonts = { R: "F1", B: "F2", M: "F3" };
  used = { R: false, B: false };
  constructor(public serif: boolean) {}

  text(x: number, y: number, str: string, size: number, opts: { bold?: boolean; mono?: boolean; color?: RGB; spacing?: number } = {}) {
    const f = opts.mono ? this.fonts.M : opts.bold ? this.fonts.B : this.fonts.R;
    if (opts.bold) this.used.B = true; else this.used.R = true;
    const [r, g, b] = opts.color || [0, 0, 0];
    const sp = opts.spacing ? ` ${opts.spacing} Tc` : " 0 Tc";
    this.buf.push(`BT /${f} ${size} Tf ${r} ${g} ${b} rg${sp} ${x.toFixed(1)} ${y.toFixed(1)} Td (${winAnsi(str)}) Tj ET`);
  }
  // Courier metrics are exact: every glyph is 600/1000 em. Use for anything
  // right-aligned so the right edge is actually straight.
  monoWidth(str: string, size: number, spacing = 0): number {
    return str.length * 0.6 * size + Math.max(0, str.length - 1) * spacing;
  }
  rule(x1: number, y: number, x2: number, w = 0.7, color: RGB = [0, 0, 0]) {
    const [r, g, b] = color;
    this.buf.push(`${r} ${g} ${b} RG ${w} w ${x1.toFixed(1)} ${y.toFixed(1)} m ${x2.toFixed(1)} ${y.toFixed(1)} l S`);
  }
  rect(x: number, y: number, w: number, h: number, color: RGB) {
    const [r, g, b] = color;
    this.buf.push(`${r} ${g} ${b} rg ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`);
  }
  endPage() { this.pages.push(this.buf.join("\n")); this.buf = []; }

  build(): Uint8Array {
    if (this.buf.length) this.endPage();
    if (!this.pages.length) this.pages.push("");
    const baseR = this.serif ? "Times-Roman" : "Helvetica";
    const baseB = this.serif ? "Times-Bold" : "Helvetica-Bold";
    const objs: string[] = [];
    const add = (s: string) => { objs.push(s); return objs.length; };  // 1-based ids

    const fontR = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${baseR} /Encoding /WinAnsiEncoding >>`);
    const fontB = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${baseB} /Encoding /WinAnsiEncoding >>`);
    const fontM = add(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>`);
    const pagesId = objs.length + this.pages.length * 2 + 1; // computed after contents+pages
    const pageIds: number[] = [];
    const contentIds: number[] = [];
    for (const p of this.pages) {
      const stream = p;
      contentIds.push(add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
    }
    for (const cid of contentIds) {
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${cid} 0 R /Resources << /Font << /F1 ${fontR} 0 R /F2 ${fontB} 0 R /F3 ${fontM} 0 R >> >> >>`));
    }
    const realPages = add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
    const catalog = add(`<< /Type /Catalog /Pages ${realPages} 0 R >>`);
    if (realPages !== pagesId) {
      // keep the forward references honest
      for (let i = 0; i < objs.length; i++) objs[i] = objs[i].replaceAll(`/Parent ${pagesId} 0 R`, `/Parent ${realPages} 0 R`);
    }
    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += String(off).padStart(10, "0") + " 00000 n \n";
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}

// ---- templates -----------------------------------------------------------------
interface Tpl {
  serif: boolean; margin: number; accent: RGB;
  name: number; section: number; body: number; lead: number;
  sectionCaps: boolean; sectionRule: "accent" | "thin" | "double" | "none";
  centerHeader: boolean; accentName: boolean;
}
const TEMPLATES: Record<string, Tpl> = {
  classic:   { serif: true,  margin: 54, accent: [0, 0, 0],            name: 21, section: 11,   body: 10.5, lead: 13.6,
               sectionCaps: true,  sectionRule: "thin",   centerHeader: true,  accentName: false },
  // monochrome per Ben's call: no color accents on résumés, grays and black only
  modern:    { serif: false, margin: 50, accent: [0.08, 0.08, 0.08],    name: 22, section: 10.5, body: 10,   lead: 13.4,
               sectionCaps: true,  sectionRule: "accent", centerHeader: false, accentName: false },
  compact:   { serif: false, margin: 42, accent: [0.1, 0.1, 0.15],      name: 16, section: 9.5,  body: 9.3,  lead: 11.6,
               sectionCaps: true,  sectionRule: "thin",   centerHeader: false, accentName: false },
  executive: { serif: true,  margin: 60, accent: [0.1, 0.12, 0.2],      name: 24, section: 11.5, body: 10.5, lead: 14.2,
               sectionCaps: true,  sectionRule: "double", centerHeader: true,  accentName: false },
};
export const TEMPLATE_NAMES = [...Object.keys(TEMPLATES), "swiss"];

const PAGE_H = 792, PAGE_W = 612;

class Flow {
  y = 0;
  constructor(public pdf: Pdf, public t: Tpl) { this.y = PAGE_H - t.margin; }
  get width() { return PAGE_W - this.t.margin * 2; }
  need(h: number) {
    if (this.y - h < this.t.margin) { this.pdf.endPage(); this.y = PAGE_H - this.t.margin; }
  }
  para(txt: string, size: number, opts: { bold?: boolean; color?: RGB; indent?: number; hang?: string } = {}) {
    const x = this.t.margin + (opts.indent || 0);
    const maxW = this.width - (opts.indent || 0);
    const lines = wrap(txt, size, maxW, opts.bold);
    for (let i = 0; i < lines.length; i++) {
      this.need(this.t.lead);
      this.y -= this.t.lead;
      if (i === 0 && opts.hang) this.pdf.text(x - 11, this.y, opts.hang, size, { color: opts.color });
      this.pdf.text(x, this.y, lines[i], size, { bold: opts.bold, color: opts.color });
    }
  }
  gap(h: number) { this.y -= h; }
  section(title: string) {
    const t = this.t;
    this.need(t.lead * 2.4);
    this.gap(t.lead * 0.9);
    const label = t.sectionCaps ? title.toUpperCase() : title;
    this.y -= t.section + 2;
    this.pdf.text(t.margin, this.y, label, t.section, { bold: true, color: t.sectionRule === "accent" ? t.accent : [0, 0, 0], spacing: 0.6 });
    if (t.sectionRule !== "none") {
      const ry = this.y - 4;
      if (t.sectionRule === "double") {
        this.pdf.rule(t.margin, ry, PAGE_W - t.margin, 0.9, t.accent);
        this.pdf.rule(t.margin, ry - 2.2, PAGE_W - t.margin, 0.5, t.accent);
        this.y -= 4;
      } else {
        this.pdf.rule(t.margin, ry, PAGE_W - t.margin, t.sectionRule === "accent" ? 1.3 : 0.7,
                      t.sectionRule === "accent" ? t.accent : [0.75, 0.75, 0.78]);
      }
      this.y -= 6;
    } else this.y -= 3;
  }
}

function contactLine(c: Contact): string {
  return [ [c.city, c.state].filter(Boolean).join(", "), c.phone, c.email, c.linkedin, c.website ]
    .filter(Boolean).join("   \xb7   ");
}

function header(f: Flow, c: Contact) {
  const t = f.t;
  const nameColor: RGB = t.accentName ? t.accent : [0, 0, 0];
  if (t.centerHeader) {
    f.y -= t.name;
    const w = textWidth(c.name, t.name, true);
    f.pdf.text((PAGE_W - w) / 2, f.y, c.name, t.name, { bold: true, color: nameColor });
    const cl = contactLine(c);
    if (cl) {
      f.y -= t.body + 7;
      const cw = textWidth(cl, t.body - 0.5);
      f.pdf.text((PAGE_W - cw) / 2, f.y, cl, t.body - 0.5, { color: [0.32, 0.34, 0.4] });
    }
    if (t.sectionRule === "double") {
      f.y -= 10; f.pdf.rule(t.margin, f.y, PAGE_W - t.margin, 1.1, t.accent);
      f.pdf.rule(t.margin, f.y - 2.4, PAGE_W - t.margin, 0.5, t.accent); f.y -= 4;
    }
  } else {
    f.y -= t.name;
    f.pdf.text(t.margin, f.y, c.name, t.name, { bold: true, color: nameColor });
    const cl = contactLine(c);
    if (cl) { f.y -= t.body + 6; f.pdf.text(t.margin, f.y, cl, t.body - 0.5, { color: [0.32, 0.34, 0.4] }); }
    if (t.sectionRule === "accent") { f.y -= 9; f.pdf.rule(t.margin, f.y, PAGE_W - t.margin, 1.6, t.accent); }
  }
  f.gap(4);
}

export function renderCvPdf(cv: CvContent, contact: Contact, template = "classic", extras: CvExtras = {}): Uint8Array {
  if (template.toLowerCase() === "swiss") return renderSwiss(cv, contact, extras);
  const t = TEMPLATES[template.toLowerCase()] || TEMPLATES.classic;
  const pdf = new Pdf(t.serif);
  const f = new Flow(pdf, t);
  header(f, contact);

  if (cv.summary?.trim()) { f.section("Summary"); f.para(cv.summary, t.body); }

  if (cv.sections?.length) {
    f.section("Experience");
    for (const s of cv.sections) {
      f.gap(t.lead * 0.45);
      f.need(t.lead * 2);
      f.para(s.heading, t.body + 0.5, { bold: true });
      for (const b of s.bullets || []) f.para(b, t.body, { indent: 14, hang: "\x95" });
    }
  }
  if (cv.skills?.length) { f.section("Skills"); f.para(cv.skills.join("  \xb7  "), t.body); }
  if (extras.certs?.length) { f.section("Certifications"); f.para(extras.certs.join("  \xb7  "), t.body); }
  if (extras.education?.length) {
    f.section("Education");
    for (const e of extras.education) {
      f.para(`${e.degree || ""}${e.fieldOfStudy ? ", " + e.fieldOfStudy : ""}: ${e.school || ""}${e.endDate ? " (" + e.endDate + ")" : ""}`, t.body);
    }
  }
  return pdf.build();
}

// ---- SWISS GRID -----------------------------------------------------------
// Ben's original design spec (resume-builder/references/design-spec.css),
// generalized for any user. Two-column rows: a monospace uppercase label in
// the left margin column, content on the right. One thick rule after the
// header, hairlines between rows, four grays, no other decoration.
// Order per the spec: PROFILE, SKILLS, CERTS + TRAINING, EDUCATION,
// EXPERIENCE, EARLIER CAREER (older roles compressed to single lines).
const SW = {
  ink: [0.078, 0.078, 0.078] as RGB, sub: [0.4, 0.4, 0.4] as RGB,
  meta: [0.533, 0.533, 0.533] as RGB, label: [0.6, 0.6, 0.6] as RGB,
  hair: [0.847, 0.847, 0.847] as RGB, contact: [0.267, 0.267, 0.267] as RGB,
  mLeft: 43.5, mTop: 39, labelW: 96, gap: 19.5, body: 9.4, lead: 14,
};

function headingYears(heading: string): number | null {
  const m = heading.match(/(\d{4})[^)]*(?:to|[-\u2013])\s*(present|now|\d{4})/i);
  if (!m) return null;
  return /present|now/i.test(m[2]) ? 9999 : Number(m[2]);
}

// "Title, Employer (2026-01 to present)" -> { text, dates: "01/2026-NOW" }.
// The spec wants dates right-aligned in mono, never inline with the title.
function splitHeading(heading: string): { text: string; dates: string | null } {
  const m = heading.match(/^(.*?)\s*\(([^)]*\d{4}[^)]*)\)\s*$/);
  if (!m) return { text: heading, dates: null };
  const fmt = (t: string) => {
    const s = t.trim();
    if (/^(present|now|current)$/i.test(s)) return "NOW";
    const ym = s.match(/^(\d{4})[-/](\d{1,2})$/);
    if (ym) return `${ym[2].padStart(2, "0")}/${ym[1]}`;
    const my = s.match(/^(\d{1,2})[-/](\d{4})$/);
    if (my) return `${my[1].padStart(2, "0")}/${my[2]}`;
    return s;
  };
  // tokenize rather than split: "2026-01" contains the same dash that
  // separates the range, so a naive split shreds the start date
  const toks = m[2].match(/\d{4}[-/]\d{1,2}|\d{1,2}\/\d{4}|\d{4}|present|now|current/gi) || [];
  const dates = toks.length >= 2 ? `${fmt(toks[0])}-${fmt(toks[toks.length - 1])}` : toks.length ? fmt(toks[0]) : m[2];
  return { text: m[1].replace(/[,\s]+$/, ""), dates };
}

function renderSwiss(cv: CvContent, contact: Contact, extras: CvExtras): Uint8Array {
  const pdf = new Pdf(false);           // Helvetica body; Courier is drawn via mono flag below
  const W = 612, H = 792;
  const contentX = SW.mLeft + SW.labelW + SW.gap;
  const contentW = W - SW.mLeft - contentX;
  let y = H - SW.mTop;
  let page = 1;

  // The mono font: base-14 Courier via a second Pdf font would complicate the
  // builder, so mono runs use Helvetica at label size with letterspacing —
  // faithful to the spec's hierarchy even though Plex Mono itself can't embed.
  const mono = (x: number, yy: number, txt: string, size: number, color: RGB, spacing = 1.1) =>
    pdf.text(x, yy, txt.toUpperCase(), size, { color, spacing, mono: true });

  const newPage = () => {
    pdf.endPage(); page++; y = H - SW.mTop;
    y -= 8; mono(SW.mLeft, y, `${contact.name} \xb7 ${page}/2`, 7.5, SW.label);
    y -= 10;
  };
  const need = (h: number) => { if (y - h < SW.mTop) newPage(); };

  const wrapPara = (txt: string, x: number, maxW: number, size: number, opts: { bold?: boolean; color?: RGB; hang?: string } = {}) => {
    for (const [i, line] of wrap(txt, size, maxW, opts.bold).entries()) {
      need(SW.lead); y -= SW.lead;
      if (i === 0 && opts.hang) pdf.text(x - 10, y, opts.hang, size, { color: opts.color || SW.ink });
      pdf.text(x, y, line, size, { bold: opts.bold, color: opts.color || SW.ink });
    }
  };

  // "<b>prefix</b> rest" paragraph — the spec's education lines, skills
  // categories and earlier-career roles all lead with a bold run.
  const boldLead = (prefix: string, rest: string, x: number, maxW: number, size: number, color: RGB = SW.ink) => {
    const pw = textWidth(prefix, size, true) + size * 0.34;
    const restLines = wrap(rest, size, maxW - pw);
    need(SW.lead); y -= SW.lead;
    pdf.text(x, y, prefix, size, { bold: true, color });
    if (restLines[0]) pdf.text(x + pw, y, restLines[0], size, { color });
    // continuation lines re-wrap at full measure
    const carried = restLines.slice(1).join(" ");
    if (carried) for (const line of wrap(carried, size, maxW)) {
      need(SW.lead); y -= SW.lead; pdf.text(x, y, line, size, { color });
    }
  };

  // right-aligned mono dates on the same baseline as the line just drawn
  const datesRight = (dates: string, size = 7.9) => {
    const w = pdf.monoWidth(dates, size);
    pdf.text(W - SW.mLeft - w, y, dates, size, { color: SW.meta, mono: true });
  };

  // header: name left, contact block right (5 short lines)
  y -= 28.5;
  pdf.text(SW.mLeft, y, contact.name, 28.5, { bold: true, color: SW.ink });
  // Contact block: Courier so right alignment is EXACT (600/1000em per glyph),
  // five lines per the spec: city, phone, email, linkedin, website.
  const contactLines = [
    [contact.city, contact.state].filter(Boolean).join(", "), contact.phone || "",
    contact.email || "", (contact.linkedin || "").replace(/^https?:\/\//, ""),
    (contact.website || "").replace(/^https?:\/\//, ""),
  ].filter(Boolean);
  let cy = H - SW.mTop - 8;
  for (const cl of contactLines) {
    const w = pdf.monoWidth(cl, 7.6);
    pdf.text(W - SW.mLeft - w, cy, cl, 7.6, { color: SW.contact, mono: true });
    cy -= 11.5;
  }
  if (extras.tagline) { y -= 15; pdf.text(SW.mLeft, y, extras.tagline, 9, { color: SW.contact }); }
  if (extras.credentialLine) { y -= 12; mono(SW.mLeft, y, extras.credentialLine, 7.5, SW.meta); }

  // one row: thick rule first time, hairline after
  let firstRow = true;
  const row = (label: string) => {
    need(SW.lead * 3);
    y -= firstRow ? 18 : 12;
    pdf.rule(SW.mLeft, y, W - SW.mLeft, firstRow ? 1.5 : 0.7, firstRow ? SW.ink : SW.hair);
    firstRow = false;
    y -= 14;
    mono(SW.mLeft, y, label, 7.5, SW.label);
    y += SW.lead;   // content starts on the label's baseline row
  };

  if (cv.summary?.trim()) { row("PROFILE"); y -= SW.lead; wrapPara(cv.summary, contentX, contentW, SW.body); }

  if (extras.skillGroups?.length) {
    // spec: 2-4 lines, each "<b>Category:</b> item, item, item"
    row("SKILLS"); y -= SW.lead;
    for (const g of extras.skillGroups) {
      if (g.items?.length) boldLead(g.label + ":", g.items.join(", "), contentX, contentW, SW.body);
    }
  } else if (cv.skills?.length) {
    row("SKILLS"); y -= SW.lead;
    wrapPara(cv.skills.join(", "), contentX, contentW, SW.body);
  }
  if (extras.certs?.length) {
    row("CERTS + TRAINING"); y -= SW.lead;
    for (const c of extras.certs) wrapPara(c, contentX, contentW, SW.body);
  }
  if (extras.education?.length) {
    row("EDUCATION"); y -= SW.lead;
    for (const e of extras.education) {
      if (!e.endDate) {
        // supplemental line (e.g. coursework): plain, secondary color
        wrapPara(`${e.degree || ""}${e.school ? " at " + e.school : ""}${e.fieldOfStudy ? ": " + e.fieldOfStudy : ""}`,
                 contentX, contentW, 8.8, { color: SW.sub });
      } else {
        // "<b>Degree,</b> Institution" left, year right in mono meta
        const degree = `${e.degree || ""}${e.fieldOfStudy ? ", " + e.fieldOfStudy : ""}`;
        boldLead(degree + ",", e.school || "", contentX, contentW - 42, SW.body);
        datesRight(e.endDate);
      }
    }
  }

  // All roles render uniformly under EXPERIENCE, in profile order. (An
  // auto-split into "EARLIER CAREER" mis-bucketed borderline roles, so it's gone.)
  const recent = cv.sections || [];

  if (recent.length) {
    row("EXPERIENCE"); y -= SW.lead;
    for (const [i, sec] of recent.entries()) {
      if (i > 0) y -= 8;
      need(SW.lead * 2.5);
      // title bold left, dates right-aligned mono — never inline
      const { text: title, dates } = splitHeading(sec.heading);
      const reserve = dates ? pdf.monoWidth(dates, 7.9) + 10 : 0;
      const titleLines = wrap(title, 10.1, contentW - reserve, true);
      for (const [li, line] of titleLines.entries()) {
        need(SW.lead); y -= SW.lead;
        pdf.text(contentX, y, line, 10.1, { bold: true, color: SW.ink });
        if (li === 0 && dates) datesRight(dates);
      }
      // one-line "what the company is" subline, from the user's own employer notes
      const sub = (extras.employerSublines || []).find((s) =>
        s.employer && sec.heading.toLowerCase().includes(s.employer.toLowerCase()));
      if (sub) {
        const d = sub.description.replace(/^a\s+/i, "");   // "a sales platform" -> "Sales platform"
        wrapPara(d.charAt(0).toUpperCase() + d.slice(1), contentX, contentW, 8.6, { color: SW.sub });
      }
      y -= 2;
      for (const b of sec.bullets || []) wrapPara(b, contentX + 12, contentW - 12, SW.body, { hang: "\x95" });
    }
  }
  return pdf.build();
}

export function renderCoverPdf(cl: CoverContent, contact: Contact, meta: { company?: string | null; date?: string }, template = "classic", extras: CvExtras = {}): Uint8Array {
  // The closing often already reads "Sincerely, <name>". Only add the name
  // line when it isn't there, so it never signs twice.
  const needsName = !(cl.closing || "").toLowerCase().includes(contact.name.toLowerCase().split(" ")[0]);

  if (template.toLowerCase() === "swiss") return renderSwissCover(cl, contact, meta, extras, needsName);

  const t = TEMPLATES[template.toLowerCase()] || TEMPLATES.classic;
  const pdf = new Pdf(t.serif);
  const f = new Flow(pdf, t);
  header(f, contact);
  f.gap(t.lead);
  if (meta.date) { f.para(meta.date, t.body); f.gap(t.lead * 0.6); }
  if (cl.greeting) { f.para(cl.greeting, t.body); f.gap(t.lead * 0.6); }
  for (const p of cl.paragraphs || []) { f.para(p, t.body); f.gap(t.lead * 0.6); }
  if (cl.closing) { f.gap(t.lead * 0.4); f.para(cl.closing, t.body); if (needsName) f.para(contact.name, t.body); }
  return pdf.build();
}

// Cover letter in the swiss grid: identical header to the résumé, one LETTER
// row with the body in the content column.
function renderSwissCover(cl: CoverContent, contact: Contact, meta: { company?: string | null; date?: string }, extras: CvExtras, needsName: boolean): Uint8Array {
  const pdf = new Pdf(false);
  const W = 612, H = 792;
  const contentX = SW.mLeft + SW.labelW + SW.gap;
  const contentW = W - SW.mLeft - contentX;
  let y = H - SW.mTop;

  y -= 28.5;
  pdf.text(SW.mLeft, y, contact.name, 28.5, { bold: true, color: SW.ink });
  const lines = [
    [contact.city, contact.state].filter(Boolean).join(", "), contact.phone || "",
    contact.email || "", (contact.linkedin || "").replace(/^https?:\/\//, ""),
    (contact.website || "").replace(/^https?:\/\//, ""),
  ].filter(Boolean);
  let cy = H - SW.mTop - 8;
  for (const l of lines) {
    const w = pdf.monoWidth(l, 7.6);
    pdf.text(W - SW.mLeft - w, cy, l, 7.6, { color: SW.contact, mono: true });
    cy -= 11.5;
  }
  if (extras.tagline) { y -= 15; pdf.text(SW.mLeft, y, extras.tagline, 9, { color: SW.contact }); }

  y -= 18;
  pdf.rule(SW.mLeft, y, W - SW.mLeft, 1.5, SW.ink);
  y -= 14;
  pdf.text(SW.mLeft, y, "LETTER", 7.5, { color: SW.label, spacing: 1.1, mono: true });
  y += SW.lead; y -= SW.lead;

  const para = (txt: string, gapAfter = 0.6) => {
    for (const line of wrap(txt, SW.body, contentW)) {
      y -= SW.lead;
      pdf.text(contentX, y, line, SW.body, { color: SW.ink });
    }
    y -= SW.lead * gapAfter;
  };
  y -= 4;
  if (meta.date) para(meta.date);
  if (cl.greeting) para(cl.greeting);
  for (const p of cl.paragraphs || []) para(p);
  if (cl.closing) { para(cl.closing, 0); if (needsName) { y -= SW.lead; pdf.text(contentX, y, contact.name, SW.body, { color: SW.ink }); } }
  return pdf.build();
}
