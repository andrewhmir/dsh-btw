// First-run helper for a genuinely fresh DSH home.
//
// A brand-new `dsh web` home shows two things that a copied/mirror home does
// not: the "Choose workspace" onboarding (handled by clean-room.ps1, which seeds
// the workspace state before boot) and a "Preview Notice" modal whose <h2> holds
// focus. While that modal is open, `editor.focus()` is a no-op and every
// `Input.insertText` goes to the dialog, so an automated E2E fails with an empty
// composer draft and no useful error.
//
// This script dismisses the notice the way a person does (click its primary
// button), then proves the composer accepts text. It is idempotent: on a home
// whose notice is already acknowledged it finds no dialog and still passes.
//
//   node first-run.mjs --port 9222 --url "http://127.0.0.1:3166/?token=..."
//
// Exit 0 = no modal is blocking and the composer takes text.
// Output: {"dialogFound": bool, "dialogDismissed": bool, "composerAcceptsText": bool, ...}

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};
const port = Number(arg('port', 9222));
const url = arg('url');
if (!url) {
  console.error('need --url (the clean-room launch URL printed by clean-room.ps1)');
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- CDP client
const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
if (!created.ok) {
  console.error(`could not open a tab on port ${port}: ${created.status} ${await created.text()}`);
  process.exit(3);
}
const target = await created.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
  }
});
const call = (method, params = {}) =>
  new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
const evaluate = async (expression) => {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result?.exceptionDetails) return { __exception: result.exceptionDetails.text };
  return result?.result?.value;
};

await new Promise((resolve) => ws.addEventListener('open', resolve));
await call('Runtime.enable');
await call('Page.enable');

// ------------------------------------------------------------ wait for app
const dialogState = () => evaluate(`(() => {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')];
  const dialog = dialogs[dialogs.length - 1] ?? null;
  if (dialog === null) return JSON.stringify({ dialogs: 0, buttons: [] });
  const buttons = [...dialog.querySelectorAll('button, [role="button"]')].map((button) => {
    const rect = button.getBoundingClientRect();
    return {
      text: (button.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
      cx: Math.round(rect.x + rect.width / 2),
      cy: Math.round(rect.y + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  });
  return JSON.stringify({ dialogs: dialogs.length, buttons });
})()`);

let dialogFound = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  const raw = await dialogState();
  let state = { dialogs: 0, buttons: [] };
  try {
    state = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    // Page still navigating; try again.
  }
  const composer = await evaluate(`!!document.querySelector('[contenteditable="true"]')`);
  if (state.dialogs > 0) {
    dialogFound = true;
    break;
  }
  if (composer === true) break;
  await sleep(1000);
}

// ----------------------------------------------------------- dismiss modal
for (let round = 0; round < 5; round += 1) {
  const raw = await dialogState();
  let state = { dialogs: 0, buttons: [] };
  try {
    state = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    await sleep(1000);
    continue;
  }
  if (state.dialogs === 0) break;
  const primary =
    state.buttons.find((button) => /continue|got it|start|ok|agree|done/i.test(button.text)) ??
    state.buttons[state.buttons.length - 1];
  if (!primary || primary.width === 0 || primary.height === 0) {
    await sleep(1000);
    continue;
  }
  // Real mouse events first; some React trees ignore synthetic .click().
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: primary.cx, y: primary.cy, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: primary.cx, y: primary.cy, button: 'left', clickCount: 1 });
  // Give React a beat, then check; fall back to a DOM click if nothing moved.
  await sleep(1500);
  const afterRaw = await dialogState();
  let after = { dialogs: 0 };
  try {
    after = typeof afterRaw === 'string' ? JSON.parse(afterRaw) : afterRaw;
  } catch {
    // ignore
  }
  if (after.dialogs > 0) {
    await evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
      if (dialog === null) return false;
      const buttons = [...dialog.querySelectorAll('button, [role="button"]')];
      const primary = buttons.find((b) => /continue|got it|start|ok|agree|done/i.test(b.innerText || '')) ?? buttons[buttons.length - 1];
      if (primary) primary.click();
      return true;
    })()`);
    await sleep(1500);
  }
}

// Wait for the modal to actually leave the DOM.
let dialogDismissed = false;
for (let attempt = 0; attempt < 20; attempt += 1) {
  const raw = await dialogState();
  let state = { dialogs: 0 };
  try {
    state = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    // ignore
  }
  if (state.dialogs === 0) {
    dialogDismissed = true;
    break;
  }
  await sleep(1000);
}

// -------------------------------------------------- composer accepts text
const probe = `BTW-FIRST-RUN-${Date.now()}`;
let composerAcceptsText = false;
for (let attempt = 0; attempt < 20; attempt += 1) {
  const focused = await evaluate(`(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    if (!editor) return JSON.stringify({ ok: false, reason: 'no composer' });
    editor.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return JSON.stringify({ ok: document.activeElement === editor });
  })()`);
  let focusState = { ok: false };
  try {
    focusState = typeof focused === 'string' ? JSON.parse(focused) : focused;
  } catch {
    // ignore
  }
  if (focusState.ok) {
    await call('Input.insertText', { text: probe });
    await sleep(600);
    const draft = await evaluate(`(() => {
      const editor = document.querySelector('[contenteditable="true"]');
      return editor ? editor.innerText : null;
    })()`);
    composerAcceptsText = typeof draft === 'string' && draft.includes(probe);
    if (composerAcceptsText) {
      // Clear the probe so the real E2E starts from an empty composer.
      const ctrlA = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 };
      await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...ctrlA });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', ...ctrlA });
      const backspace = { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 };
      await call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...backspace });
      await call('Input.dispatchKeyEvent', { type: 'keyUp', ...backspace });
      break;
    }
  }
  await sleep(1000);
}

console.log(JSON.stringify({ dialogFound, dialogDismissed, composerAcceptsText, url }, null, 2));
ws.close();
process.exit(composerAcceptsText ? 0 : 1);
