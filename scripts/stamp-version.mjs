// Run on the published copy of the site (GitHub Pages): node scripts/stamp-version.mjs _site <id>
//
// GitHub Pages lets browsers keep each file for 10 minutes, and on a normal
// reload Chrome reuses the program files it already has without asking, so a
// reload right after an update could run the old program. Here every script
// and the style sheet get the version in their address (app.js?v=<id>): the
// page itself is always fetched afresh, so it names new addresses, which no
// browser can have kept. An import map does the same for the modules that the
// scripts import from one another. Help shows the version (js/version.js).
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const [dir, id] = process.argv.slice(2);
if (!dir || !id) throw new Error('usage: node scripts/stamp-version.mjs <site dir> <version id>');
const v = encodeURIComponent(id.replace(/\s+/g, ''));
const when = new Date().toISOString().slice(0, 16).replace('T', ' ');

writeFileSync(`${dir}/js/version.js`, `export const VERSION = ${JSON.stringify(`${when} UTC (${id})`)};\n`);

const modules = readdirSync(`${dir}/js`).filter((f) => f.endsWith('.js'));
const imports = Object.fromEntries(modules.map((f) => [`./js/${f}`, `./js/${f}?v=${v}`]));
const map = `<script type="importmap">${JSON.stringify({ imports })}</script>\n  `;

let html = readFileSync(`${dir}/index.html`, 'utf8');
const stamp = (from, to) => {
  if (!html.includes(from)) throw new Error(`index.html: ${from} not found`);
  html = html.replace(from, to);
};
stamp('href="css/style.css"', `href="css/style.css?v=${v}"`);
stamp('<script type="module" src="js/app.js"></script>', `${map}<script type="module" src="js/app.js?v=${v}"></script>`);
writeFileSync(`${dir}/index.html`, html);
console.log(`Stamped ${modules.length} modules and the style sheet with ?v=${v}`);
