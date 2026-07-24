const {Document,Packer,Paragraph,TextRun,AlignmentType,BorderStyle,TabStopType,TabStopPosition}=require('docx');
const F="Calibri";
const P=(t,o={})=>new Paragraph({spacing:{after:o.after??70,line:o.line??264},alignment:o.a,
  children:[new TextRun({text:t,size:(o.sz??20),font:F,bold:o.b,italics:o.i})]});
const H=(t)=>new Paragraph({spacing:{before:170,after:25},
  border:{bottom:{style:BorderStyle.SINGLE,size:6,color:"999999",space:2}},
  children:[new TextRun({text:t,size:21,font:F,bold:true})]});
const B=(t)=>new Paragraph({spacing:{after:40},indent:{left:200,hanging:130},
  children:[new TextRun({text:"• "+t,size:20,font:F})]});
const JOB=(l,r)=>new Paragraph({spacing:{before:110,after:0},
  tabStops:[{type:TabStopType.RIGHT,position:TabStopPosition.MAX}],
  children:[new TextRun({text:l,size:21,font:F,bold:true}),new TextRun({text:"\t"+r,size:21,font:F,bold:true})]});
const header=(subtitle)=>[
 P("BEN WHETSTONE",{sz:32,b:true,a:AlignmentType.CENTER,after:0}),
 P(subtitle,{sz:20,a:AlignmentType.CENTER,after:10}),
 P("Apollo Beach (Tampa), FL  |  813-468-9832  |  brwhetstone@gmail.com  |  linkedin.com/in/benwhetstone  |  data.benwhetstone.info",{sz:17,a:AlignmentType.CENTER,after:8}),
 P("U.S. Army Veteran  |  Previously held U.S. Army Secret clearance, eligible for reinstatement",{sz:17,a:AlignmentType.CENTER,after:50}),
];
const earlier=[
 H("EARLIER CAREER"),
 P("Police Officer, St. Petersburg Police Department, 2009 to 2017. Detention Deputy, Hillsborough County Sheriff's Office, 2007 to 2009. Ten years of sworn service under continuous federal background investigation."),
 P("Network Technician, Hostway Corp. and Field Technician, Bright House Networks, 2004 to 2007."),
 P("Signal Support Systems Specialist (MOS 25U), United States Army, 2000 to 2004. Maintained LAN servers and 200+ workstations to Department of Defense security standards. Combat deployments supporting Operation Iraqi Freedom and Operation Enduring Freedom. Honorable discharge."),
];
const edu=[
 H("EDUCATION AND CERTIFICATIONS"),
 P("M.P.A., Public Administration, Troy University, 2011  ·  Graduate Certificate, Justice Administration, University of South Florida, 2016"),
 P("B.S., Business Administration & Management, University of Phoenix, 2007, including undergraduate computer and information science coursework completed at Troy University: programming methods, business information systems, computer networking, and digital computer architecture."),
 P("Microsoft Certified: Azure Data Fundamentals (DP-900), July 2026  ·  Google Data Analytics Foundations  ·  Introduction to SQL and Intermediate SQL, DataCamp 2026  ·  In progress: Microsoft PL-300 (Power BI Data Analyst), Tableau Desktop Specialist"),
];
const doc=(children)=>new Document({sections:[{
 properties:{page:{size:{width:12240,height:15840},margin:{top:640,bottom:640,left:820,right:820}}},children}]});
module.exports={P,H,B,JOB,header,earlier,edu,doc,Packer};

const EXP_CD = (P,H,B,JOB)=>[
 JOB("Founder, Closing Day (closingday.info)","01/2026 \u2013 Present"),
 P("Apollo Beach (Tampa), FL  \u00b7  Small, growing SaaS business serving real estate teams",{sz:17,after:30}),
 B("Founded and run the business. Designed the relational data model and schema, and built the scoring logic that ranks client records on past performance. That scoring is what customers buy the product for."),
 B("Collect requirements from customers, write the specifications, oversee development, run acceptance testing, and manage the release."),
 B("Write SQL against production data to answer customer questions, joining sources that disagree and resolving the differences."),
 B("Check analysis output before it reaches customers. When figures do not reconcile, trace the cause and correct the process, not just the record."),
 B("Built the product by directing an AI development pipeline instead of hiring engineers. Method documented at aiopsforrealestate.com."),
];
const EXP_SST = (P,H,B,JOB)=>[
 JOB("Founder & Team Leader, The South Shore Team","01/2016 \u2013 Present"),
 P("Apollo Beach (Tampa), FL  \u00b7  Residential real estate sales team, \$30M+ annual transaction volume",{sz:17,after:30}),
 B("Founded and lead the team: strategy, recruiting, training, compliance, and full P&L ownership."),
 B("Decide which metrics actually predict production, and build the reporting against those rather than against whatever data is easiest to pull. Used that analysis to cut time spent on low-probability deals and concentrate agent effort where it paid."),
 B("Reconcile CRM, MLS, transaction management, and bookkeeping systems into one set of numbers the business runs on. Four systems that rarely agree."),
 B("Produce recurring and one-off analysis for the team, corporate compliance, and outside partners, and present it to people who make decisions from it without reading the underlying data."),
 B("Manage marketing spend against measured return, reallocating budget based on campaign performance rather than habit."),
];
module.exports.EXP_CD=EXP_CD; module.exports.EXP_SST=EXP_SST;
