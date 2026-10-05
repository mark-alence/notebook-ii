// Font, text size and line spacing, chosen on the Appearance screen and kept
// in this browser (or desktop app). The chosen values are stored as CSS
// variables too, so index.html can apply them before the page first draws.
const KEY = 'nb2:appearance';

export const FONTS = [
  { id: 'dos', name: 'DOS screen', stack: null },
  { id: 'mono', name: 'Modern monospace', stack: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace' },
  { id: 'sans', name: 'Sans-serif', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  { id: 'serif', name: 'Serif', stack: 'Georgia, Cambria, "Times New Roman", "Liberation Serif", serif' },
  { id: 'custom', name: 'Another font on this computer', stack: null },
];

export const SPACING = { compact: 1.25, normal: 1.4, relaxed: 1.7 };
export const SIZE = { min: 11, max: 32, default: 16 };
// listRows: how many records the list shows at a time (0 = all of them).
export const LIST_ROWS = [200, 500, 1000, 0];
export const DEFAULTS = { font: 'dos', custom: '', size: null, spacing: 'normal', listRows: 200 };

export function getAppearance() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY))?.settings };
  } catch {
    return { ...DEFAULTS };
  }
}

// The CSS variables for a set of choices; a missing one means "the default".
export function cssVars(a) {
  const vars = {};
  const font = FONTS.find((f) => f.id === a.font);
  if (a.font === 'custom' && a.custom.trim()) vars['--font'] = `"${a.custom.trim().replace(/["\\]/g, '')}", ${FONTS[1].stack}`;
  else if (font?.stack) vars['--font'] = font.stack;
  if (a.size) vars['--font-size'] = `${Math.max(SIZE.min, Math.min(SIZE.max, Math.round(a.size)))}px`;
  if (a.spacing && a.spacing !== 'normal' && SPACING[a.spacing]) vars['--lh'] = String(SPACING[a.spacing]);
  return vars;
}

export function applyAppearance(a = getAppearance()) {
  const root = document.documentElement.style;
  for (const name of ['--font', '--font-size', '--lh']) root.removeProperty(name);
  for (const [name, value] of Object.entries(cssVars(a))) root.setProperty(name, value);
}

export function setAppearance(changes) {
  const a = { ...getAppearance(), ...changes };
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
