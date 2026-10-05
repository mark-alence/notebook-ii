// PDF output for Export: pages laid out from the paper size, margins and font
// size, with the form's header and footer on every page. The text is set in
// DejaVu Sans Mono, built into the PDF, so every character in a notebook
// prints (accents of any language, DOS box lines) and fixed-width columns
// ({Field:20}) line up.
import { paginateLines, fillPageText, wrapLine } from './printform.js';

export const PAPERS = {
  a4: { name: 'A4', w: 210, h: 297 },
  letter: { name: 'US Letter', w: 215.9, h: 279.4 },
};
export const FONT_SIZES = [8, 9, 10, 11, 12, 14];

const MM_PER_PT = 25.4 / 72;
const ADVANCE = 0.602; // width of every DejaVu Sans Mono character, in ems
const LEADING = 1.3;

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
    chars: Math.floor((p.w - 2 * margin) / (fontSize * ADVANCE * MM_PER_PT)), // characters across
  };
}

// Records (one text each) cut into pages; long lines wrap to the page width,
// lining up under their own indentation.
export function layoutPdf(blocks, options) {
  const layout = pdfLayout(options);
  const fit = (line) => {
    const indent = /^ */.exec(line)[0].length;
    return wrapLine(line, layout.chars, indent < layout.chars / 2 ? indent : 0);
  };
  const wrapped = blocks.map((b) => b.split('\n').flatMap(fit).join('\n'));
  return { layout, pages: paginateLines(wrapped, layout.room) };
}

// jsPDF: the library's constructor; font: DejaVu Sans Mono as base64.
export function makePdf(blocks, { jsPDF, font, title = '', header = '', footer = '', now = new Date(), ...options }) {
  const { layout, pages } = layoutPdf(blocks, { header, footer, ...options });
  const doc = new jsPDF({ unit: 'mm', format: [layout.paper.w, layout.paper.h], compress: true });
  doc.addFileToVFS('DejaVuSansMono.ttf', font);
  doc.addFont('DejaVuSansMono.ttf', 'DejaVuSansMono', 'normal');
  doc.setFont('DejaVuSansMono', 'normal');
  doc.setFontSize(layout.fontSize);
  doc.setProperties({ title, creator: 'Notebook II' });
  const x = layout.margin;
  const first = layout.margin + layout.line * 0.8; // baseline of the top line
  const clip = (s) => (s.length > layout.chars ? s.slice(0, layout.chars) : s);
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
export function previewPdf(blocks, { header = '', footer = '', now = new Date(), ...options }) {
  const { layout, pages } = layoutPdf(blocks, { header, footer, ...options });
  const rule = (n) => `── page ${n} of ${pages.length} ${'─'.repeat(Math.max(0, layout.chars - 16))}`.slice(0, layout.chars);
  return pages.map((lines, i) => {
    const at = { page: i + 1, pages: pages.length, now };
    return [rule(i + 1), ...(layout.head ? [fillPageText(header, at), ''] : []), ...lines, ...(layout.foot ? ['', fillPageText(footer, at)] : [])].join('\n');
  }).join('\n\n');
}
