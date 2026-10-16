# W365 Copilot Harness

Lets M365 Copilot (web chat in Chrome) work on files through tool calls. A Chrome extension reads Copilot's
replies, applies your approval setting, runs the calls through a local PowerShell agent, and pastes the
results back. See `PLAN.md` for the design and the test backlog.

```
prompt/      custom instructions (you paste) and the bootstrap (the extension pastes)
protocol/    tools.json (single source of truth) and shared test fixtures
extension/   Chrome MV3 extension (load this folder unpacked)
agent/       PowerShell agent: native messaging host, file-transport loop, installer
tests/       node:test suites (tests/node) and Pester suites (tests/pester)
```

## Tests

```powershell
npm install                                   # dev dependency: jsdom (adapter tests)
npm test                                      # Node suites, including real host.bat integration tests
powershell -NoProfile -File tests\run-pester.ps1   # Pester 5+ suites
```

After editing `protocol/tools.json` or `prompt/bootstrap.md`, run `npm run sync` (a test fails until you do).

## Set up

1. **Load the extension**: `chrome://extensions` → Developer mode → Load unpacked → pick the `extension` folder.
   The ID should be `mibjgjdclpgkohlepnkfpemcddpbcjbb` (fixed by the manifest key).
2. **Register the agent** (current user only, no admin):
   ```powershell
   powershell -NoProfile -File agent\install-host.ps1 -ExtensionId mibjgjdclpgkohlepnkfpemcddpbcjbb -WorkspaceRoot C:\path\to\workspace
   ```
   The agent can only touch files inside the workspace folder. If the installer warns about blocked files,
   run the `Unblock-File` line it prints. Undo with `agent\uninstall-host.ps1`.
3. **Custom instructions**: paste `prompt/copilot-instructions.md` into Copilot's custom instructions.
4. Pin the extension (puzzle-piece icon → pin), then click its toolbar icon to open the side panel. Choose an
   approval mode. Reload any Copilot tab that was open before the extension was loaded or reloaded, or the panel
   shows `tab-unreachable`.

## Use

Open Copilot, click **Start session** in the panel (pastes the bootstrap), then ask for what you want. Calls
that need approval appear in the panel. **Stop** abandons the current turn.

### Shared-folder transport (instead of native messaging)

```powershell
powershell -NoProfile -File agent\file-loop.ps1 -SharedDir C:\w365-shared
```
In the panel: Transport → Shared folder → Choose shared folder (the same folder). Create `C:\w365-shared\stop`
to end the loop.

## End-to-end check with the fake Copilot page

```powershell
npm run fake-copilot
```
Open `http://127.0.0.1:8365/fake-copilot.html?script=read`, open the side panel, set **Tiered**, click
**Start session**. Expected: the bootstrap is pasted, the fake reply's `list_dir` runs, the `write_file` asks
for approval, and after you approve, `e2e-note.txt` appears in the workspace and the panel shows "Task done".
Use `?script=write` for the approval-only flow.

## Logs

`agent\logs\host.log` (native host) and `agent\logs\file-loop.log` (file transport).
