// Remembers which calls have already run, so DOM re-scans never execute a call twice.

export function createLedger(storage) {
  const done = new Set();
  return {
    async has(conversation, id) { return done.has(`${conversation}\n${id}`); },
    async markDone(conversation, id) { done.add(`${conversation}\n${id}`); },
  };
}
