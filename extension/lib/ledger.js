// Remembers which calls have already run, so DOM re-scans never execute a call twice.
// Backed by chrome.storage.session so it survives the service worker being stopped and restarted.

const keyFor = conversation => `ledger:${conversation}`;

export function createLedger(storage) {
  async function ids(conversation) {
    const key = keyFor(conversation);
    const { [key]: list = [] } = await storage.get(key);
    return list;
  }
  return {
    async has(conversation, id) {
      return (await ids(conversation)).includes(id);
    },
    async markDone(conversation, id) {
      const list = await ids(conversation);
      if (!list.includes(id)) await storage.set({ [keyFor(conversation)]: [...list, id] });
    },
  };
}
