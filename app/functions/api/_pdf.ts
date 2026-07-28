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
  private fonts = { R: "F1", B: "F2" };
  used = { R: false, B: false };
  constructor(public serif: boolean) {}

  text(x: number, y: number, str: string, size: number, opts: { bold?: boolean; color?: RGB; spacing?: number } = {}) {
    const f = opts.bold ? this.fonts.B : this.fonts.R;
    if (opts.bold) this.used.B = true; else this.used.R = true;
    const [r, g, b] = opts.color || [0, 0, 0];
    const sp = opts.spacing ? ` ${opts.spacing} Tc` : " 0 Tc";
    this.buf.push(`BT /${f} ${size} Tf ${r} ${g} ${b} rg${sp} ${x.toFixed(1)} ${y.toFixed(1)} Td (${winAnsi(str)}) Tj ET`);
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
    const pagesId = objs.length + this.pages.length * 2 + 1; // computed after contents+pages
    const pageIds: number[] = [];
    const contentIds: number[] = [];
    for (const p of this.pages) {
      const stream = p;
      contentIds.push(add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
    }
    for (const cid of contentIds) {
      pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${cid} 0 R /Resources << /Font << /F1 ${fontR} 0 R /F2 ${fontB} 0 R >> >> >>`));
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
  modern:    { serif: false, margin: 50, accent: [0.145, 0.388, 0.922], name: 22, section: 10.5, body: 10,   lead: 13.4,
               sectionCaps: true,  sectionRule: "accent", centerHeader: false, accentName: true },
  compact:   { serif: false, margin: 42, accent: [0.1, 0.1, 0.15],      name: 16, section: 9.5,  body: 9.3,  lead: 11.6,
               sectionCaps: true,  sectionRule: "thin",   centerHeader: false, accentName: false },
  executive: { serif: true,  margin: 60, accent: [0.1, 0.12, 0.2],      name: 24, section: 11.5, body: 10.5, lead: 14.2,
               sectionCaps: true,  sectionRule: "double", centerHeader: true,  accentName: false },
};
export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

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
  return [ [c.city, c.state].filter(Boolean).join(", "), c.phone, c.email, c.linkedin ]
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

export function renderCvPdf(cv: CvContent, contact: Contact, template = "classic"): Uint8Array {
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
  return pdf.build();
}

export function renderCoverPdf(cl: CoverContent, contact: Contact, meta: { company?: string | null; date?: string }, template = "classic"): Uint8Array {
  const t = TEMPLATES[template.toLowerCase()] || TEMPLATES.classic;
  const pdf = new Pdf(t.serif);
  const f = new Flow(pdf, t);
  header(f, contact);
  f.gap(t.lead);
  if (meta.date) { f.para(meta.date, t.body); f.gap(t.lead * 0.6); }
  if (cl.greeting) { f.para(cl.greeting, t.body); f.gap(t.lead * 0.6); }
  for (const p of cl.paragraphs || []) { f.para(p, t.body); f.gap(t.lead * 0.6); }
  if (cl.closing) { f.gap(t.lead * 0.4); f.para(cl.closing, t.body); f.para(contact.name, t.body); }
  return pdf.build();
}
