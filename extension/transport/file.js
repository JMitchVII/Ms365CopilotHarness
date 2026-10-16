// File transport: talks to agent/file-loop.ps1 through a shared folder picked by the user
// (File System Access API, so it runs in the side panel, not the service worker).
//   <shared>/inbox/<request>.json   extension -> agent
//   <shared>/outbox/<request>.json  agent -> extension
// Same interface as the native transport: connect() -> hello, send(call) -> result, cancel(id).

let counter = 0;
const safe = id => String(id).replace(/[^A-Za-z0-9_-]/g, '_');

export function createFileTransport({ dir, pollMs = 250, timeoutMs = 130_000, onStatus = () => {} }) {
  async function writeJson(box, name, value) {
    const handle = await box.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();  // Chrome commits the file on close()
    await writable.write(JSON.stringify(value));
    await writable.close();
  }

  async function send(call) {
    const inbox = await dir.getDirectoryHandle('inbox', { create: true });
    const name = `${Date.now()}-${++counter}-${safe(call.id)}.json`;
    await writeJson(inbox, name, { v: 1, kind: 'call', id: call.id, tool: call.tool, args: call.args });
    return waitForResult(name, call.id);
  }

  // Polls the outbox for the reply to `name`; reads it, deletes it and resolves with the result.
  async function waitForResult(name, id) {
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
        const { v, kind, ...result } = JSON.parse(text);
        return result;
      }
      await new Promise(r => setTimeout(r, pollMs));
    }
    throw Object.assign(new Error(`No result for call "${id}" after ${timeoutMs} ms`), { code: 'E_TIMEOUT' });
  }

  return { send };
}
