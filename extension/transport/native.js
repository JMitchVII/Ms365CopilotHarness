// Native messaging transport: talks to agent/host.bat through chrome.runtime.connectNative.
// Interface shared with the file transport: connect() -> hello, send(call) -> result, cancel(id).

export const HOST_NAME = 'com.w365.harness';

export function transportError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function createNativeTransport({ connectNative, getLastError = () => undefined, onStatus = () => {}, timeoutMs = 130_000 }) {
  let port = null;
  let hello = null;
  const pending = new Map();  // call id -> { resolve, reject, timer }

  function settle(id) {
    const entry = pending.get(id);
    if (entry) {
      pending.delete(id);
      clearTimeout(entry.timer);
    }
    return entry;
  }

  function onMessage(msg) {
    if (msg.kind !== 'result') return;
    const entry = settle(msg.id);
    if (!entry) return;
    const { v, kind, ...result } = msg;
    entry.resolve(result);
  }

  function onDisconnect() {
    const reason = getLastError()?.message ?? 'Native host disconnected';
    port = null;
    hello = null;
    onStatus('disconnected');
    for (const id of [...pending.keys()]) settle(id).reject(transportError('E_TRANSPORT', reason));
  }

  function connect() {
    if (hello) return hello;
    port = connectNative(HOST_NAME);
    const thisPort = port;
    hello = new Promise((resolve, reject) => {
      thisPort.onMessage.addListener(msg => {
        if (msg.kind === 'hello') {
          onStatus('connected');
          resolve(msg);
        } else {
          onMessage(msg);
        }
      });
      thisPort.onDisconnect.addListener(() => {
        reject(transportError('E_TRANSPORT', getLastError()?.message ?? 'Native host disconnected'));
        onDisconnect();
      });
    });
    hello.catch(() => {});  // a failed hello is reported through send()
    port.postMessage({ v: 1, kind: 'hello' });
    return hello;
  }

  async function send(call) {
    await connect();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        settle(call.id);
        reject(transportError('E_TIMEOUT', `No result for call "${call.id}" after ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(call.id, { resolve, reject, timer });
      port.postMessage({ v: 1, kind: 'call', id: call.id, tool: call.tool, args: call.args });
    });
  }

  // The agent runs one call at a time and can't be interrupted, so cancelling means closing the port:
  // Chrome then stops the host. The next send() starts a fresh one.
  function cancel(id) {
    if (!port) return;
    port.disconnect();  // Chrome doesn't fire onDisconnect for the side that disconnects
    port = null;
    hello = null;
    for (const key of [...pending.keys()]) {
      settle(key).reject(transportError('E_TRANSPORT', key === id ? 'Cancelled by user' : 'Cancelled with another call'));
    }
  }

  return { connect, send, cancel };
}
