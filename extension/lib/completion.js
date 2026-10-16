// Decides when a Copilot reply has finished streaming, from repeated snapshots of the newest reply.
// A reply is complete when its text has stopped changing for `stableMs` and the page says it's not busy.

export function createCompletionDetector({ stableMs = 1500 } = {}) {
  let text = null;
  let since = 0;
  let reported = false;
  return {
    update({ at, messageId, text: current }) {
      if (current !== text) {
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
