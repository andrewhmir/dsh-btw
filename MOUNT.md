# Mounting dsh-btw in this company profile

Machine-specific install notes for the DSH company Web GUI on this box
(`DSH_HOME=C:\Users\Andrew\.dsh-company`, GUI on <http://127.0.0.1:3081>).

**Status: INSTALLED AND VERIFIED — 2026-10-19.** Evidence:

- `plugin_manager install_bundle` on the absolute workspace directory reported
  `application: applied`, `warnings: []`, and linked
  `dsh-btw: link:C:/Users/Andrew/Desktop/dsh_andrew/dsh-btw`; the bundle is in
  `dsh.profile.bundles`. **No restart was needed** — the host route was live
  immediately (`GET /btw/ask` → 405 on the live port).
- Live compose: `dsh --profile web --dump-config` exit 0, row `id: btw` /
  `name: dsh-btw`, zero `not found` / `unknown key` / `cannot resolve` lines.
- Mirror harness E2E (`.harness-check\home-021`, 0.2.1-rc.2): overlay with a
  streamed answer, `cacheReadTokens: 2304` on the warm second call, Escape/Space/
  Enter each dismissed it, and a mid-stream `/btw` answered while the main turn
  ran. Ephemerality check PASS on the mirror session log.
- Live smoke (operator): page refreshed, a marked `/btw <question>` answered in
  the overlay and dismissed with Escape. Live session-log assertion PASS: no
  persisted user message or command event carries the exchange (marker hits are
  the agent's own tool/test traffic, not the `/btw` path), and no `btw`
  command/run event exists.

Re-verify after any `dsh` upgrade with the steps below and the scripts in
`dsh-btw\test\e2e\`.

**Post-review fix pass (2026-10-19 01:35, GUI restarted 08:10):** the
fresh-context review found and the implementation fixed four defects (dismissal
now aborts the provider call, uppercase `/BTW` keeps its question,
attachment-carrying claims are refused on every claim path, and the 413/405
responses match the documented contract). The fixed build was re-verified on the
mirror (full E2E incl. uppercase, dismiss mid-stream, mid-stream concurrency,
strict ephemerality PASS; suite 55/55), then the GUI was restarted and the fixed
host half was confirmed live on port 3081:

- `GET /btw/ask` → `405 {"error":{"code":"METHOD_NOT_ALLOWED","message":"POST required"}}`
- 40 KB POST body → `413 {"error":{"code":"TOO_LARGE"}}` (the pre-fix build reset the socket)
- unknown session → `409 NO_LIVE_AGENT`; malformed JSON → `400 BAD_REQUEST`
- `dsh --profile web --dump-config` exit 0, `btw`/`dsh-btw` row, 0 complaints

The client half hot-swaps from the rebuilt `client.js`; its fixed behavior
(typed-token uppercase, claim-path refusals) is proven by the mirror E2E.

**Field-bug fix (v0.1.1, 2026-10-19 08:30, restart pending):** real use exposed
two defects — a mid-turn `/btw` failed with "DeepSeek Messages tool calls need
immediate results" (the replayed prefix ended with an assistant tool call whose
result was not committed; the host now trims to the last resolved tool step),
and Markdown answers rendered literally (the overlay now uses the seeded
`MarkdownText` primitive; it is a React forwardRef object, so availability is a
presence test). Mirror re-verification on the fixed build:

- suite **65/65**; `client.js --check` up to date; pack 21 files, `0.1.1`
- full CDP E2E: streamed answer, uppercase `/BTW`, **`markdownRendered: true`**,
  warm `cacheReadTokens: 2304`
- mid-stream CDP E2E: **4/4 `/btw` attempts inside a 20 s tool window answered
  `done`** while the main turn ran
- ephemerality PASS for both runs (no persisted user/command/assistant trace)

The host half (history trimming) needs one GUI restart to load; the client half
hot-swaps from the rebuilt `client.js`.

## 1. Install the bundle

Use the harness `plugin_manager` tool (the sanctioned route; do not hand-edit the
profile's `package.json` or `cordis.patch.yml`):

```
plugin_manager  action: install_bundle
                target: C:\Users\Andrew\Desktop\dsh_andrew\dsh-btw
```

The target is the absolute workspace directory; the package declares
`dsh.bundle.patch` and `engines.dsh >=0.2.1-rc.2`. This is a danger-full-access
operation and asks for approval.

Expected result: the bundle is selected, the install reports applied (or
`restart-required`), and the profile's dependency list gains
`"dsh-btw": "link:C:/Users/Andrew/Desktop/dsh_andrew/dsh-btw"`.

## 2. Restart the Web GUI

Restart `dsh web` with the usual launcher
(`Desktop\DeepSeek Harness - Company.cmd`). The running process holds its
pre-install module graph. **Restarting ends the current agent session**; the
session is persisted and can be resumed after the restart.

## 3. Confirm the composition

```powershell
dsh --profile web --dump-config > .harness-check\dump-btw-live.txt 2> .harness-check\dump-btw-live.err.txt
Select-String -Path .harness-check\dump-btw-live.txt -Pattern 'id: btw','name: dsh-btw'
Select-String -Path .harness-check\dump-btw-live.txt -Pattern 'not found','unknown key','cannot resolve','did not activate' -SimpleMatch
```

Expected: exit code 0, the `btw` row resolves to `dsh-btw`, and the complaint
scan is empty.

## 4. Verify the capability

Smoke test in the real GUI: open a session, type `/btw hello` + Enter. The
overlay should appear and stream an answer; Escape/Space/Enter should close it.

Full verification (mirror rehearsal, browser E2E, ephemerality assertion) is
documented in `dsh-btw\test\e2e\README.md`. The live E2E and the ephemerality
check run from this workspace:

```powershell
node dsh-btw\test\e2e\cdp-e2e.mjs --mode full --url http://127.0.0.1:3081
node dsh-btw\test\e2e\ephemerality-check.mjs --home C:\Users\Andrew\.dsh-company --since <epochMs> --question-marker <marker> --answer-excerpt <excerpt>
```

## 5. Updating the plugin

- Client half: `node dsh-btw\tools\build-client.mjs`, then save —
  `dsh-client-hmr` stat-polls the built bundle and hot-swaps it in the open page.
- Host half or `package.json`: restart `dsh web`.
- Replacing an installed package requires a restart to load a fresh JavaScript
  module generation.

## 6. Revert

Preferred (the harness owns profile state):

```
plugin_manager  action: remove_bundle  target: dsh-btw
```

Then restart `dsh web`. If the tool is unavailable, remove `"dsh-btw"` from
`dsh.profile.bundles` and the `link:` dependency in
`C:\Users\Andrew\.dsh-company\profiles\web\package.json`, delete the
`node_modules\dsh-btw` link, and restart.

Nothing under the harness install
(`C:\Users\Andrew\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh`) is
modified, so a `dsh` upgrade is unaffected.
