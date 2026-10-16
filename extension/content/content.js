// Content script on the Copilot page. Classic script (content scripts can't be modules), so the logic is
// loaded with dynamic import. Watches the newest reply, reports completed ones, pastes results on request.
(async () => {
  const adapter = await import(chrome.runtime.getURL('content/copilot-adapter.js'));
  const { createCompletionDetector } = await import(chrome.runtime.getURL('lib/completion.js'));

  const detector = createCompletionDetector({ stableMs: 1500 });
  const sawStreaming = new Set();  // replies we watched being written; older replies are never acted on
  let lastStatus = null;
  let lastTurnIndex = latestTurnIndex();
  let ownTurnsExpected = 0;        // turns we started by pasting (results, bootstrap)

  const send = msg => chrome.runtime.sendMessage(msg).catch(() => {});  // service worker may be restarting
  send({ type: 'content-ready' });

  function latestTurnIndex() {
    const turns = document.querySelectorAll(adapter.SELECTORS.turn);
    const last = turns[turns.length - 1];
    return last ? Number(last.getAttribute('data-message-index')) : -1;
  }

  function setStatus(status) {
    if (status === lastStatus) return;
    lastStatus = status;
    send({ type: 'page-status', status });
  }

  function tick() {
    if (adapter.hasSecurityCheck(document)) setStatus('security-check');
    else if (!adapter.checkPage(document).ok) setStatus('selector-broken');
    else setStatus('page-ok');

    // A new turn we didn't paste means the user typed: the run of automatic turns is over.
    const turnIndex = latestTurnIndex();
    if (turnIndex > lastTurnIndex) {
      if (ownTurnsExpected > 0) ownTurnsExpected--;
      else send({ type: 'user-turn' });
      lastTurnIndex = turnIndex;
    }

    const reply = adapter.readLatestReply(document);
    if (!reply) return;
    if (reply.busy) sawStreaming.add(reply.messageId);
    const done = detector.update({ ...reply, at: Date.now() });
    if (!done || !sawStreaming.has(done.messageId)) return;
    if (reply.incomplete) {
      setStatus('reply-incomplete');  // a long code block isn't fully rendered; scroll it into view
      return;
    }
    send({ type: 'reply', conversation: location.pathname, messageId: done.messageId, text: done.text });
  }

  setInterval(tick, 500);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'inject') return;
    ownTurnsExpected++;
    adapter.injectAndSend(document, msg.text).then(outcome => {
      if (!outcome.ok) ownTurnsExpected--;
      sendResponse(outcome);
    });
    return true;  // async response
  });
})();
