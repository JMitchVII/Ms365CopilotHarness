# W365 Copilot Harness — Implementation Plan & Test Backlog

## Context
The only approved LLM is M365 Copilot (web chat in Chrome). It can write code but has no tool use. We'll build a
rudimentary agentic harness around it:

- **Prompt** that teaches Copilot a strict tool-call protocol.
- **Chrome MV3 extension** that reads Copilot's replies from the page, extracts tool calls, applies an approval
  policy, sends them to a local agent, and pastes results back into the chat as the next turn.
- **PowerShell agent** that executes tool calls inside a confined workspace folder and returns results.
- Two transports, behind one interface: **Native Messaging first**, then **shared-folder file transport**.

The project is greenfield (only the notes file exists). Work is strict TDD: one failing test → make it green → next.

### Decisions (from you)
- Chrome, unpacked extension allowed.
- Native messaging first; file transport second, both full first-class.
- Node unit tests preferred (`node:test` + `node:assert`, zero deps); Pester 5 for PowerShell code.
- Approval mode switchable in the panel: **Fully auto / Tiered / Approve everything**.

---

## Architecture

```
Copilot page (DOM) ──content script──► service worker (router, policy, ledger) ──transport──► PowerShell agent
       ▲   reads ```w365 blocks           │  approvals / ask_user via side panel     native host (stdin/stdout)
       └── pastes ```w365-result ─────────┘                                         or file loop (inbox/outbox)
```

### Repo layout
```
prompt/copilot-instructions.md        # custom instructions given to Copilot
protocol/
  tools.json                          # single source of truth: tool names, args, tier (read|write|exec|ui)
  fixtures/                           # shared JSON + sample Copilot replies; used by BOTH Node and Pester tests
extension/
  manifest.json                       # MV3, nativeMessaging, sidePanel, storage, host perms for Copilot URL(s)
  lib/        protocol.js parser.js policy.js ledger.js formatter.js completion.js router.js  (pure ES modules)
  transport/  native.js file.js transport.js (common interface: send(call) -> Promise<result>, status events)
  content/    copilot-adapter.js (DOM selectors, isolated) content.js
  background.js  panel/ (panel.html, panel.js)
  test-pages/fake-copilot.html        # stand-in Copilot page for e2e
agent/
  W365Agent.psm1                      # pure functions: framing, dispatch, tools, path guard
  host.ps1  host.bat                  # native messaging entry (bat: powershell -NoProfile -ExecutionPolicy Bypass -File)
  file-loop.ps1                       # file transport loop
  install-host.ps1 / uninstall-host.ps1  # writes host manifest + HKCU\Software\Google\Chrome\NativeMessagingHosts key
tests/node/*.test.mjs   tests/pester/*.Tests.ps1
```

### Protocol (v1)
- **Copilot → harness**: fenced block in its reply, one or more per message, executed in order:
  ````
  ```w365
  {"id":"t7","tool":"read_file","args":{"path":"src/app.ps1","offset":1,"limit":200}}
  ```
  ````
