# dsh-btw — ephemeral `/btw` side questions for the DSH Web GUI

An **unofficial community plugin** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(DSH). It adds one slash command to the Web GUI composer:

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

- DSH `>= 0.2.1-rc.2` with the Web GUI (`dsh web`).
- Node.js 24 or newer only for the verification scripts; the plugin itself runs
  inside the harness process.

## Install

1. Install the package as a DSH **bundle** into the profile you run. In the GUI,
   the agent can do it with the `plugin_manager` tool:

   ```
   plugin_manager install_bundle  target: <absolute path to this directory>
   ```

   (or install the published package name once it exists). The package declares
   `dsh.bundle.patch`, so the install adds it to `dsh.profile.bundles` and links
   it into the profile.
2. **Restart `dsh web`.** The running process holds its pre-install module graph;
   a restart loads the new host half. Restarting ends the current agent session
   (sessions persist and can be resumed).
3. Confirm the composition:

   ```
   dsh --profile web --dump-config
   ```

   Expected: exit code 0 and a row `id: btw` / `name: dsh-btw` with no
   `not found`, `unknown key`, or `cannot resolve` lines.
4. In the Web GUI, type `/btw hello` in a session and press Enter.

After editing only `client.js`, the harness's client HMR picks the rebuilt file
up on save; host-half edits need a restart.

## Configure

The plugin row accepts two optional values; both have safe defaults and are read
without a Config schema:

```yaml
- insert:
    - id: btw
      name: dsh-btw
      config:
        maxTokens: 1200    # completion cap for one side answer (default 1200)
        timeoutMs: 120000  # hard deadline for one side call (default 120000)
```

Questions are capped at 4000 characters; the request body is capped at 32 KiB.

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
- The answer streams back as newline-delimited JSON and renders in a
  `shell.overlay` panel. Space/Enter/Escape abort the request and close it.
- Nothing in this path calls `session.append`, the command registry, the agent
  loop, or the inbox — that is what makes the exchange ephemeral.

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

## Verify

From this directory:

```
node --test "test/*.test.mjs"
node tools/build-client.mjs --check
node --check client.js
```

`test/e2e/` additionally contains the mirror-rehearsal, CDP browser-E2E, and
session-log ephemerality scripts used for release verification (not shipped in
the published package).

## Publishing

This is an unofficial community plugin; upstream DSH does not accept external
pull requests at the moment, so distribution is a standalone package:

1. Create a public GitHub repository for this directory and push it.
2. Add the GitHub topic **`dsh-plugin`** so the plugin is discoverable.
3. Optionally publish to npm after confirming the name is free:
   `npm view dsh-btw version` → if it is taken, publish under a scope
   (for example `@your-scope/dsh-btw`) and update this README.
4. Announcing it in the upstream repository's Discussions is welcome; do not
   expect a reply.

## License

MIT. See `LICENSE`.
