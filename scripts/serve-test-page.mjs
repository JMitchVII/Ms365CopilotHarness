// Serves extension/test-pages on http://127.0.0.1:8365 for end-to-end runs with the fake Copilot page.
// Usage: npm run fake-copilot   then open http://127.0.0.1:8365/fake-copilot.html?script=read
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const PORT = 8365;
const dir = new URL('../extension/test-pages/', import.meta.url);

createServer(async (req, res) => {
  const name = new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'fake-copilot.html';
  if (!/^[\w.-]+\.html$/.test(name)) { res.writeHead(404).end(); return; }
  try {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(await readFile(new URL(name, dir)));
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Fake Copilot: http://127.0.0.1:${PORT}/fake-copilot.html?script=read`));