- **Harness → Copilot**: one pasted message containing a ```` ```w365-result ```` block per call:
  `{"id":"t7","ok":true,"data":{...},"truncated":false}` or `{"id":"t7","ok":false,"error":{"code":"E_NOT_FOUND","message":"..."}}`
- **Extension ↔ agent envelope**: `{v:1, kind:"hello"|"call"|"result"|"cancel", id, tool, args, ...}`; `hello` returns
  version, workspace root, tool list.
- **Tools** (tier): `list_dir`(read) `read_file`(read, offset/limit) `search`(read, Select-String) `write_file`(write)
  `edit_file`(write, exact unique string replace) `run_ps`(exec, timeout, separate child process) `ask_user`(ui, never
  sent to agent) `task_done`(ui).
- **Error codes**: E_PARSE E_UNKNOWN_TOOL E_BAD_ARGS E_PATH_ESCAPE E_NOT_FOUND E_EDIT_NO_MATCH E_EDIT_AMBIGUOUS
  E_TIMEOUT E_TOO_LARGE E_DENIED E_TRANSPORT.
- **Limits**: result text pasted to Copilot capped (default 12,000 chars, configurable) with a "truncated — use
  offset" hint; agent → Chrome native message capped below 1 MB.

### Safety rails
- Agent is authoritative on **workspace confinement** (resolve full path, reject `..`, absolute paths outside root,
  symlink/junction escape).
- Ledger keyed by `conversationUrl + id` → a call never executes twice despite DOM re-scans.
- Only blocks inside **Copilot's** messages are honoured (never our pasted results or the user's own text).
- Loop guard: max consecutive auto-turns (default 25) + a **Stop** button (kill switch) in the panel.

---

## Build order (vertical slice first, then widen)

| Phase | Deliverable | Test suite |
|---|---|---|
| 0 | **Feasibility spike** (manual, not TDD): unpacked ext loads in Chrome; HKCU native host key works; `-ExecutionPolicy Bypass` allowed; content script can read a Copilot reply + write to input box. Capture 3–5 real Copilot reply HTML snippets into `protocol/fixtures/`. | — |
| 1 | Protocol schema + parser + formatter | Node: PR, FM |
| 2 | Agent core: path guard, tools, dispatcher | Pester: PG, AT, AD |
| 3 | Native framing + host + installer | Pester: NF, NH, IN; Node: NI |
| 4 | Extension core: policy, ledger, router, native transport | Node: PO, LG, RT, TN |
| 5 | Content script: completion detection, adapter, injection | Node: CD, CA |
| 6 | Side panel: mode switch, approvals, ask_user, log, stop | Node: PN |
| 7 | Prompt + conformance | Node: PM |
| 8 | File transport (both sides) | Pester: FL; Node: TF |
| 9 | End-to-end: fake Copilot page, then real Copilot | E2E checklist |

Rule: write **one** test, run, see it fail for the right reason, make it pass with minimal code, refactor, commit. Then
next ID. IDs are ordered so each test builds on the previous.

---

## Test backlog

### 1. Protocol & parser — Node (`tests/node/parser.test.mjs`, `protocol.test.mjs`)
- PR-01 `tools.json` loads and every tool has name, tier, args schema.
- PR-02 `parseReply("")` returns `{calls:[], errors:[]}`.
- PR-03 Plain prose with no fences → no calls.
- PR-04 Single ```` ```w365 ```` block with valid JSON → one call `{id, tool, args}`.
- PR-05 Other fenced languages (```` ```powershell ````) are ignored.
- PR-06 Two w365 blocks → two calls, document order preserved.
- PR-07 Invalid JSON in block → no call, error `E_PARSE` carrying the block index.
- PR-08 Missing `id` → `E_BAD_ARGS`.
- PR-09 Unknown tool → `E_UNKNOWN_TOOL`.
- PR-10 Missing required arg (e.g. `read_file` without `path`) → `E_BAD_ARGS` naming the arg.
- PR-11 Wrong arg type → `E_BAD_ARGS`.
- PR-12 Duplicate ids in one reply → second flagged `E_BAD_ARGS`.
- PR-13 Tolerates Copilot quirks: CRLF, trailing whitespace, `w365` fence with 4 backticks, smart quotes around keys
  (normalised) — driven from fixtures.
- PR-14 ```` ```w365-result ```` blocks are never parsed as calls.
- PR-15 Every fixture in `protocol/fixtures/replies/*.json` parses to its `expected` output (golden tests from real
  Copilot captures).
- FM-01 `formatResult(ok)` produces a ```` ```w365-result ```` block with compact JSON.
- FM-02 `formatResult(error)` includes code + message.
- FM-03 Multiple results → one message, order matches calls.
- FM-04 Output over cap is truncated, `truncated:true`, hint text present, total length ≤ cap.
- FM-05 Content containing triple backticks is escaped so it can't close the fence.
- FM-06 `formatUserAnswer(text)` for ask_user replies.

### 2. Agent core — Pester (`tests/pester/PathGuard.Tests.ps1`, `Tools.Tests.ps1`, `Dispatch.Tests.ps1`)
Each test uses a fresh `$TestDrive` workspace.
- PG-01 `Resolve-WorkspacePath 'a.txt'` → full path under root.
- PG-02 Nested relative path resolves correctly.
- PG-03 `..\outside.txt` → throws `E_PATH_ESCAPE`.
- PG-04 Absolute path outside root → `E_PATH_ESCAPE`.
- PG-05 Absolute path inside root → allowed.
- PG-06 Root-prefix trick (`C:\ws` vs `C:\ws-evil`) → `E_PATH_ESCAPE`.
- PG-07 Junction inside root pointing outside → `E_PATH_ESCAPE`.
- PG-08 Forward slashes accepted and normalised.
- AT-01 `list_dir` returns names + type + size, sorted.
- AT-02 `list_dir` on missing dir → `E_NOT_FOUND`.
- AT-03 `read_file` returns content with line numbers.
- AT-04 `read_file` offset/limit returns that slice and `totalLines`.
- AT-05 `read_file` missing → `E_NOT_FOUND`.
- AT-06 `read_file` preserves UTF-8 (non-ASCII round trip).
- AT-07 `write_file` creates file and parent dirs.
- AT-08 `write_file` overwrites and writes UTF-8 **without BOM**, preserving the supplied line endings.
- AT-09 `edit_file` replaces a unique match.
- AT-10 `edit_file` no match → `E_EDIT_NO_MATCH`, file unchanged.
- AT-11 `edit_file` multiple matches → `E_EDIT_AMBIGUOUS` (unless `replaceAll:true`), file unchanged.
- AT-12 `search` returns file/line/text for a regex, scoped to root.
- AT-13 `search` respects a glob filter and a max-results cap.
- AT-14 `run_ps` returns stdout, stderr, exitCode.
- AT-15 `run_ps` runs with cwd = workspace root.
- AT-16 `run_ps` exceeding timeout is killed → `E_TIMEOUT`, process gone.
- AT-17 `run_ps` output over cap → truncated flag.
- AD-01 `Invoke-W365Call` routes `{tool:'read_file'}` to the read tool, returns `{ok:true,data}`.
- AD-02 Unknown tool → `{ok:false, error.code:'E_UNKNOWN_TOOL'}`.
- AD-03 Any thrown exception becomes `{ok:false}` — dispatcher never throws.
- AD-04 Result always echoes the call `id`.
- AD-05 `hello` returns version, root, tool list matching `protocol/tools.json` (contract test).
- AD-06 Shared fixtures `protocol/fixtures/calls/*.json` → expected result shapes (cross-language contract).

### 3. Native messaging host — Pester + Node
Pester (`NativeFraming.Tests.ps1`, `Host.Tests.ps1`, `Install.Tests.ps1`), using MemoryStreams:
- NF-01 `Read-NativeMessage` reads 4-byte little-endian length + UTF-8 JSON.
- NF-02 Handles a message split across multiple stream reads.
- NF-03 Returns `$null` on clean EOF (Chrome closed the port).
- NF-04 Truncated body → throws framing error.
- NF-05 `Write-NativeMessage` writes correct length prefix; round-trips with NF-01.
- NF-06 Non-ASCII payload: length counts bytes, not chars.
- NF-07 Outgoing message > ~1 MB is truncated/rejected with `E_TOO_LARGE` instead of being sent.
- NH-01 Host loop: one framed call in → one framed result out, then exits on EOF.
- NH-02 Several calls in sequence → results in order.
- NH-03 **Nothing but framed messages reaches stdout** (Write-Host/Write-Output/verbose/progress suppressed; `run_ps`
  output can't leak).
- NH-04 Malformed JSON frame → error result, loop continues.
- NH-05 Errors are logged to `agent/logs/host.log`, not stdout.
- IN-01 `install-host.ps1 -WhatIf`-style function produces a host manifest with name, absolute bat path,
  `type:"stdio"`, `allowed_origins:["chrome-extension://<id>/"]`.
- IN-02 Writes the HKCU registry value (tested against a mocked `Set-ItemProperty` / temp hive path).
- IN-03 Uninstall removes key and manifest.

Node integration (`tests/node/native-host.int.test.mjs`) — spawns real `host.bat` like Chrome does:
- NI-01 `hello` round-trip over real stdin/stdout framing.
- NI-02 `read_file` on a temp workspace round-trips.
- NI-03 `run_ps` that prints lots of text does not corrupt framing.
- NI-04 Closing stdin makes the host exit within 2 s.

### 4. Extension core — Node (`policy`, `ledger`, `router`, `transport-native` tests; hand-rolled `chrome.*` fake)
- PO-01 Mode `fullAuto`: every tier → `run`.
- PO-02 Mode `approveAll`: every agent tier → `ask`.
- PO-03 Mode `tiered`: `read` → `run`; `write` and `exec` → `ask`.
- PO-04 `ui` tools (`ask_user`, `task_done`) are never sent to the agent in any mode.
- PO-05 Unknown mode falls back to `approveAll` (fail safe).
- PO-06 Mode persists via `chrome.storage.local` and defaults to `tiered`.
- LG-01 New `(conversation,id)` → not seen; after `markDone` → seen.
- LG-02 Same id in a different conversation is independent.
- LG-03 Ledger survives service-worker restart (backed by `chrome.storage.session`).
- RT-01 Router given a reply with one read call (tiered) → sends to transport, returns formatted result message.
- RT-02 Write call in tiered → emits approval request; nothing sent until approved.
- RT-03 Denied approval → `E_DENIED` result returned to Copilot (so it can adapt).
- RT-04 Multiple calls execute sequentially; results batched into one message.
- RT-05 Already-ledgered call is skipped.
- RT-06 Parse errors are reported back to Copilot as results (no transport call).
- RT-07 `ask_user` pauses the turn until the panel supplies an answer; answer is included in reply.
- RT-08 `task_done` stops auto-continuation and notifies panel.
- RT-09 Loop guard: after N consecutive auto turns, router pauses and asks user.
- RT-10 Stop/kill switch cancels pending approvals and in-flight call (`cancel` envelope).
- RT-11 Transport error → `E_TRANSPORT` result + panel status shows disconnected.
- TN-01 Native transport connects via `connectNative('com.w365.harness')` and sends `hello` on connect.
- TN-02 `send(call)` resolves when a result with matching id arrives.
- TN-03 Out-of-order results resolve the correct promises.
- TN-04 Per-call timeout rejects with `E_TIMEOUT`.
- TN-05 `onDisconnect` rejects all pending and reports `lastError` message.
- TN-06 Reconnect on next `send` after disconnect.

### 5. Content script — Node
Keep DOM-touching code tiny; logic is pure and fed by snapshots.
- CD-01 Completion detector: text still changing → not complete.
- CD-02 Text stable for the debounce window **and** "stop generating" indicator absent → complete, emitted once.
- CD-03 Indicator still present → not complete even if text is stable.
- CD-04 A new Copilot message after completion starts a fresh detection cycle.
- CD-05 Our own pasted messages (user role) never trigger.
- CA-01 Adapter extracts last assistant message text from captured Copilot HTML fixture (uses `node:test` + a
  minimal HTML fixture parsed via the adapter's injected `querySelector` function — no jsdom needed; if fixtures get
  too complex we add jsdom as the only dev dependency).
- CA-02 Adapter reads code-block contents *including the fence language* from Copilot's rendered code blocks
  (Copilot renders fences as `<pre><code class=…>`, not raw backticks — the adapter must reconstruct them).
- CA-03 Adapter returns `null` cleanly when selectors don't match (layout changed) and reports a "selector broken"
  status rather than throwing.
- CA-04 Injector: sets input text, dispatches `input` event, clicks send — verified against a fake element API.
- CA-05 Injector refuses to send while Copilot is still generating.
- CA-06 Selectors live in one config object; a test asserts all required keys exist.

### 6. Side panel — Node (logic in `panel/state.js`, view kept dumb)
- PN-01 Mode switcher reflects stored mode and writes changes.
- PN-02 Approval queue shows tool, args, tier; Approve/Deny resolve the router request.
- PN-03 "Approve all for this turn" resolves all pending.
- PN-04 `ask_user` renders question; submit sends answer.
- PN-05 Transport status (connected / disconnected / selector broken) updates from background events.
- PN-06 Activity log appends call + result summary, capped length.
- PN-07 Stop button sends kill-switch message.
- PN-08 Transport selector (Native / File) persists choice.

### 7. Prompt — Node (`prompt.test.mjs`) + manual conformance
- PM-01 Every tool in `tools.json` is documented in `copilot-instructions.md` (name + required args).
- PM-02 Prompt contains a worked example for each tool that parses cleanly with `parseReply` (examples stay valid).
- PM-03 Prompt states the rules: one fenced `w365` block per call, unique ids, wait for results, use `ask_user` for
  questions/ambiguity/destructive intent, end with `task_done`.
- PM-04 Prompt length fits Copilot's custom-instructions limit (configurable constant; measure in Phase 0).
- Manual conformance: run 5 scripted scenarios against real Copilot (read+summarise, create file, edit file, run
  tests, ask a clarifying question); save replies as fixtures → they become PR-15 golden tests.

### 8. File transport — Pester + Node
Layout: `<shared>/inbox/<id>.json` (ext → agent), `<shared>/outbox/<id>.json` (agent → ext), atomic via temp+rename.
- FL-01 Loop picks up `inbox/*.json`, writes `outbox/<id>.json`, removes/archives the inbox file.
- FL-02 Ignores `*.tmp` and partially-written files.
- FL-03 Writes outbox atomically (`.tmp` then `Move-Item`).
- FL-04 Processes multiple inbox files in id/creation order.
- FL-05 Corrupt inbox file → error result in outbox, loop continues.
- FL-06 Heartbeat file updated every N s (extension uses it for "agent alive" status).
- FL-07 Clean shutdown on a `stop` sentinel file.
- TF-01 File transport implements the same interface as native (shared transport contract test run against both).
- TF-02 `send` writes inbox file via a fake FileSystemDirectoryHandle.
- TF-03 Polls outbox and resolves on matching id; deletes outbox file after read.
- TF-04 Timeout → `E_TIMEOUT`.
- TF-05 Stale heartbeat → status `disconnected`.
- TF-06 Directory handle persisted in IndexedDB; permission re-request flagged when `queryPermission` ≠ granted
  (FS Access API needs a user gesture, so the file transport runs in the panel/offscreen page, not the service worker).

### 9. End-to-end
- E2E-01 Fake Copilot page (`test-pages/fake-copilot.html`) scripted to emit a read call → result pasted back. **Passed 2026-10-16.**
- E2E-02 Same with write call in tiered mode → approval → file created on disk. **Passed 2026-10-16.**
- E2E-03 Same flows over file transport. **On hold (2026-10-16):** the user dropped the use case; code and unit tests stay.
- E2E-04 Real Copilot, tiered: "list the workspace and summarise README" completes with no manual typing. **Passed 2026-10-16.**
- E2E-05 Real Copilot: create a script + Pester test, run it via `run_ps`, iterate until green, `task_done`. **Passed 2026-10-16.**

---

## Verification
- `node --test tests/node` → all Node suites (unit + NI integration).
- `Invoke-Pester tests/pester -Output Detailed` → all PowerShell suites.
- Phase gates: a phase is done when its suite is fully green **and** the previous suites still pass.
- E2E: load unpacked `extension/`, run `agent/install-host.ps1 -ExtensionId <id>`, open the fake page, then real
  Copilot, and walk E2E-01..05.

## Phase 0 findings (2026-10-16)
- Chrome: Load unpacked is available. Copilot URL: `https://m365.cloud.microsoft/chat/` → manifest host permission
  `https://m365.cloud.microsoft/*`.
- ExecutionPolicy: **MachinePolicy = RemoteSigned** (Group Policy). GPO beats `-ExecutionPolicy Bypass`, so the flag in
  `host.bat` is ignored. Locally created scripts run fine; anything downloaded/zipped must be `Unblock-File`d. `run_ps`
  uses `-Command`/`-EncodedCommand` (not a .ps1 file), which this policy doesn't block. New test: **IN-04** installer
  checks for Zone.Identifier (Mark of the Web) on agent scripts and warns.
- Custom instructions: treat **4,000 chars** as the hard cap (PM-04). The full protocol goes in a **bootstrap message**
  the extension pastes at the start of a session; the custom instructions only hold the core rules + "wait for the
  bootstrap". New tests: **PM-05** bootstrap contains the full tool reference; **PM-06** core instructions ≤ 4,000.
- Code block DOM (`protocol/fixtures/dom/codeblock-html-preview.html`):
  - Container: `.scriptor-component-code-block`. Language label: `[data-testid="one-copilot-code-identity"] span`
    (shows a display name, e.g. "HTML", not the raw fence tag).
  - Lines: `[data-line-index]` in order; empty lines are `data-line-empty="true"` holding `&nbsp;` → become `""`.
  - Most class names are hashed and will change → selectors use only `data-*`, `role`, `aria-*` and `scriptor-*`.
  - Block is **virtualized** (`scriptor-codeblock-virtualized`): long blocks may not have every line in the DOM.
  - Copilot **mangled content** in the sample (line 4: a `<script src=…>` tag became a bare URL). Content passed
    through chat isn't guaranteed to arrive intact.
- Design changes from this:
  - Don't rely on the fence language label. Identify a call by its **JSON content**: an object with `"w365":1`.
    New parser tests **PR-16** (call found inside a block labelled anything, e.g. "JSON"/"Plain Text") and **PR-17**
    (JSON without the `w365` marker is ignored).
  - CA-02 changes to "rebuild text from `[data-line-index]` rows, sorted by index, `&nbsp;` lines → empty".
    New **CA-07**: if line indexes have gaps (virtualization), report `incomplete` instead of parsing.
  - New **AT-18**: `write_file`/`edit_file` accept an optional `expectLines` (line count of the content); on mismatch
    return `E_CONTENT_MISMATCH` so Copilot resends. (A rough check for mangling. Copilot can't compute hashes, but it
    can count lines.)
- Full page DOM (`protocol/fixtures/dom/chat-page-streaming.html`, sanitised):
  - Turn: `[data-testid="m365-chat-llm-web-ui-chat-message"][data-message-index]`, wrapped in a virtualizer row
    (`[data-virtualizer-index]`) inside `[role="feed"]`. Old turns can be unmounted → the ledger, not the DOM, is the
    record of what ran.
  - User text: `[data-testid="chatQuestion"] [data-testid="chatOutput"]`. Copilot reply:
    `[data-testid="copilot-message-div"] [data-testid="markdown-reply"][data-message-id]`.
  - **Streaming signals** (CD tests): reply `.fai-CopilotMessage[aria-busy="true"]`, `markdown-reply[aria-hidden="true"]`,
    and the send button reads `aria-label="Stop generating"`. Done = no aria-busy + not hidden + button no longer
    "Stop generating". `data-message-id` is a stable key for the ledger.
  - Input: `#m365-chat-editor-target-element` is a **Lexical** contenteditable. Setting `textContent` won't stick;
    inject via a synthetic paste (`ClipboardEvent` + `DataTransfer`) or `execCommand('insertText')`, then click the
    `.fai-SendButton`. CA-04 changes to "inject via paste event; editor text equals payload".
  - Some code blocks have a `#copy-button` (JSON), others a preview toggle (HTML) — don't rely on Copy.
  - A Cloudflare Turnstile "Security check required" dialog was present (consumer/free account). New **CA-08**:
    detect `[role="dialog"][aria-label="Security check required"]` → pause auto-mode and tell the user.
  - This capture is from a personal account; the work tenant may differ. Re-capture there before Phase 5.
- Still needed (later): what label Copilot shows on a block fenced as ```` ```w365 ````, and the send button's label
  when idle.

## Risks to check in Phase 0
- Copilot's DOM selectors and streaming indicator (most fragile part → isolated in adapter + config).
- Copilot's custom-instructions length limit and max input length per message (drives truncation cap).
- Whether Copilot reliably emits the exact fence language; parser tolerance (PR-13) may need tuning.
- Group policy on ExecutionPolicy / HKCU NativeMessagingHosts.

## Progress (2026-10-16)
Green: PR-01..17, FM-01..06 · PG-01..08, AT-01..18 · AD-01..06 · NF-01..07, NH-01..05, IN-01..04, NI-01..04 ·
PO-01..06, LG-01..03, RT-01..12, TN-01..07 · CD-01..05, CA-01..08 · PN-01..09 · PM-01..06 · FL-01..07, TF-01..06.
Added along the way: SY-01 (extension copies of tools.json/bootstrap stay in sync), WR-01..06 (service-worker
session wiring in `extension/lib/session.js`), MF-01..02 (manifest key → fixed extension id
`mibjgjdclpgkohlepnkfpemcddpbcjbb`), FK-01 (fake Copilot page is readable by the real adapter).

Decisions made while building:
- Pester 6.2 (newest on PSGallery) is used; the tests run unchanged on it. Root-level `BeforeEach` isn't allowed in 6.
- Calls are marked in the ledger *before* they run: a call never runs twice, at the cost of not retrying one that
  was interrupted.
- The content script only acts on replies it saw streaming, so reopening an old conversation never re-runs calls.
- File transport request files are named `<time>-<n>-<id>.json` (ids repeat across conversations).
- Cancel on native messaging closes the port (Chrome stops the host); a call already running in the agent can't
  be interrupted mid-way, and the host only notices the closed port once that call ends (up to its timeout).

Not yet verified (needs a real browser): E2E-01..05. Chrome-only pieces with no unit tests: `background.js`,
`content/content.js`, `panel/panel.js`, `transport/idb-kv.js`, the real `ClipboardEvent` paste into Lexical.
Open questions: the label Copilot shows for a json-fenced block, the idle send button's aria-label, and the
work-tenant DOM (fixtures so far come from a personal account).
