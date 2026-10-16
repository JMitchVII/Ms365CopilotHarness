// Copies shared files into extension/generated/ (Chrome can only load files inside the extension folder).
import { mkdirSync, copyFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
mkdirSync(new URL('extension/generated/', root), { recursive: true });
for (const [from, to] of [['protocol/tools.json', 'tools.json'], ['prompt/bootstrap.md', 'bootstrap.md']]) {
  copyFileSync(new URL(from, root), new URL(`extension/generated/${to}`, root));
  console.log(`synced ${from}`);
}
