// File transport: talks to agent/file-loop.ps1 through a shared folder picked by the user
// (File System Access API, so it runs in the side panel, not the service worker).
//   <shared>/inbox/<request>.json   extension -> agent
//   <shared>/outbox/<request>.json  agent -> extension
//   <shared>/heartbeat.json         rewritten by the agent every poll
// Same interface as the native transport: connect() -> hello, send(call) -> result, cancel(id).

let counter = 0;
const safe = id => String(id).replace(/[^A-Za-z0-9_-]/g, '_');
const failure = (code, message) => Object.assign(new Error(message), { code });

export function createFileTransport({ dir, pollMs = 250, timeoutMs = 130_000, heartbeatStaleMs = 10_000, onStatus = () => {} }) {
  let status = null;
  const setStatus = s => { if (s !== status) { status = s; onStatus(s); } };

  async function writeJson(box, name, value) {
    const handle = await box.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();  // Chrome commits the file on close()
    await writable.write(JSON.stringify(value));
    await writable.close();
  }

  // Fails fast when the agent isn't running, instead of leaving a request nobody will answer.
  async function assertAlive() {
    let beat = null;
    try {
      beat = JSON.parse(await (await (await dir.getFileHandle('heartbeat.json')).getFile()).text());
    } catch { /* missing or half-written: treated as not running */ }
    const age = beat ? Date.now() - Date.parse(beat.at) : Infinity;
    if (!(age <= heartbeatStaleMs)) {
      setStatus('disconnected');
      throw failure('E_TRANSPORT', 'The file agent is not running (no fresh heartbeat). Start agent\\file-loop.ps1.');
    }
  }

  // Writes one request and waits for the agent's reply (the raw envelope).
  async function request(id, envelope) {
    await assertAlive();
    const inbox = await dir.getDirectoryHandle('inbox', { create: true });
    const name = `${Date.now()}-${++counter}-${safe(id)}.json`;
    await writeJson(inbox, name, envelope);
    return waitForReply(name, id);
  }

  // Polls the outbox for the reply to `name`; reads it, deletes it and returns the parsed envelope.
  async function waitForReply(name, id) {
    const outbox = await dir.getDirectoryHandle('outbox', { create: true });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let text = null;
      try {
        text = await (await (await outbox.getFileHandle(name)).getFile()).text();
      } catch (e) {
        if (e?.name !== 'NotFoundError') throw e;
      }
      if (text !== null) {
        await outbox.removeEntry(name).catch(() => {});
        return JSON.parse(text);
      }
      await new Promise(r => setTimeout(r, pollMs));
    }
    throw failure('E_TIMEOUT', `No result for call "${id}" after ${timeoutMs} ms`);
  }

  async function connect() {
    const hello = await request('hello', { v: 1, kind: 'hello' });
    setStatus('connected');
    return hello;
  }

  async function send(call) {
    const { v, kind, ...result } = await request(call.id, { v: 1, kind: 'call', id: call.id, tool: call.tool, args: call.args });
    return result;
  }

  return { connect, send };
}
