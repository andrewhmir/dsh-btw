# @andrewhmir/dsh-btw — ephemeral `/btw` side questions for the DSH Web GUI

An **unofficial community plugin** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(DSH). It adds one gesture to the Web GUI composer:

```
/btw how does the compaction checkpoint interact with the surface?
```

The answer streams into an overlay over the app. Dismissing it leaves **no
trace** in the session: the question and answer are never appended to the
transcript, never rendered as chat rows, and never become part of what the model
sees on the next turn.

It is the inverse of a subagent: a subagent gets the full tool surface and an
empty context; `/btw` gets the full conversation context and no tools.

## What `/btw` does

| property | behavior |
|---|---|
| invocation | `/btw <question>` typed in the composer, mid-session; also selectable from the `/` menu |
| context | the full committed conversation of the current session |
| tools | none — the request carries no tool schemas and no tool history |
| answer | streamed into an overlay over the app frame |
| dismissal | Space, Enter, or Escape (also the close button / backdrop) |
| persistence | none — the exchange never enters session history |
| concurrency | works while the main turn is streaming and never interrupts it |
| shape | single-shot; no follow-up turns |
| model | the session's routed provider/model/reasoning effort |
| cost | one tool-less call whose message prefix is the parent request's prefix, so the provider's prompt cache is reused |

## Requirements

- DSH `>= 0.2.0-rc.2` with the Web GUI (`dsh web`).
- Node.js 22 or newer only for the verification scripts; the plugin itself runs
  inside the harness process.

## Install

The package is a DSH **bundle**: it declares `dsh.bundle.patch` and one
client+host plugin row (`id: btw`). Install it into the profile you run, then
restart `dsh web`.

### From a plugin market

Enable DSH's custom plugin market, add a community index that lists this package
(the repository carries the **`dsh-plugin`** GitHub topic so indexes can discover
it), and install `@andrewhmir/dsh-btw` from the Discover tab.

### With the agent

```
plugin_manager install_bundle  target: @andrewhmir/dsh-btw@0.1.2
```

### From a local checkout

```
plugin_manager install_bundle  target: /absolute/path/to/dsh-btw
```

### After installing

**Restart `dsh web`.** The running process holds its pre-install module graph;
a restart loads the new host half. Then confirm the composition:

```
dsh --profile web --dump-config
```

Expected: exit code 0 and a row `id: btw` / `name: @andrewhmir/dsh-btw` with no
`not found`, `unknown key`, or `cannot resolve` lines.

After editing only `client.js`, the harness's client HMR picks the rebuilt file
up on save; host-half edits need a restart.

## How it works

- `ui-commands` claims slash commands that exist in the session's **host**
  command catalog. `/btw` deliberately does not register such a command: a host
  command's result is durably logged (`command/run` / `command/done`) and would
  enter the session history.
- Instead, the plugin's **client half** registers its own `'/'` input-trigger
  source. During composer adjudication it claims `/btw <question>` before any
  host command runs, opens the overlay, and calls the plugin's own loopback
  route `POST /btw/ask`.
- The **host half** resolves the live agent for the session, snapshots the exact
  model-visible history with `Session.deriveMessages()`, appends one frozen user
  message carrying the side question, and runs a single `ctx.llm.stream()` call
  with **no tools, no tool history, and no separate system prompt**. Because the
  message list is the parent request's prefix plus one trailing message, the
  provider's prompt cache is reused.
- The answer streams back as newline-delimited JSON, renders **Markdown** through
  the shell's shared `MarkdownText` component (plain-text fallback if an older
  shell does not seed it), and is shown in a `shell.overlay` panel.
  Space/Enter/Escape abort the request and close it.
- A snapshot taken mid-turn can end with an assistant tool call whose
  `tool/result` is not committed yet. The host trims that trailing unresolved
  step before replaying the history, so `/btw` answers with the conversation as
  of the last completed tool step instead of the provider rejecting the request
  ("tool calls need immediate results").
- Nothing in this path calls `session.append`, the command registry, the agent
  loop, or the inbox — that is what makes the exchange ephemeral.

