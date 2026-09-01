#!/usr/bin/env python3
"""
Pre-submit resume verifier. Reads a generated PDF and fails loudly on any violation
of Resume Standards - Whetstone.md. Run before EVERY submit. Non-zero exit = do not send.

usage: python3 verify_resume.py "path/to/resume.pdf" [--jd "path/to/job_description.txt"]
"""
import sys, re, argparse, pdfplumber

# ---- Rule 6: the ONLY approved skills. Source of truth. -------------------
APPROVED = ["SQL","T-SQL","Power BI","Microsoft Excel","Excel","Google Sheets",
            "Data Analysis","Data Visualization","DP-900","Azure Data Fundamentals",
            "Google Ads","Lofty","SkySlope","relational data model","data quality"]

# ---- Hard bans. Any hit = FAIL. ------------------------------------------
BANNED = [
 (r"\bGA4\b",                          "GA4 - Ben does not use Google Analytics (rule 6)"),
 (r"Google Analytics(?! Foundations)",  "Google Analytics - not approved (rule 6)"),
 (r"Tag Manager|\bGTM\b",               "Google Tag Manager - not approved (rule 6)"),
 (r"\beXp\b|eXp Realty",                "eXp Realty must never appear (rule 3)"),
 (r"active(?:ly)?\s+held?\s+.{0,20}clearance|current\s+secret\s+clearance",
                                        "clearance must be 'previously held / eligible for reinstatement' (rule 4)"),
 (r"\b2[0-9]\s+years\b|\btwenty[- ]?\w*\s+years\b",
                                        "never state total career years (best-practices file)"),
 (r"Google Data Analytics Professional Certificate",
                                        "it is 'Foundations', not the full certificate (rule 8)"),
]
# ---- Conditional: allowed ONLY in the exact qualified form ----------------
CONDITIONAL = [
 (r"\bTableau\b", r"Tableau Desktop Specialist",
  "Tableau allowed ONLY as 'Tableau Desktop Specialist (in progress)' (rule 6)"),
 (r"\bPython\b",  r"Python\s*\(pandas",
  "Python allowed ONLY as 'Python (pandas, in progress)' (rule 6)"),
]

# ---- RETIRED pay figures (band updated 2026-08-22): any hit = FAIL ---------
# Current band: $77,000-$100,000, floor $77,000. If the posting's own band runs
# higher, answer inside the posting's band. These older figures must never
# appear in any resume, cover letter, or pre-filled form again.
_RP = "retired pay figure - band is $77,000-$100,000 (floor $77K), updated 2026-08-22"
BANNED += [
 (r"\$\s?54[,.]?000|\$\s?54\s?[Kk]\b", _RP + " (was: $54K hard drop)"),
 (r"\$\s?60[,.]?000|\$\s?60\s?[Kk]\b", _RP + " (was: ~$60K break-even / $60K target)"),
 (r"\$\s?63[,.]?000|\$\s?63\s?[Kk]\b", _RP + " (was: $63K)"),
 (r"\$\s?65[,.]?000|\$\s?65\s?[Kk]\b", _RP + " (was: $65K floor)"),
 (r"70,001",                                _RP + " (was: $70,001-$80,000 band pick)"),
 (r"\$\s?75\s?[-\u2013]\s?\$?\s?85\s?[Kk]|\$\s?75[,.]?000", _RP + " (was: $75-85K ask)"),
 (r"\$\s?78[,.]?000|\$\s?78\s?[Kk]\b", _RP + " (was: $78K)"),
 (r"\$\s?65\s?[-\u2013]\s?\$?\s?70\s?[Kk]",                   _RP + " (was: $65-70K Phase 1 default)"),
]

# ---- Must be present ------------------------------------------------------
REQUIRED = [
 (r"brwhetstone@gmail\.com",   "contact email missing (rule 9)"),
 (r"813-468-9832",             "phone missing (rule 9)"),
 (r"data\.benwhetstone\.info", "portfolio link missing (rule 1)"),
 (r"Google Sheets",            "Google Sheets missing (rule 6, added 2026-07-18)"),
 (r"Army Veteran|U\.S\. Army",     "veteran status missing - Ben is a protected veteran and several employers weight it"),
 # ---- Every experience role must ship WITH its description/bullets --------
 # (a role that appears with a title but no bullets is the "skipped descriptions" defect)
 (r"Closing Day",              "Closing Day experience entry missing entirely"),
 (r"South Shore Team",         "The South Shore Team experience entry missing entirely"),
 (r"data model|scoring",       "Closing Day role has NO description/bullets - skipped role descriptions, DO NOT deliver"),
 (r"reconcil|CRM, MLS|four systems", "South Shore Team role has NO description/bullets - skipped role descriptions, DO NOT deliver"),
]

def text_of(p):
    with pdfplumber.open(p) as pdf:
        return "".join((pg.extract_text() or "")+"\n" for pg in pdf.pages), len(pdf.pages)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("pdf"); ap.add_argument("--jd")
    a=ap.parse_args()
    t,pages=text_of(a.pdf); flat=re.sub(r"\s+"," ",t)
    fails=[]; warns=[]

    for pat,msg in BANNED:
        if re.search(pat,flat,re.I): fails.append(f"BANNED: {msg}")
    for pat,ok,msg in CONDITIONAL:
        if re.search(pat,flat,re.I) and not re.search(ok,flat,re.I): fails.append(f"UNQUALIFIED: {msg}")
    for pat,msg in REQUIRED:
        if not re.search(pat,flat,re.I): fails.append(f"MISSING: {msg}")
    if pages>2: fails.append(f"LENGTH: {pages} pages, max 2 (rule 2)")

    if a.jd:
        jd=open(a.jd).read().lower()
        # any approved skill the JD wants that we omitted = warning, not failure
        for s in APPROVED:
            if s.lower() in jd and s.lower() not in flat.lower():
                warns.append(f"JD mentions '{s}' and resume does not - consider adding (it IS approved)")
        # keyword overlap estimate
        jdw={w for w in re.findall(r"[a-z]{4,}",jd)}
        rw={w for w in re.findall(r"[a-z]{4,}",flat.lower())}
        ov=len(jdw&rw)/max(len(jdw),1)
        (warns if ov<0.30 else warns).append(f"keyword overlap with JD: {ov:.0%}")

    print(f"\n=== VERIFY: {a.pdf}  ({pages} pages) ===")
    for w in warns: print(f"  warn  {w}")
    if fails:
        print(f"\n  *** {len(fails)} FAILURE(S) - DO NOT SUBMIT ***")
        for f in fails: print(f"  FAIL  {f}")
        sys.exit(1)
    print("  PASS - clears Resume Standards. Safe to submit.\n")

if __name__=="__main__": main()
