// Light, Dark or Retro (the blue DOS screen). "Auto" follows the computer's
// own light or dark setting. The choice is kept in this browser; index.html
// applies it before the page draws.
const KEY = 'nb2:theme';
export const THEMES = ['auto', 'light', 'dark', 'retro'];
export const THEME_NAMES = { auto: 'Auto', light: 'Light', dark: 'Dark', retro: 'Retro' };

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return THEMES.includes(t) ? t : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(theme) {
  if (theme !== 'auto' && THEMES.includes(theme)) document.documentElement.dataset.theme = theme;
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
