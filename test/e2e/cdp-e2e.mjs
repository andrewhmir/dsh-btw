// CDP browser E2E for the dsh-btw overlay, adapted from .harness-check/cdp-probe.mjs.
//
// It drives the REAL Web GUI in headless Chrome over the DevTools protocol:
// types into the composer, presses keys, and reads the live DOM. It never waits
// for a load event (the GUI keeps a WebSocket open, so that never settles).
//
//   node cdp-e2e.mjs --port 9222 --url "<mirror launch url>" --mode probe
//   node cdp-e2e.mjs --port 9222 --url "<url>" --mode full --question-marker "BTW-E2E-123"
//   node cdp-e2e.mjs --port 9222 --url "<url>" --mode dismiss-keys
//   node cdp-e2e.mjs --port 9222 --url "<url>" --mode mid-stream --question-marker "BTW-MID-123"
//
// Chrome must already be running with --remote-debugging-port (see README.md in
// this directory). Never kill Chrome from this script; close it over CDP with
// cdp-probe.mjs --close-browser or manually.
//
// Exit 0 = evidence printed to stdout; non-zero = the assertion failed.

import { readFileSync } from 'node:fs';

// The client bundle is served under the package name; read it so a rename does
// not drift away from the probe.
const pluginName = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).name;

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const debugPort = Number(arg('port', 9222));
const url = arg('url');
const mode = arg('mode', 'probe');
const questionMarker = arg('question-marker', `BTW-E2E-${Date.now()}`);

if (!url) {
  console.error('need --url (the mirror launch URL from build-mirror-plugin.ps1 -KeepRunning)');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- CDP client
// Reuse ONE app tab instead of spawning a new one per run: background tabs are
// throttled by Chrome and a pile of GUI tabs exhausts the page's resources, so
// the composer eventually stops mounting in the newest tab.
const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
const appPort = new URL(url).port;
const appTabs = targets.filter((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:') && t.url.includes(`:${appPort}/`));
for (const extra of appTabs.slice(1)) await fetch(`http://127.0.0.1:${debugPort}/json/close/${extra.id}`);
let target = appTabs[0] ?? targets.find((t) => t.type === 'page' && t.url === 'about:blank');
if (!target) {
  const created = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' });
  if (!created.ok) {
    console.error('could not open a tab:', created.status, await created.text());
    process.exit(3);
  }
  target = await created.json();
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const pageErrors = [];
let messageId = 0;

ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails;
    pageErrors.push(`exception: ${details.text} ${details.exception?.description?.split('\n')[0] ?? ''}`.trim());
  } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    pageErrors.push(`console.error: ${message.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 300));
  }
});
const call = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++messageId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
await new Promise((resolve) => ws.addEventListener('open', resolve));
await call('Runtime.enable');
await call('Log.enable');
await call('Page.enable');
// Load the app in this tab with listeners attached, then let it mount.
await call('Page.navigate', { url });
await new Promise((resolve) => setTimeout(resolve, 8000));

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (response?.result?.exceptionDetails) {
    throw new Error(`page evaluate failed: ${JSON.stringify(response.result.exceptionDetails)}`);
  }
  return response?.result?.result?.value;
}

async function waitFor(label, probe, { timeoutMs = 60000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timed out waiting for ${label} (last value: ${JSON.stringify(last)})`);
}

// ------------------------------------------------------------- keyboard I/O
async function pressKey(key, code, windowsVirtualKeyCode) {
  const base = { key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode };
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}
const pressEnter = () => pressKey('Enter', 'Enter', 13);
const pressEscape = () => pressKey('Escape', 'Escape', 27);
const pressSpace = () => pressKey(' ', 'Space', 32);

async function focusComposer() {
  const focused = await evaluate(`(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    if (!editor) return { ok: false, reason: 'no contenteditable composer' };
    editor.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return { ok: true, tag: editor.tagName, cls: editor.className };
  })()`);
  if (!focused?.ok) throw new Error(`composer not found: ${JSON.stringify(focused)}`);
  return focused;
}

const readDraft = () => evaluate(`(() => {
  const editor = document.querySelector('[contenteditable="true"]');
  return editor ? editor.innerText : null;
})()`);

/** Type a full line and submit it with Enter.
 *
 * The `/` trigger menu may open while typing; Enter would accept a menu row
 * instead of submitting, so close an open menu with Escape first (the draft is
 * preserved) and then submit. The insert is verified and retried once because
 * a freshly opened tab can still be mounting its editor when the first
 * insertText arrives. */
async function submitLine(text) {
  await focusComposer();
  const ctrl = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 };
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...ctrl });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', ...ctrl });
  await pressKey('Backspace', 'Backspace', 8);
  await call('Input.insertText', { text });
  await sleep(500);
  let draft = await readDraft();
  if (!draft || !draft.includes(text)) {
    await focusComposer();
    await call('Input.insertText', { text });
    await sleep(500);
    draft = await readDraft();
  }
  if (!draft || !draft.includes(text)) {
    throw new Error(`composer did not accept the draft (draft: ${JSON.stringify(draft)})`);
  }
  const menuOpen = await evaluate(`!!document.querySelector('[role="listbox"]')`);
  if (menuOpen) {
    await pressEscape();
    await sleep(150);
  }
  await pressEnter();
}

