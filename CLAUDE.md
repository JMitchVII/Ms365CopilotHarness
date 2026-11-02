# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An agentic harness around M365 Copilot web chat, which has no tool use of its own. Copilot is taught a tool-call
protocol (`prompt/`), a Chrome MV3 extension (`extension/`) reads its replies from the page, applies an approval
policy, sends calls to a local PowerShell agent (`agent/`), and pastes results back as the next chat turn.
`PLAN.md` holds the design, the test backlog (test IDs like `PR-04`, `AT-11`, `RT-09`) and the progress log;
read it before adding features.

## Commands

```powershell
npm install                                         # only dev dependency is jsdom
npm test                                            # all Node suites (node:test), incl. real host.bat integration tests
node --test tests/node/parser.test.mjs              # one Node suite
node --test --test-name-pattern "PR-13" tests/node/parser.test.mjs   # one Node test, by ID
powershell -NoProfile -File tests\run-pester.ps1    # all Pester suites (Pester 5.5+; 6.x is what's installed)
powershell -NoProfile -File tests\run-pester.ps1 -Path tests\pester\Tools.Tests.ps1   # one Pester suite
npm run sync                                        # copy protocol/tools.json + prompt/bootstrap.md into extension/generated/
npm run fake-copilot                                # serve extension/test-pages/fake-copilot.html on http://127.0.0.1:8365
```

There is no build or lint step: the extension is plain ES modules loaded unpacked from `extension/`.

## Working conventions

- Strict TDD against the `PLAN.md` backlog: one test, see it fail, make it pass, commit. Test names start with
  their ID (`test('PR-04 ...')`, `It 'AT-01 ...'`). New behaviour gets a new ID in `PLAN.md` and in the test.
- Commit messages are one line, prefixed with the test ID(s) they turn green (e.g. `CA-15/CA-16: ...`); plan-only
  updates use `PLAN: ...`.
- After editing `protocol/tools.json` or `prompt/bootstrap.md`, run `npm run sync`; test `SY-01` fails until you
  do. Never edit `extension/generated/` by hand. Chrome can only load files inside the extension folder.
- `prompt.test.mjs` (PM-*) checks that the bootstrap documents every tool in `tools.json` with parseable
  examples, and that `prompt/copilot-instructions.md` fits Copilot's custom-instructions length limit.
- `scratch/` (gitignored) is the workspace used for manual end-to-end runs.

## Architecture

```
Copilot page (DOM) --content script--> service worker (session -> router -> policy/ledger) --transport--> PowerShell agent
       ^  reads calls in replies             | approvals / ask_user via side panel                native host (stdin/stdout)
       +-- pastes w365-result blocks --------+                                                    or file loop (shared folder)
```

**Protocol.** `protocol/tools.json` is the single source of truth for tool names, args and tier
(`read`/`write`/`exec`/`ui`); both the extension and the agent (via the `hello` contract test) are checked against
it. A call is a JSON object containing `"w365":1` inside any code block in a Copilot reply. It's identified by
content, not by fence language, because Copilot relabels fences. Results go back as `w365-result` blocks.
`protocol/fixtures/` (calls, replies, captured DOM) is shared by Node and Pester tests as a cross-language contract.

**Extension: testable core vs chrome.\* shells.** Logic lives in `extension/lib/*.js` as pure modules with no
`chrome.*` calls. `lib/session.js` is the service-worker wiring (it takes injected transport, ledger, storage and
tab I/O). `background.js`, `content/content.js` and `panel/panel.js` are thin adapters that supply the chrome APIs
and have no unit tests. Node tests use the hand-rolled fake in `tests/node/helpers/chrome-fake.mjs`. Keep new
logic in `lib/` (or `panel/state.js` for panel logic) so it stays testable.
- `parser.js` reads calls from reply text, `formatter.js` builds result messages (truncation cap, fence escaping),
  `policy.js` maps approval mode (`fullAuto`/`tiered`/`approveAll`) and tier to run or ask (unknown mode falls
  back to `approveAll`), `ledger.js` dedupes by conversation and call id in `chrome.storage.session`,
  `router.js` runs one reply's calls in sequence (approvals, `ask_user`, `task_done`, loop guard, stop), and
  `completion.js` detects when a reply has finished streaming.
- `content/copilot-adapter.js` is the **only** file that knows Copilot's DOM. Selectors use `data-*`, `role`,
  `aria-*` and `fai-`/`scriptor-` classes, never hashed CSS classes. Code blocks are rebuilt from
  `[data-line-index]` rows (they're virtualized, so gaps mean `incomplete`). The input is a Lexical editor, so
  text is injected via a synthetic paste event. Adapter tests run under jsdom against `protocol/fixtures/dom/`.
- Content-script modules are classic scripts that dynamic-`import()` `web_accessible_resources`.
- Transports share one interface (`send(call) -> Promise<result>`, `cancel`, status events; see
  `transport-contract.test.mjs`). `transport/native.js` uses `connectNative('com.w365.harness')` from the service
  worker. `transport/file.js` needs the File System Access API, so it runs in the **side panel** and the service
  worker relays calls to it over the panel port.

**Safety invariants (tested; don't weaken).** The agent is authoritative on workspace confinement
(`Resolve-WorkspacePath` rejects `..`, outside absolute paths, root-prefix tricks and junction escapes). Calls are
marked in the ledger *before* they run, so a call never runs twice. The content script acts only on replies it saw
streaming, so reopening an old chat never re-runs calls. Only blocks inside Copilot's own messages are honoured.
`write_file`/`edit_file` take an optional `expectLines` check (`E_CONTENT_MISMATCH`) because Copilot sometimes
mangles content.

**Agent (PowerShell 5.1).** `agent/W365Agent.psm1` holds every function: path guard, tools
(`Invoke-W365*`), dispatcher `Invoke-W365Call` (never throws; errors become `{ok:false}`), native framing
(4-byte LE length + UTF-8 JSON, capped below Chrome's 1 MB) and both loops. Entry points are thin:
`host.bat` -> `host.ps1` (native messaging) and `file-loop.ps1` (shared-folder inbox/outbox; create `stop` in the
folder to end it). In `host.ps1`, **stdout is the message channel**: nothing but framed messages may reach it.
Log to `agent/logs/` instead (`W365_LOG`). The workspace root comes from `$env:W365_ROOT` or `agent/config.json`,
written by `install-host.ps1` (HKCU registration, no admin). Files the agent writes are UTF-8 without BOM, keeping
the supplied line endings.

## Manual setup and E2E

See `README.md`: load `extension/` unpacked (the manifest `key` pins the ID to `mibjgjdclpgkohlepnkfpemcddpbcjbb`),
run `agent\install-host.ps1 -ExtensionId ... -WorkspaceRoot ...`, then reload any open Copilot tab. The fake page
(`?script=read` / `?script=write`) exercises the full loop without Copilot. Anything touching the real Copilot DOM
or Chrome-only code needs a human in a real browser. `PLAN.md` lists which E2E checks are still open (for example
re-capturing DOM fixtures from the work tenant).