## Private by design

The ephemerality is a contract, not a rendering choice:

- the question and answer are never written to the session log, so they are not
  in the transcript, the token meter's session history, or any export;
- the host route never touches `session.append`, the command registry, the agent
  loop, or the inbox;
- the only durable effect is provider billing for one call.

It is verified against real session logs: `test/e2e/ephemerality-check.mjs`
decodes every `session.v*.jsonl.zstd` in a test home and fails if the question or
any part of the answer appears in a persisted event. A control run proves the
scanner detects text that *is* legitimately persisted. Results for both supported
harness versions are recorded in [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

## Configure

The plugin row accepts two optional values; both have safe defaults and are read
without a Config schema:

```yaml
- insert:
    - id: btw
      name: '@andrewhmir/dsh-btw'
      config:
        maxTokens: 1200    # completion cap for one side answer (default 1200)
        timeoutMs: 120000  # hard deadline for one side call (default 120000)
```

Questions are capped at 4000 characters; the request body is capped at 32 KiB.

## Known limitations

- **In-flight partial assistant text is not included.** The snapshot reads the
  committed session surface; while the main turn is streaming, the current
  assistant message is not committed yet. `/btw` sees the conversation as of the
  last committed event.
- **Not visible in session-log cost dashboards.** Ephemeral calls leave no
  session-log trace; provider billing is the source of truth for them.
- **Web GUI only.** The host route is generic, but the invocation and overlay are
  client-side Web features.
- **English overlay copy.** Display metadata ships in English and Chinese;
  in-overlay strings are English in this version.
- **A future host `btw` command would shadow this plugin.** The host catalog is
  adjudicated before the plugin's source; if a future harness version ships a
  host command with the same name, `/btw` would execute that command instead.
- **Single-shot.** There is no follow-up turn inside the overlay.

## Compatibility

`engines.dsh` declares `>=0.2.0-rc.2`. Both tags were verified on a clean-room
install containing only the official bundles plus this plugin:

| Harness | Result |
|---|---|
| `0.2.0-rc.2` (npm `latest`) | overlay + streamed answer, uppercase `/BTW`, Markdown, Escape/Space/Enter dismissal, warm cache |
| `0.2.1-rc.2` (npm `next`) | the above, plus mid-stream concurrency (4/4 answers during a tool call) and strict ephemerality |

See [`docs/VERIFICATION.md`](docs/VERIFICATION.md) for the measurements and the
exact commands.

## Verify

From this directory:

```
node --test "test/*.test.mjs"
node tools/build-client.mjs --check
node --check client.js
```

The clean-room and browser harness lives in `test/e2e/` and is documented there.
It is not shipped in the published package:

- `clean-room.ps1` builds a fresh DSH home with only the official bundles plus
  this plugin, seeds the workspace state, composes, boots, and prints the URL;
- `first-run.mjs` dismisses the first-run preview notice and proves the composer
  accepts text;
- `cdp-e2e.mjs` drives the real GUI over the DevTools protocol (`probe`, `full`,
  `dismiss-keys`, `mid-stream`);
- `ephemerality-check.mjs` asserts that no exchange reached a session log.

## Development

```
node tools/build-client.mjs         # regenerate client.js from src/client/*.mjs
node tools/build-client.mjs --check # fail when client.js is stale
node --test "test/*.test.mjs"
```

`client.js` is a generated classic script that registers itself with the
harness's module loader under the package name. Source modules under `src/client/`
are plain ESM with relative `.mjs` imports only; the host half lives in `src/host/`
and is injected with the harness services (`webServer`, `llm`, `agents`).

## Independence and license

This is an unofficial community plugin, not affiliated with DeepSeek. It is an
independent implementation of the `/btw` idea and does not reuse code from the
other community packages with similar names (`dsh-btw@0.0.3` and
`@michengai/dsh-btw`). Upstream DSH does not accept external pull requests at
the moment, so distribution is a standalone package; the repository carries the
`dsh-plugin` topic so community plugin indexes can discover it.

MIT. See [`LICENSE`](LICENSE).