// ------------------------------------------------------------------ probes
const overlayState = `(() => {
  const root = document.querySelector('.dsh-btw-dock[data-btw-status]');
  if (!root) return null;
  const card = root.querySelector('.dsh-btw-card') ?? root;
  return {
    status: root.getAttribute('data-btw-status'),
    cacheReadTokens: root.getAttribute('data-btw-cache-read-tokens'),
    question: root.querySelector('.dsh-btw-question')?.innerText ?? '',
    answer: root.querySelector('.dsh-btw-answer')?.innerText ?? '',
    error: root.querySelector('.dsh-btw-error')?.innerText ?? null,
    text: card.innerText ?? '',
  };
})()`;
const readOverlay = () => evaluate(overlayState);

async function openSideQuestion(marker) {
  await submitLine(`/btw ${marker} What is this conversation about?`);
  await waitFor('the /btw overlay', readOverlay, { timeoutMs: 30000 });
  return readOverlay();
}
async function waitForSideAnswer(marker, timeoutMs = 180000) {
  const overlay = await waitFor('the /btw overlay', readOverlay, { timeoutMs: 30000 });
  const settled = await waitFor(
    'the side answer to settle',
    async () => {
      const current = await readOverlay();
      if (!current) return null;
      if (current.status === 'done' || current.status === 'error') return current;
      return null;
    },
    { timeoutMs },
  );
  if (settled.status === 'error') throw new Error(`side answer failed: ${settled.error ?? settled.text}`);
  return settled;
}

async function waitForOverlayGone(timeoutMs = 15000) {
  await waitFor('the /btw overlay to close', async () => ((await readOverlay()) === null ? true : null), { timeoutMs });
}

