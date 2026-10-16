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
