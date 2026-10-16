// Decides when a Copilot reply has finished streaming, from repeated snapshots of the newest reply.
// A reply is complete when its text has stopped changing for `stableMs` and the page says it's not busy
// (no aria-busy, not aria-hidden, send button not "Stop generating"). Each reply is reported once.

export function createCompletionDetector({ stableMs = 1500 } = {}) {
  let id = null;
  let text = null;
  let since = 0;
  let reported = false;
  return {
    update({ at, messageId, role, text: current, busy }) {
      if (role !== 'assistant') return null;
      if (messageId !== id) {
        id = messageId;
        text = current;
        since = at;
        reported = false;
        return null;
      }
      if (busy || current !== text) {
        text = current;
        since = at;
        return null;
      }
      if (reported || at - since < stableMs) return null;
      reported = true;
      return { messageId, text };
    },
  };
}
