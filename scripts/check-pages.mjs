import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../frontend/dist');
const prefix = '/handshake-career-lab/';
const html = await readFile(join(root, 'index.html'), 'utf8');
let assets = 0;
for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
  const url = match[1];
  if (/^(?:https?:|mailto:|#)/.test(url)) continue;
  assert.ok(url.startsWith(prefix), `Asset must stay under the project path: ${url}`);
  const local = resolve(root, url.slice(prefix.length));
  assert.ok(local.startsWith(root + sep));
  assert.ok((await stat(local)).isFile(), `Missing asset: ${url}`);
  assets++;
}
let files = 0;
let demoFound = false;
async function walk(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) { await walk(path); continue; }
    files++;
    assert.ok(!/\.(?:map|sqlite|dll|pdb)$/i.test(entry.name), `Backend/debug artifact included: ${entry.name}`);
    const text = await readFile(path, 'utf8');
    assert.ok(!/https?:\/\/(?:localhost|127\.0\.0\.1)|C:\\\\?Users\\|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{25,}|-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(text), `Local address or credential pattern in ${entry.name}`);
    if (entry.name.endsWith('.js') && text.includes('handshake-career-lab:v1')) demoFound = true;
  }
}
await walk(root);
assert.ok(demoFound, 'Pages output must explicitly include the browser-demo storage adapter.');
assert.ok(assets >= 3, 'Expected the built JS, CSS and icon.');
console.log(JSON.stringify({ checkedFiles: files, localAssets: assets, projectBase: prefix, browserDemo: true, localhostLinks: 0 }));
