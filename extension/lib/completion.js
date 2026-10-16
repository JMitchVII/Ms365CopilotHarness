// Decides when a Copilot reply has finished streaming, from repeated snapshots of the newest reply.

export function createCompletionDetector({ stableMs = 1500 } = {}) {
  return {
    update(snapshot) {
      return null;
    },
  };
}
