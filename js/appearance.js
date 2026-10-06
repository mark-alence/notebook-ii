// Font, text size and line spacing, chosen on the Appearance screen and kept
// in this browser (or desktop app). The chosen values are stored as CSS
// variables too, so index.html can apply them before the page first draws.
const KEY = 'nb2:appearance';

// 'theme': the theme's own face (css --font): modern monospace, or the DOS
// screen font in Retro.
export const FONTS = [
  { id: 'theme', name: 'Match the theme', stack: null },
  { id: 'dos', name: 'DOS screen', stack: 'var(--dos-font)' },
  { id: 'mono', name: 'Modern monospace', stack: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace' },
  { id: 'sans', name: 'Sans-serif', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { id: 'serif', name: 'Serif', stack: 'Georgia, Cambria, "Times New Roman", "Liberation Serif", serif' },
  { id: 'custom', name: 'Another font on this computer', stack: null },
];

export const SPACING = { compact: 1.25, normal: 1.4, relaxed: 1.7 };
export const SIZE = { min: 11, max: 32, default: 16 };
// listRows: how many records the list shows at a time (0 = all of them).
export const LIST_ROWS = [200, 500, 1000, 0];
// labels: where a record's field names go: 'auto' (beside the text when there
// is room for it, above it otherwise), 'above' or 'beside'.
export const LABELS = { auto: 'Automatic', above: 'Always above the text', beside: 'Always beside the text' };
export const DEFAULTS = { font: 'theme', custom: '', size: null, spacing: 'normal', listRows: 0, labels: 'auto' };

export function getAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY))?.settings ?? {};
    // Before version 2 the DOS font was everyone's default, so a saved 'dos'
    // is most likely just that: it becomes "Match the theme".
    if (!saved.v && saved.font === 'dos') saved.font = 'theme';
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

// The CSS variables for a set of choices; a missing one means "the default".
export function cssVars(a) {
  const vars = {};
  const font = FONTS.find((f) => f.id === a.font);
  if (a.font === 'custom' && a.custom.trim()) vars['--font'] = `"${a.custom.trim().replace(/["\\]/g, '')}", ${FONTS.find((f) => f.id === 'mono').stack}`;
  else if (font?.stack) vars['--font'] = font.stack;
  if (a.size) vars['--font-size'] = `${Math.max(SIZE.min, Math.min(SIZE.max, Math.round(a.size)))}px`;
  if (a.spacing && a.spacing !== 'normal' && SPACING[a.spacing]) vars['--lh'] = String(SPACING[a.spacing]);
  return vars;
}

export function applyAppearance(a = getAppearance()) {
  const root = document.documentElement.style;
  for (const name of ['--font', '--font-size', '--lh']) root.removeProperty(name);
  for (const [name, value] of Object.entries(cssVars(a))) root.setProperty(name, value);
  if (a.labels === 'above' || a.labels === 'beside') document.documentElement.dataset.labels = a.labels;
  else delete document.documentElement.dataset.labels;
}

export function setAppearance(changes) {
  const a = { ...getAppearance(), ...changes, v: 2 };
  try {
    localStorage.setItem(KEY, JSON.stringify({ settings: a, vars: cssVars(a) }));
  } catch {
    // Not kept, but still applied for this visit.
  }
  applyAppearance(a);
  return a;
}

export function resetAppearance() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to do
  }
  applyAppearance({ ...DEFAULTS });
  return { ...DEFAULTS };
}
