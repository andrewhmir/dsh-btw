# Verification — @andrewhmir/dsh-btw

Evidence for the community release. Every row below was produced by running the
named script against a home created from scratch; none of it is inferred from
reading the code.

## What "clean room" means here

The home is built by `test/e2e/clean-room.ps1` from nothing: the profile declares
only `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and this plugin. No
company profile, no mirror copy, and no other third-party plugin is present. That
is what a community user gets, so it is the only install this evidence trusts.

The script also closes the two first-run differences such a home exposes:

1. a fresh profile has no workspace, so the GUI opens on "Choose workspace" — the
   script seeds `storages/workspace.json` with one workspace, as the onboarding
   would;
2. the GUI then shows a "Preview Notice" modal whose `<h2>` holds focus, which
   makes `editor.focus()` a no-op and every synthetic keystroke go to the dialog.
   `test/e2e/first-run.mjs` clicks its primary button and proves the composer then
   accepts text.

## Environment

| | |
|---|---|
| Harness | `@deepseek-ai/dsh` **0.2.1-rc.2** (npm `next`), scratch install |
| Install prefix | `.harness-check/prefix-021` |
| Home | `.harness-check/home-clean-1b` (created by `clean-room.ps1`) |
| Plugin spec | local package directory (junction-linked) |
| Composed bundles | `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@andrewhmir/dsh-btw` |
| Composed tree | 198 packages, all `@deepseek-ai/*`; zero matches for any company plugin or MCP row |
| Browser | Chrome 155.0.8059.80, headless, DevTools protocol on port 9222, fresh profile |
| Tree under test | `2c8f062` (rename `de8c373`, tooling `ee0bd60`, syntax fix `2c8f062`) |

## Results — DSH 0.2.1-rc.2

| Assertion | Command | Observed |
|---|---|---|
| Composition | `clean-room.ps1` | exit 0, 1232 lines; `- id: btw` resolves to `@andrewhmir/dsh-btw`; zero `not found` / `unknown key` / `cannot resolve` / `did not activate` lines |
| Host route registered | `clean-room.ps1` | `GET /btw/ask → 405` |
| First run unblocked | `first-run.mjs` | `{"dialogFound": true, "dialogDismissed": true, "composerAcceptsText": true}` |
| First run is idempotent | `first-run.mjs` again | `{"dialogFound": false, "dialogDismissed": true, "composerAcceptsText": true}` |
| Side question answers | `cdp-e2e.mjs --mode probe` | `sideQuestion.status: "done"`, 184-character answer |
| Full suite of UI assertions | `cdp-e2e.mjs --mode full` | `firstStatus: "done"`, `upperCaseWorks: true`, `markdownRendered: true`, `secondStatus: "done"`, `cacheReadTokens: 1664`, `pageErrors: []` |
| Dismissal by key | `cdp-e2e.mjs --mode dismiss-keys` | `Escape`, `Space`, `Enter` all `dismissed` |
| Works during a streaming main turn | `cdp-e2e.mjs --mode mid-stream` | `sawMainTurnRunning: true`; **4/4** attempts `done`; `sideAnswerChars: 384`; main turn finished; no overlay left open |
| Unit suite | `node --test "test/*.test.mjs"` | 66/66 pass |
| Client bundle current | `node tools/build-client.mjs --check` | `client.js is up to date` |

## Ephemerality

The load-bearing property is that a `/btw` exchange never reaches the session
log. `test/e2e/ephemerality-check.mjs` decodes every zstd session log in the home
and classifies each marker hit by event type: an **answer** excerpt fails in any
event type, and a **question** marker fails only in `user/message`,
`command/run`, or `command/done`.

Four scans over all 3 session logs written by this run (`--since 0`, the whole
home): the `full` exchange with its real 60-character answer excerpt, plus
marker-only scans for the `probe`, `dismiss-keys`, and `mid-stream` exchanges.
**All four: PASS — zero failures, zero marker hits of any kind.**

A scan that cannot see persisted text proves nothing, so the same scanner was run
as a control against text the main turn legitimately persisted:

| Control | Expected | Observed |
|---|---|---|
| `Start-Sleep` (mid-stream user prompt) | detected | 1 `user/message` hit (seq 8) |
| `third planet` (warm-up user prompt) | detected | 1 `user/message` hit (seq 8) |
| `NEVER-PERSISTED-STRING-XYZ` | not found | no hits |

## Defect found during this verification

The rename exposed a gap: `cdp-e2e.mjs` interpolated the package name with
backticks *inside* an existing template literal, so the file stopped parsing —
and the unit suite stayed green because nothing parsed the E2E scripts. Fixed in
`2c8f062`, with `test/e2e-syntax.test.mjs` added so the suite now `node --check`s
every script under `test/e2e/`.

## How to reproduce

```powershell
# 1. Build a fresh home containing only the official bundles plus the plugin.
powershell -NoProfile -ExecutionPolicy Bypass -File dsh-btw\test\e2e\clean-room.ps1 `
  -PackageSpec C:\path\to\dsh-btw `
  -HomeDir C:\path\to\fresh-home `
  -CliPrefix C:\path\to\scratch-prefix `
  -Port 3166 -KeepRunning

# 2. Start headless Chrome with a DevTools port (fresh profile to see first run).
Start-Process 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList @(
  '--headless=new', '--remote-debugging-port=9222',
  '--user-data-dir=C:\path\to\chrome-profile', '--no-first-run', 'about:blank')

# 3. Dismiss the first-run notice and prove the composer takes text.
node dsh-btw\test\e2e\first-run.mjs --port 9222 --url "<URL printed by step 1>"

# 4. Run the UI assertions.
node dsh-btw\test\e2e\cdp-e2e.mjs --port 9222 --url "<URL>" --mode probe
node dsh-btw\test\e2e\cdp-e2e.mjs --port 9222 --url "<URL>" --mode full --question-marker BTW-REL-FULL-1019
node dsh-btw\test\e2e\cdp-e2e.mjs --port 9222 --url "<URL>" --mode dismiss-keys
node dsh-btw\test\e2e\cdp-e2e.mjs --port 9222 --url "<URL>" --mode mid-stream --question-marker BTW-REL-MID-1019

# 5. Assert ephemerality (exit 0 = PASS), then the sensitivity control.
node dsh-btw\test\e2e\ephemerality-check.mjs --home <fresh-home> --since 0 `
  --question-marker BTW-REL-FULL-1019 --answer-excerpt "<60 chars of the real answer>"
node dsh-btw\test\e2e\ephemerality-check.mjs --home <fresh-home> --since 0 `
  --question-marker Start-Sleep --answer-excerpt "NEVER-PERSISTED-STRING-XYZ"
# expect the second command to FAIL: it proves the scanner sees persisted prompts
```

## Windows sandbox notes

These are properties of a confined DSH session on Windows, not of the plugin.
Each one was hit while producing the evidence above:

- **Chrome cannot be spawned from the confined sandbox** (`spawn EPERM`), so the
  browser steps need an unconfined session.
- **`node --test` spawns a child process per test file** and fails with `spawn
  EPERM` under the same confinement; run the suite unconfined.
- **The shell tool fails with `SetNamedSecurityInfoW (Win32 5)`** when the server
  itself runs confined, so the `mid-stream` mode (whose main turn runs a shell
  command) needs an unconfined server.
- **`Get-NetTCPConnection` cannot see listeners owned by another job**, so
  readiness is always an HTTP probe, never a socket-table check.
