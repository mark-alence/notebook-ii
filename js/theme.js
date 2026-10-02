// Light or dark screen. "Auto" follows the computer's own setting. The choice
// is kept in this browser; index.html applies it before the page draws.
const KEY = 'nb2:theme';
export const THEMES = ['auto', 'light', 'dark'];

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return THEMES.includes(t) ? t : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Not saved, but still applied for this visit.
  }
  applyTheme(theme);
}

export function nextTheme(theme) {
  return THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
}
