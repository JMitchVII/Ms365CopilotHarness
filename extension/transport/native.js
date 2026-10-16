// Native messaging transport: talks to agent/host.bat through chrome.runtime.connectNative.
// Interface shared with the file transport: connect() -> hello, send(call) -> result, cancel(id).

export const HOST_NAME = 'com.w365.harness';

export function createNativeTransport({ connectNative, getLastError = () => undefined, onStatus = () => {}, timeoutMs = 130_000 }) {
  let port = null;
  let hello = null;

  function connect() {
    if (hello) return hello;
    port = connectNative(HOST_NAME);
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

  return { connect };
}
