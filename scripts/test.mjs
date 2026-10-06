// npm test: runs every test/*.test.js with Node's test runner. The files are
// listed here rather than with test/*.test.js on the command line, because
// Windows' shell does not expand the * and Node 20 does not either.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const dir = new URL('../test/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort().map((f) => `test/${f}`);
const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(run.status ?? 1);
