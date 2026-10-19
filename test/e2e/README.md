# Verification tooling

Not shipped in the published package (`files` excludes `test/`). These scripts
prove the plugin on a **fresh DSH home** and assert its load-bearing property: an
ephemeral `/btw` exchange never reaches a session log.

Results for the released version are recorded in
[`docs/VERIFICATION.md`](../../docs/VERIFICATION.md).

## Supported path: the clean room

A clean room is a DSH home created from nothing whose profile declares only
`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, and this plugin. That is the
install a community user gets, so it is the only install these scripts trust.

### 1. Build the home and boot it

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File clean-room.ps1 `
  -PackageSpec <absolute package dir OR npm spec like @andrewhmir/dsh-btw@0.1.2> `
  -HomeDir <a directory that does NOT exist yet> `
  -CliPrefix <prefix holding node_modules/@deepseek-ai/dsh> `
  -Port 3166 -KeepRunning
```

It seeds the profile with the two official bundles, copies a credential store
(a real provider key is required — without it the overlay only shows a provider
error), installs the package under test (a local directory is junction-linked; an
npm spec goes through `dsh plugin --profile web add`), seeds one workspace so the
"Choose workspace" onboarding cannot block the composer, composes and fails on
any loader complaint, then cold-boots and waits for `GET /btw/ask -> 405`.

It prints `HOME`, `URL`, and `PID`, and writes `logs/clean-room-runtime.json` in
the new home. A `-KeepRunning` run keeps the server attached to the calling
process tree, so from an automated harness dispatch it as a background job and
read the URL from that runtime file.

### 2. Dismiss the first-run notice

A fresh GUI shows a "Preview Notice" modal whose `<h2>` holds focus; until it is
dismissed, every synthetic keystroke goes to the dialog and the composer stays
empty. Start headless Chrome with a DevTools port, then:

```powershell
node first-run.mjs --port 9222 --url "<URL>"
```

It clicks the notice's primary button and proves the composer accepts text:
`{"dialogFound": true, "dialogDismissed": true, "composerAcceptsText": true}`.
It is idempotent — a returning profile reports `dialogFound: false` and still
passes.

### 3. Run the UI assertions

```powershell
node cdp-e2e.mjs --port 9222 --url "<URL>" --mode probe
node cdp-e2e.mjs --port 9222 --url "<URL>" --mode full --question-marker BTW-FULL-<stamp>
node cdp-e2e.mjs --port 9222 --url "<URL>" --mode dismiss-keys
node cdp-e2e.mjs --port 9222 --url "<URL>" --mode mid-stream --question-marker BTW-MID-<stamp>
```

- `probe` reports the composer/overlay structure and attempts one side question;
  use it first when GUI markup has drifted.
- `full` asserts the overlay appears, the answer streams, the question is shown,
  uppercase `/BTW` keeps its question, Markdown renders, a second warm call
  reports `cacheReadTokens > 0`, and Escape closes it.
- `dismiss-keys` asserts Escape, Space, and Enter each dismiss the overlay.
- `mid-stream` starts a ~20 s main turn, asks `/btw` while it streams, and waits
  for both the side answers and the main turn to finish.

### 4. Assert ephemerality

```powershell
node ephemerality-check.mjs --home <home> --since 0 `
  --question-marker BTW-FULL-<stamp> --answer-excerpt "<60 chars of the real answer>"
```

It decodes every `session.v*.jsonl.zstd` under the home and fails if the answer
appears in any event, or if the question marker appears in a `user/message`,
`command/run`, or `command/done` event. `EPHEMERALITY PASS` is the proof.

Do not trust a PASS until the scanner has been shown to detect a real trace: run
the same command with `--question-marker Start-Sleep` (text the main turn does
persist) and confirm it fails with a `user/message` hit.

## Environment notes (Windows)

These are properties of a confined DSH session, not of the plugin:

- Chrome cannot be spawned from the confined sandbox (`spawn EPERM`); browser
  steps need an unconfined session.
- `node --test` spawns a child per test file and fails with `spawn EPERM` under
  the same confinement.
- The `mid-stream` mode's main turn runs a shell command; if the DSH server
  itself is confined, that tool fails with `SetNamedSecurityInfoW (Win32 5)`, so
  run the server unconfined.
- Readiness is always an HTTP probe. `Get-NetTCPConnection` cannot see listeners
  owned by another job.

## Legacy: full-profile mirror

`build-mirror-plugin.ps1` and `patch-mirror-profile.mjs` are the author's older
path: they install the plugin into a **mirror of a full company profile** rather
than a clean home. The mirror itself is built by a workspace-only rehearsal
script that is not part of this repository, so these two files are kept for
reference and cannot run from a clean clone as-is. Prefer the clean room.
