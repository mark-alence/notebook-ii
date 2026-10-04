// Copies the web app into dist/ for the desktop build (Tauri bundles dist/).
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const f of ['index.html', 'manifest.webmanifest', 'css', 'js', 'icons']) {
  cpSync(`${root}${f}`, `${dist}/${f}`, { recursive: true });
}
console.log('Web app copied to dist/');
