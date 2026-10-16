// Native messaging transport: talks to agent/host.bat through chrome.runtime.connectNative.
// Interface shared with the file transport: connect() -> hello, send(call) -> result, cancel(id).

export const HOST_NAME = 'com.w365.harness';

export function createNativeTransport({ connectNative, getLastError = () => undefined, onStatus = () => {}, timeoutMs = 130_000 }) {
  let port = null;
  let hello = null;
  const pending = new Map();  // call id -> { resolve, reject }

  function onMessage(msg) {
    if (msg.kind !== 'result') return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    const { v, kind, ...result } = msg;
    entry.resolve(result);
  }

  function connect() {
    if (hello) return hello;
    port = connectNative(HOST_NAME);
    port.onMessage.addListener(onMessage);
    hello = new Promise(resolve => {
      port.onMessage.addListener(msg => {
        if (msg.kind === 'hello') {
          onStatus('connected');
          resolve(msg);
        }
      });
    });
    port.postMessage({ v: 1, kind: 'hello' });
    return hello;
  }

  async function send(call) {
    await connect();
    return new Promise((resolve, reject) => {
      pending.set(call.id, { resolve, reject });
      port.postMessage({ v: 1, kind: 'call', id: call.id, tool: call.tool, args: call.args });
    });
  }

  return { connect, send };
}
