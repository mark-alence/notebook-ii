// PDF output for Export: pages laid out from the paper size, margins and font
// size, with the form's header and footer on every page. The text is set in a
// DejaVu font built into the PDF, so every character in a stack prints
// (accents of any language, DOS box lines). The monospace font keeps
// fixed-width columns ({Field:20}) lined up; the serif and sans-serif ones do
// not, since their letters differ in width.
import { paginateLines, fillPageText } from './printform.js';

export const PAPERS = {
  a4: { name: 'A4', w: 210, h: 297 },
  letter: { name: 'US Letter', w: 215.9, h: 279.4 },
};
export const FONT_SIZES = [8, 9, 10, 11, 12, 14];
export const PDF_FONTS = {
  mono: { name: 'Monospace', file: 'DejaVuSansMono.ttf', family: 'DejaVuSansMono', fixed: true },
  serif: { name: 'Serif', file: 'DejaVuSerif.ttf', family: 'DejaVuSerif' },
  sans: { name: 'Sans-serif', file: 'DejaVuSans.ttf', family: 'DejaVuSans' },
};

const MM_PER_PT = 25.4 / 72;
const ADVANCE = 0.602; // width of every DejaVu Sans Mono character, in ems
const LEADING = 1.3;
const monoWidth = (s) => s.length * ADVANCE;

export function pdfLayout({ paper = 'a4', fontSize = 10, margin = 18, header = '', footer = '' } = {}) {
  const p = PAPERS[paper] ?? PAPERS.a4;
  const line = fontSize * LEADING * MM_PER_PT;
  const lines = Math.floor((p.h - 2 * margin) / line);
  const head = header.trim() ? 2 : 0;
  const foot = footer.trim() ? 2 : 0;
  return {
    paper: p,
    margin,
    line,
    fontSize,
    head,
    foot,
    room: Math.max(5, lines - head - foot), // lines for records on each page
    width: p.w - 2 * margin, // mm across
    chars: Math.floor((p.w - 2 * margin) / (fontSize * ADVANCE * MM_PER_PT)), // monospace characters across
  };
}

// The longest start of s that fits (measure: width in ems).
function fitLength(s, fits) {
  if (fits(s)) return s.length;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(s.slice(0, mid))) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// A line cut at spaces to fit the width; the rest lines up under its indent.
function wrapToWidth(text, fits, indent) {
  const out = [];
  const pad = ' '.repeat(indent);
  let line = text;
  while (!fits(line)) {
    const n = Math.max(1, fitLength(line, fits));
    let cut = line.lastIndexOf(' ', n);
    if (cut <= indent) cut = Math.max(n, indent + 1);
    const rest = line.slice(cut).trimStart();
    out.push(line.slice(0, cut).trimEnd());
    if (!rest) return out;
    line = pad + rest;
  }
  out.push(line);
  return out;
}

// A PDF has no tab stops: a tab becomes spaces up to the next multiple of 8.
export function expandTabs(line) {
  let out = '';
  for (const ch of line) out += ch === '\t' ? ' '.repeat(8 - (out.length % 8)) : ch;
  return out;
}

// Records (one text each) cut into pages; long lines wrap to the page width,
// lining up under their own indentation. measure gives a text's width in ems
// (the monospace font's unless another is given).
export function layoutPdf(blocks, { measure = monoWidth, ...options } = {}) {
  const layout = pdfLayout(options);
  const em = layout.fontSize * MM_PER_PT;
  const fits = (s) => measure(s) * em <= layout.width + 1e-6;
  const fit = (line) => {
    const indent = /^ */.exec(line)[0].length;
    return wrapToWidth(line, fits, measure(' '.repeat(indent)) * em < layout.width / 2 ? indent : 0);
  };
  const wrapped = blocks.map((b) => b.split('\n').map(expandTabs).flatMap(fit).join('\n'));
  return { layout, fits, pages: paginateLines(wrapped, layout.room) };
}

// jsPDF: the library's constructor; font: { id, data } with the font file as
// base64 (pdfFont says which of PDF_FONTS it is).
export function makePdf(blocks, { jsPDF, font, title = '', header = '', footer = '', now = new Date(), ...options }) {
  const face = PDF_FONTS[font.id] ?? PDF_FONTS.mono;
  const doc = new jsPDF({ unit: 'mm', format: [(PAPERS[options.paper] ?? PAPERS.a4).w, (PAPERS[options.paper] ?? PAPERS.a4).h], compress: true });
  doc.addFileToVFS(face.file, font.data);
  doc.addFont(face.file, face.family, 'normal');
  doc.setFont(face.family, 'normal');
  const measure = face.fixed ? monoWidth : (s) => doc.getStringUnitWidth(s);
  const { layout, fits, pages } = layoutPdf(blocks, { header, footer, measure, ...options });
  doc.setFontSize(layout.fontSize);
  doc.setProperties({ title, creator: 'ThreeByFive' });
  const x = layout.margin;
  const first = layout.margin + layout.line * 0.8; // baseline of the top line
  const clip = (s) => s.slice(0, fitLength(s, fits));
  pages.forEach((lines, i) => {
    if (i) doc.addPage();
    const at = { page: i + 1, pages: pages.length, now };
    let y = first;
    if (layout.head) {
      doc.text(clip(fillPageText(header, at)), x, y);
      y += layout.line * 2;
    }
    for (const l of lines) {
      if (l.trim()) doc.text(l, x, y);
      y += layout.line;
    }
    if (layout.foot) doc.text(clip(fillPageText(footer, at)), x, layout.paper.h - layout.margin);
  });
  return { bytes: new Uint8Array(doc.output('arraybuffer')), pages: pages.length };
}

// What the PDF's pages will hold, as text, for the preview on screen.
// measure: as for layoutPdf, so lines break where the PDF's will.
export function previewPdf(blocks, { header = '', footer = '', now = new Date(), ...options }) {
  const { layout, pages } = layoutPdf(blocks, { header, footer, ...options });
  const rule = (n) => `── page ${n} of ${pages.length} ${'─'.repeat(Math.max(0, layout.chars - 16))}`.slice(0, layout.chars);
  return pages.map((lines, i) => {
    const at = { page: i + 1, pages: pages.length, now };
    return [rule(i + 1), ...(layout.head ? [fillPageText(header, at), ''] : []), ...lines, ...(layout.foot ? ['', fillPageText(footer, at)] : [])].join('\n');
  }).join('\n\n');
}
