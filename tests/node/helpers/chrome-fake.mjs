// Minimal stand-ins for the chrome.* APIs the extension uses. Promise-based, like MV3.

export function createStorageArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      if (keys == null) return structuredClone(data);
      const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out = {};
      for (const k of list) {
        if (k in data) out[k] = structuredClone(data[k]);
        else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[k] = keys[k];
      }
      return out;
    },
    async set(items) { Object.assign(data, structuredClone(items)); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
  };
}

function createEvent() {
  const listeners = [];
  return {
    addListener: fn => listeners.push(fn),
    removeListener: fn => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    emit: (...args) => listeners.slice().forEach(fn => fn(...args)),
  };
}

// Fake chrome.runtime.connectNative. Each connect makes a port; `ports` lets a test play the host side.
export function createNativeHost({ autoHello = true } = {}) {
  const ports = [];
  const runtime = { lastError: undefined };
  function connectNative(name) {
    const port = {
      name,
      posted: [],
      connected: true,
      onMessage: createEvent(),
      onDisconnect: createEvent(),
      postMessage(msg) {
        if (!port.connected) throw new Error('Attempting to use a disconnected port object');
        port.posted.push(structuredClone(msg));
        if (autoHello && msg.kind === 'hello') {
          queueMicrotask(() => port.reply({ v: 1, kind: 'hello', version: '0.1.0', root: 'C:\ws', tools: ['list_dir'] }));
        }
      },
      disconnect() { port.connected = false; },
      // Test side: the host sends a message / goes away.
      reply(msg) { port.onMessage.emit(structuredClone(msg), port); },
      crash(message = 'Native host has exited.') {
        port.connected = false;
        runtime.lastError = { message };
        port.onDisconnect.emit(port);
        runtime.lastError = undefined;
      },
    };
    ports.push(port);
    return port;
  }
  return { connectNative, ports, runtime };
}

// In-memory File System Access API directory handle (what showDirectoryPicker returns).
export function createDirectoryHandle(name = 'shared') {
  const entries = new Map();  // name -> file record { text, lastModified } or directory handle
  const dir = {
    kind: 'directory',
    name,
    entries,
    async getDirectoryHandle(child, { create = false } = {}) {
      let entry = entries.get(child);
      if (!entry) {
        if (!create) throw Object.assign(new Error(`${child} not found`), { name: 'NotFoundError' });
        entry = createDirectoryHandle(child);
        entries.set(child, entry);
      }
      return entry;
    },
    async getFileHandle(child, { create = false } = {}) {
      if (!entries.has(child)) {
        if (!create) throw Object.assign(new Error(`${child} not found`), { name: 'NotFoundError' });
        entries.set(child, { text: '', lastModified: Date.now() });
      }
      return fileHandle(child);
    },
    async removeEntry(child) {
      if (!entries.delete(child)) throw Object.assign(new Error(`${child} not found`), { name: 'NotFoundError' });
    },
    async *values() { for (const key of [...entries.keys()]) yield entries.get(key).kind ? entries.get(key) : fileHandle(key); },
    async queryPermission() { return dir.permission; },
    async requestPermission() { dir.permission = 'granted'; return 'granted'; },
    permission: 'granted',
    // Test helpers (agent side)
    writeText(child, text, lastModified = Date.now()) { entries.set(child, { text, lastModified }); },
    readText(child) { return entries.get(child)?.text; },
    names() { return [...entries.keys()].filter(k => !entries.get(k).kind).sort(); },
  };
  function fileHandle(child) {
    return {
      kind: 'file',
      name: child,
      async getFile() {
        const rec = entries.get(child);
        if (!rec) throw Object.assign(new Error(`${child} not found`), { name: 'NotFoundError' });
        return { name: child, lastModified: rec.lastModified, text: async () => rec.text };
      },
      // Like Chrome: writes go to a swap copy and appear on close().
      async createWritable() {
        let buffer = '';
        return {
          async write(data) { buffer += typeof data === 'string' ? data : String(data); },
          async close() { entries.set(child, { text: buffer, lastModified: Date.now() }); },
        };
      },
    };
  }
  return dir;
}
