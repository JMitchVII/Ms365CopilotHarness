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
