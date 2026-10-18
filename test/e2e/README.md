# dsh-btw verification tooling (mirror + browser)

Not shipped in the published package (`files` excludes `test/`). These scripts
prove the plugin on a **mirror** harness home and assert its load-bearing
property: an ephemeral `/btw` exchange never reaches a session log.

Machine-specific paths below match this workspace
(`C:\Users\Andrew\Desktop\dsh_andrew`).

## 1. Build the 0.2.1 rehearsal mirror (once)

```powershell
cd C:\Users\Andrew\Desktop\dsh_andrew
powershell -NoProfile -ExecutionPolicy Bypass -File .harness-check\rehearse-021.ps1
```

This builds `.harness-check\home-021` and points it at the scratch 0.2.1-rc.2
install (`.harness-check\prefix-021`), composing and booting it once. It must
pass before the plugin-specific steps below.

## 2. Install the plugin into the mirror and boot it

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File dsh-btw\test\e2e\build-mirror-plugin.ps1 -KeepRunning
```

What it does: copies the live credential store into the mirror (a real provider
key is needed for streamed answers — without it the overlay only shows the
provider error), patches the mirror profile exactly as `plugin_manager` would
for a local bundle (`"dsh-btw": "link:C:/Users/Andrew/Desktop/dsh_andrew/dsh-btw"`
plus `dsh-btw` in `dsh.profile.bundles`), junctions the package into the mirror
`node_modules`, composes `--profile web --dump-config` (fails on any loader
complaint or missing `btw` row), cold-boots on port 3164, and asserts
`GET /btw/ask -> 405` (route exists, method refused). It writes
`.harness-check\btw-mirror-runtime.json` (pid, port, url, logs) and leaves the
server running.

The E2E scripts intentionally filter one environmental console error —
`[deepseek-account] account read failed` — because the mirror has an API key but
no browser account session. Any other page error fails the run.

## 3. Launch headless Chrome with a DevTools port

The scripts attach to an existing debug port; they never start or kill Chrome
(killing `chrome.exe` from a DSH-managed shell collides with the job runner).

```powershell
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
Start-Process -FilePath $chrome -ArgumentList @(
  '--headless=new', '--remote-debugging-port=9222',
  '--user-data-dir=C:\Users\Andrew\Desktop\dsh_andrew\.harness-check\chrome-profile-btw',
  '--no-first-run', 'about:blank')
```

Use the launch URL printed by step 2 (or read it from the boot log:
`Select-String -Path .harness-check\boot-btw-*.log -Pattern 'dsh web:\s+(http://\S+)'`).

## 4. Probe, then the real runs

```powershell
node dsh-btw\test\e2e\cdp-e2e.mjs --port 9222 --url "<launch url>" --mode probe
node dsh-btw\test\e2e\cdp-e2e.mjs --port 9222 --url "<launch url>" --mode full --question-marker "BTW-E2E-<stamp>"
node dsh-btw\test\e2e\cdp-e2e.mjs --port 9222 --url "<launch url>" --mode dismiss-keys
node dsh-btw\test\e2e\cdp-e2e.mjs --port 9222 --url "<launch url>" --mode mid-stream --question-marker "BTW-MID-<stamp>"
```

- `probe` reports the composer/overlay structure and attempts one side question;
  use it first if the GUI markup has drifted.
- `full` asserts the overlay appears, the answer streams, the question is shown,
  a second call reports `cacheReadTokens > 0`, and Escape closes it. It prints an
  `answerExcerpt` for the ephemerality check.
- `dismiss-keys` asserts Escape, Space, and Enter each dismiss the overlay.
- `mid-stream` starts a ~15 s main turn, asks `/btw` while it streams, waits for
  the answer, then waits for the main turn to finish (`TURN-DONE` in the
  transcript).

## 5. Assert ephemerality

Pick the `--since` timestamp from just before the E2E runs (epoch milliseconds)
and pass the `answerExcerpt` printed by `--mode full`:

```powershell
node dsh-btw\test\e2e\ephemerality-check.mjs `
  --home C:\Users\Andrew\Desktop\dsh_andrew\.harness-check\home-021 `
  --since <epochMs> `
  --question-marker "BTW-E2E-<stamp>" `
  --answer-excerpt "<the printed excerpt>"
```

It decodes every `session.v*.jsonl*` file under the home that was written since
`--since` (concatenated zstd frames, split on the magic) and fails if the marker
question, a distinguishing answer excerpt, or a `command/run` event named `btw`
appears. `EPHEMERALITY PASS` is the proof for the strict-parity requirement.

## 6. Shut down

Stop the mirror server (PID in `.harness-check\btw-mirror-runtime.json`) with
`Stop-Process -Id <pid>` only if you started it in that same command context;
otherwise close Chrome over CDP:

```powershell
node .harness-check\cdp-probe.mjs --port 9222 --url "about:blank" --close-browser
```
