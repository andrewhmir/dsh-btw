# Mounting dsh-btw in this company profile

Machine-specific install notes for the DSH company Web GUI on this box
(`DSH_HOME=C:\Users\Andrew\.dsh-company`, GUI on <http://127.0.0.1:3081>).

**Status: not yet installed live.** This file is updated in the final plan task
with the live-install date, compose result, browser E2E result, and revert
evidence.

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