/** Close the non-modal panel with its × button (the only always-available dismissal). */
async function dismissOverlay() {
  const clicked = await evaluate(`(() => {
    const button = document.querySelector('.dsh-btw-close');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('the /btw close button was not found');
  await waitForOverlayGone();
}

/** Focus the floating card so its own Escape handler can fire. */
async function focusCard() {
  const focused = await evaluate(`(() => {
    const card = document.querySelector('.dsh-btw-card');
    if (!card) return false;
    card.focus();
    return document.activeElement === card;
  })()`);
  if (!focused) throw new Error('the /btw card could not take focus');
}

/** Whether a main turn is currently streaming (the composer's Stop control). */
async function isMainTurnRunning() {
  return evaluate(`(() => {
    const stop = [...document.querySelectorAll('button')].find((b) =>
      /stop/i.test(b.getAttribute('aria-label') || '') || /^(stop|cancel)$/i.test((b.innerText || '').trim()));
    return !!stop;
  })()`);
}

/** Open a brand-new session so the run starts from a known blank state. */
async function ensureFreshSession() {
  const clicked = await evaluate(`(() => {
    const button = document.querySelector('button[aria-label="New session"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('New session button not found');
  await sleep(2000);
  await waitFor('the fresh composer', async () => evaluate(`!!document.querySelector('[contenteditable="true"]')`), { timeoutMs: 30000, intervalMs: 500 });
}

/** Page errors that are environmental noise on a credential-copied mirror
 * (the mirror has no DeepSeek account session, only an API key). */
function meaningfulPageErrors() {
  return pageErrors.filter(
    (message) => !message.includes('deepseek-account') && !message.includes('account read failed'),
  );
}

function evidence(extra = {}) {
  return { mode, url, questionMarker, pageErrors: meaningfulPageErrors().slice(0, 10), ...extra };
}

// ------------------------------------------------------------------- modes
async function runProbe() {
  // Give the SPA time to mount the conversation and its composer.
  await waitFor('the composer', async () => evaluate(`!!document.querySelector('[contenteditable="true"]')`), { timeoutMs: 120000, intervalMs: 1000 });
  await sleep(3000);
  const structure = await evaluate(`(() => {
    const editors = [...document.querySelectorAll('[contenteditable="true"]')];
    const buttons = [...document.querySelectorAll('button')].slice(0, 12).map((b) => ({
      text: (b.innerText || '').trim().slice(0, 40),
      aria: b.getAttribute('aria-label'),
    }));
    return {
      title: document.title,
      readyState: document.readyState,
      editors: editors.map((e) => ({ tag: e.tagName, cls: e.className })),
      buttons,
      bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400),
      scripts: [...document.scripts].map((s) => s.src).filter(Boolean).slice(0, 10),
      pluginBundleLoaded: [...document.scripts].some((s) => (s.src || '').includes("${pluginName}/client.js")),
    };
  })()`);
  let sideQuestion = null;
  try {
    await openSideQuestion(questionMarker);
    sideQuestion = await waitForSideAnswer(questionMarker, 120000);
  } catch (error) {
    sideQuestion = { failed: String(error), draft: await readDraft() };
  }
  console.log(JSON.stringify(evidence({ structure, sideQuestion, probeErrors: meaningfulPageErrors() }), null, 2));
  return Boolean(sideQuestion && !sideQuestion.failed);
}

async function runFull() {
  await waitFor('the composer', async () => evaluate(`!!document.querySelector('[contenteditable="true"]')`), { timeoutMs: 120000, intervalMs: 1000 });
  await sleep(3000);
  await ensureFreshSession();

  // A warm conversation turn first: (a) /btw must see real context, (b) the
  // second side call can only report cacheReadTokens > 0 if a parent request
  // with a cacheable prefix already ran in this session.
  await submitLine('Answer with one word only: the third planet from the Sun.');
  await waitFor(
    'the warm-up reply (Earth)',
    async () => evaluate(`document.body.innerText.includes('Earth')`),
    { timeoutMs: 180000, intervalMs: 2000 },
  );

  const first = await (async () => {
    await openSideQuestion(questionMarker);
    return waitForSideAnswer(questionMarker);
  })();
  if (!first.text.includes(questionMarker)) throw new Error('the overlay does not show the question');
  // Non-modal contract: no backdrop, the app frame stays usable underneath.
  const layout = await evaluate(`(() => ({
    backdrop: document.querySelector('.dsh-btw-backdrop') !== null,
    dock: document.querySelector('.dsh-btw-dock[data-btw-status]') !== null,
  }))()`);
  if (layout.backdrop) throw new Error('the /btw panel rendered a full-screen backdrop');
  if (!layout.dock) throw new Error('the /btw panel did not render its floating dock');
  if ((first.answer || '').trim().length < 10) throw new Error(`the side answer is empty or too short: ${JSON.stringify(first.answer)}`);
  const answerExcerpt = (first.answer || '').replace(/\s+/g, ' ').trim().slice(0, 60);

  // Uppercase spelling must survive the harness's case-sensitive argsAfter:
  // the claim carries the typed token, not a fixed lowercase one.
  await dismissOverlay();
  await submitLine(`/BTW ${questionMarker}-upper What is this conversation about?`);
  const upper = await waitForSideAnswer(`${questionMarker}-upper`);
  if (!upper.text.includes(`${questionMarker}-upper`)) {
    throw new Error('the uppercase /BTW invocation did not carry its question into the overlay');
  }
  await dismissOverlay();

  // Markdown answers must render through the seeded MarkdownText primitive,
  // not as raw `**text**`.
  await dismissOverlay();
  await submitLine(`/btw ${questionMarker}-md Reply in markdown: one bold word and a two-item bullet list.`);
  await waitForSideAnswer(`${questionMarker}-md`);
  const markdown = await evaluate(`(() => {
    const answer = document.querySelector('.dsh-btw-dock .dsh-btw-answer--markdown');
    if (!answer) return { present: false, html: null };
    return { present: true, html: answer.innerHTML.slice(0, 600) };
  })()`);
  if (!markdown?.present) throw new Error('the answer did not render inside the markdown answer container');
  if (!/<(strong|b|em|code|ul|ol|li|h[1-6])[\s>]/i.test(markdown.html || '')) {
    throw new Error(`the markdown answer contains no rendered formatting: ${JSON.stringify(markdown.html)}`);
  }
  await dismissOverlay();

  // Second call in the same warm session should reuse the parent request prefix.
  const second = await (async () => {
    await openSideQuestion(`${questionMarker}-cache`);
    return waitForSideAnswer(`${questionMarker}-cache`);
  })();
  const cacheReadTokens = Number(second.cacheReadTokens);
  await dismissOverlay();

  console.log(JSON.stringify(evidence({
    firstAnswerChars: (first.answer || '').length,
    firstStatus: first.status,
    upperCaseWorks: true,
    markdownRendered: true,
    nonModal: true,
    secondStatus: second.status,
    cacheReadTokens,
    answerExcerpt,
  }), null, 2));
  if (!(cacheReadTokens > 0)) throw new Error(`expected cacheReadTokens > 0 on the second warm call, got ${second.cacheReadTokens}`);
  if (meaningfulPageErrors().length > 0) throw new Error(`page errors during full E2E: ${JSON.stringify(meaningfulPageErrors().slice(0, 5))}`);
  return true;
}

async function runDismissKeys() {
  await waitFor('the composer', async () => evaluate(`!!document.querySelector('[contenteditable="true"]')`), { timeoutMs: 120000, intervalMs: 1000 });
  await sleep(3000);
  const results = {};

  // The panel is non-modal: no backdrop, and the composer stays usable while
  // an answer streams.
  await openSideQuestion(`${questionMarker}-modal`);
  const layout = await evaluate(`(() => ({
    backdrop: document.querySelector('.dsh-btw-backdrop') !== null,
    dock: document.querySelector('.dsh-btw-dock[data-btw-status]') !== null,
  }))()`);
  if (layout.backdrop) throw new Error('the /btw panel rendered a full-screen backdrop');
  if (!layout.dock) throw new Error('the /btw panel did not render its floating dock');
  results.nonModal = 'no-backdrop';

  await focusComposer();
  await call('Input.insertText', { text: 'still typing' });
  await sleep(300);
  const draft = await readDraft();
  if (!draft || !draft.includes('still typing')) {
    throw new Error(`the composer is blocked while the panel is open (draft: ${JSON.stringify(draft)})`);
  }
  results.composerUsableWhileOpen = true;
  // Clear the draft so the rest of the run starts clean.
  const clear = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 };
  await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...clear });
  await call('Input.dispatchKeyEvent', { type: 'keyUp', ...clear });
  await pressKey('Backspace', 'Backspace', 8);
  await dismissOverlay();
  results.closeButton = 'dismissed';

  // Escape closes only while the card itself has focus.
  await openSideQuestion(`${questionMarker}-esc`);
  await focusCard();
  await pressEscape();
  await waitForOverlayGone();
  results.focusedEscape = 'dismissed';

  // Escape typed into the composer must not close a non-modal panel.
  await openSideQuestion(`${questionMarker}-esc-composer`);
  await focusComposer();
  await pressEscape();
  await sleep(700);
  if ((await readOverlay()) === null) throw new Error('Escape in the composer closed the non-modal panel');
  results.composerEscape = 'stayed-open';

  // Space and Enter belong to whatever has focus; they no longer dismiss.
  await focusCard();
  await pressSpace();
  await pressEnter();
  await sleep(700);
  if ((await readOverlay()) === null) throw new Error('Space or Enter dismissed the non-modal panel');
  results.spaceEnter = 'stayed-open';
  await dismissOverlay();
  results.secondCloseButton = 'dismissed';

  console.log(JSON.stringify(evidence({ dismissal: results }), null, 2));
  if (meaningfulPageErrors().length > 0) throw new Error(`page errors during dismiss-keys E2E: ${JSON.stringify(meaningfulPageErrors().slice(0, 5))}`);
  return true;
}

async function runMidStream() {
  await waitFor('the composer', async () => evaluate(`!!document.querySelector('[contenteditable="true"]')`), { timeoutMs: 120000, intervalMs: 1000 });
  await sleep(3000);
  await ensureFreshSession();
  await submitLine('Run a command that sleeps for about 20 seconds (on Windows: Start-Sleep -Seconds 20), wait for it to finish, then reply with a short confirmation.');
  const sawRunning = await waitFor('the main turn to start streaming', isMainTurnRunning, { timeoutMs: 30000, intervalMs: 500 });

  // Wait until the assistant has certainly committed a tool call whose result is
  // still pending (the 20 s sleep is executing). This is the exact window that
  // used to make the provider reject the replayed history with
  // "tool calls need immediate results".
  await sleep(4000);

  const attempts = [];
  let success = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!(await isMainTurnRunning())) break;
    const marker = `${questionMarker}-${attempt}`;
    await submitLine(`/btw ${marker} What is happening in this conversation right now?`);
    const settled = await (async () => {
      await waitFor('the /btw overlay', readOverlay, { timeoutMs: 20000 });
      return waitFor(
        'the side answer to settle',
        async () => {
          const current = await readOverlay();
          if (!current) return null;
          return current.status === 'done' || current.status === 'error' ? current : null;
        },
        { timeoutMs: 120000 },
      );
    })();
    attempts.push({ attempt, status: settled.status, error: settled.error });
    await dismissOverlay();
    if (settled.status === 'done' && (settled.answer || '').trim().length > 5) success = settled;
    await sleep(1500);
  }

  const failures = attempts.filter((attempt) => attempt.status !== 'done');
  if (failures.length > 0) {
    throw new Error(`mid-stream side answers failed during the tool window: ${JSON.stringify(failures)}`);
  }
  if (success === null) throw new Error(`no mid-stream side answer produced text: ${JSON.stringify(attempts)}`);

  await waitFor('the main turn to finish', async () => ((await isMainTurnRunning()) ? null : true), { timeoutMs: 300000, intervalMs: 2000 });
  const overlayStillOpen = (await readOverlay()) !== null;
  await dismissOverlay();
  console.log(JSON.stringify(evidence({
    sawMainTurnRunning: Boolean(sawRunning),
    attempts,
    sideAnswerChars: (success.answer || '').length,
    overlayStillOpenWhileMainTurnFinished: overlayStillOpen,
    mainTurnFinished: true,
  }), null, 2));
  if (meaningfulPageErrors().length > 0) throw new Error(`page errors during mid-stream E2E: ${JSON.stringify(meaningfulPageErrors().slice(0, 5))}`);
  return true;
}

try {
  let ok = false;
  if (mode === 'probe') ok = await runProbe();
  else if (mode === 'full') ok = await runFull();
  else if (mode === 'dismiss-keys') ok = await runDismissKeys();
  else if (mode === 'mid-stream') ok = await runMidStream();
  else throw new Error(`unknown --mode ${mode}`);
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(`E2E ${mode} FAILED: ${error.message}`);
  if (pageErrors.length > 0) console.error('page errors:', JSON.stringify(pageErrors.slice(0, 8), null, 1));
  process.exit(1);
}
