import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createBtwHost } from '../src/host/route.mjs';
import { makeReq, makeRes, fakeAgent } from './helpers/fakes.mjs';

function hostFor({ agent = fakeAgent(), llm, logger, config } = {}) {
  const registered = [];
  const webServer = { register: (route) => { registered.push(route); return () => { registered.pop(); }; } };
  const agents = { get: (id) => (id === 'sess-1' ? agent : undefined) };
  const host = createBtwHost({ webServer, agents, llm: llm ?? (async function* () {}), logger, config });
  return { host, registered };
}

async function call(host, req) {
  const res = makeRes();
  await host.handleRequest(req, res);
  return res;
}

function parseFrames(body) {
  return body.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

const headerConfig = { config: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' } };

/** Poll until `fn()` is truthy, up to a deadline. */
async function waitUntil(label, fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/**
 * A fake LLM whose consecutive `stream()` calls replay the given rounds.
 * @param {Array<() => AsyncIterable<object>>} rounds - one factory per call.
 * @returns {{calls: object[], stream: (options: object) => AsyncIterable<object>}} scripted llm.
 */
function scriptedLlm(rounds) {
  const calls = [];
  return {
    calls,
    stream(options) {
      const index = calls.length;
      calls.push(options);
      return rounds[Math.min(index, rounds.length - 1)]();
    },
  };
}

/** One chunk stream that emits `chunks` then finishes with `reason`. */
function streamOf(chunks, reason) {
  return async function* () {
    for (const chunk of chunks) yield chunk;
    yield { type: 'finish', reason };
  };
}

test('rejects non-loopback sockets, wrong paths, and non-POST methods', async () => {
  const { host } = hostFor();
  assert.equal((await call(host, makeReq({ remoteAddress: '10.0.0.9' }))).status, 403);
  assert.equal((await call(host, makeReq({ url: '/btw/other' }))).status, 404);
  const method = await call(host, makeReq({ method: 'GET' }));
  assert.equal(method.status, 405);
  assert.equal(method.json().error.code, 'METHOD_NOT_ALLOWED');
  assert.equal(method.headers.allow, 'POST');
});

test('validates the JSON body, session id, question, and body size', async () => {
  const { host } = hostFor();
  assert.equal((await call(host, makeReq({ body: '{' }))).status, 400);
  assert.equal((await call(host, makeReq({ body: JSON.stringify({ sessionId: '', question: 'q' }) }))).status, 400);
  assert.equal((await call(host, makeReq({ body: JSON.stringify({ sessionId: 'sess-1', question: '   ' }) }))).status, 400);
  assert.equal((await call(host, makeReq({ body: JSON.stringify({ sessionId: 'sess-1', question: 'x'.repeat(4001) }) }))).status, 400);
  const oversizedReq = makeReq({ body: JSON.stringify({ sessionId: 'sess-1', question: 'x'.repeat(33000) }) });
  const oversized = await call(host, oversizedReq);
  assert.equal(oversized.status, 413);
  assert.equal(oversized.json().error.code, 'TOO_LARGE');
  // Draining must not reset the connection before the 413 can be written.
  assert.equal(oversizedReq.destroyed, false);
});

test('reports a missing live agent and a missing model route as JSON errors', async () => {
  const { host } = hostFor({ agent: fakeAgent({ options: {}, header: undefined }) });
  const noRoute = await call(host, makeReq());
  assert.equal(noRoute.status, 409);
  assert.equal(noRoute.json().error.code, 'NO_MODEL_ROUTE');
  const other = hostFor();
  const missing = await call(other.host, makeReq({ body: JSON.stringify({ sessionId: 'nope', question: 'q' }) }));
  assert.equal(missing.status, 409);
  assert.equal(missing.json().error.code, 'NO_LIVE_AGENT');
});

test('a snapshot failure is contained as JSON 500 SNAPSHOT_FAILED', async () => {
  const broken = fakeAgent({ header: headerConfig });
  broken.session.deriveMessages = () => {
    throw new Error('surface unavailable');
  };
  const { host } = hostFor({ agent: broken });
  const res = await call(host, makeReq());
  assert.equal(res.status, 500);
  assert.equal(res.json().error.code, 'SNAPSHOT_FAILED');
});

test('streams delta frames then one done frame, and sends the tool-less envelope', async () => {
  const recorded = [];
  async function* okStream() {
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'Hello ' };
    yield { type: 'text-delta', index: 0, text: 'side.' };
    yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 2, cacheReadTokens: 900 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
  const agent = fakeAgent({ header: headerConfig, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });
  const llm = { stream: (options) => { recorded.push(options); return okStream(); } };
  const res = await call(hostFor({ agent, llm }).host, makeReq());
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/x-ndjson/);
  assert.equal(res.ended, true);
  const frames = parseFrames(res.body());
  assert.deepEqual(frames.filter((f) => f.type === 'delta').map((f) => f.text), ['Hello ', 'side.']);
  const done = frames.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.finish, 'stop');
  assert.equal(done.usage.cacheReadTokens, 900);
  assert.equal(done.continuations, undefined);
  assert.equal(recorded.length, 1);
  const options = recorded[0];
  for (const key of ['tools', 'toolHistory', 'system', 'purpose']) assert.ok(!(key in options), key);
  assert.equal(options.provider, 'deepseek-official');
  // 8192 by default: 1200 was small enough that thinking alone could eat it.
  assert.equal(options.maxTokens, 8192);
  assert.equal(options.sessionId, 'sess-1');
  assert.equal(options.messages.at(-1).content[0].text.endsWith('why?'), true);
  assert.ok(options.signal instanceof AbortSignal);
});

test('forward progress frames while the model is thinking', async () => {
  const llm = {
    stream: (options) => streamOf([
      { type: 'reasoning-delta', index: 0, text: 'x'.repeat(250) },
      { type: 'reasoning-delta', index: 0, text: 'y'.repeat(250) },
      { type: 'text-delta', index: 0, text: 'answer' },
    ], { kind: 'stop' })(options),
  };
  const res = await call(hostFor({ agent: fakeAgent({ header: headerConfig }), llm }).host, makeReq());
  const frames = parseFrames(res.body());
  const progress = frames.filter((frame) => frame.type === 'progress');
  assert.ok(progress.length >= 1, 'expected at least one progress frame');
  assert.equal(progress.at(-1).reasoningChars, 500);
  assert.equal(frames.at(-1).type, 'done');
  assert.equal(frames.at(-1).reasoningChars, 500);
});

test('a truncated answer continues from the partial text instead of stopping', async () => {
  const llm = scriptedLlm([
    () => streamOf([{ type: 'text-delta', index: 0, text: 'The first half of the answer' }], { kind: 'max-tokens' })(),
    () => streamOf([{ type: 'text-delta', index: 0, text: ', and the rest of it.' }], { kind: 'stop' })(),
  ]);
  const res = await call(hostFor({ agent: fakeAgent({ header: headerConfig }), llm }).host, makeReq());
  const frames = parseFrames(res.body());
  assert.deepEqual(
    frames.filter((frame) => frame.type === 'delta').map((frame) => frame.text),
    ['The first half of the answer', ', and the rest of it.'],
  );
  const done = frames.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.finish, 'stop');
  assert.equal(done.continuations, 1);
  assert.equal(llm.calls.length, 2);
  const second = llm.calls[1];
  // Continuations finish the existing sentence; re-thinking would spend the
  // budget twice on the same problem.
  assert.equal(second.reasoningEffort, 'off');
  assert.deepEqual(second.messages.slice(-2).map((message) => message.role), ['assistant', 'user']);
  assert.equal(second.messages.at(-2).content[0].text, 'The first half of the answer');
  assert.match(second.messages.at(-1).content[0].text, /Continue exactly where you stopped/);
  // The replayed prefix is append-only, so the provider cache still applies.
  assert.deepEqual(
    second.messages.slice(0, -2).map((message) => message.role),
    llm.calls[0].messages.map((message) => message.role),
  );
});

test('a budget spent entirely on thinking retries once without thinking', async () => {
  const llm = scriptedLlm([
    () => streamOf([{ type: 'reasoning-delta', index: 0, text: 'z'.repeat(900) }], { kind: 'max-tokens' })(),
    () => streamOf([{ type: 'text-delta', index: 0, text: 'A real answer.' }], { kind: 'stop' })(),
  ]);
  const res = await call(hostFor({ agent: fakeAgent({ header: headerConfig }), llm }).host, makeReq());
  const frames = parseFrames(res.body());
  const done = frames.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.finish, 'stop');
  assert.equal(llm.calls.length, 2);
  assert.equal(llm.calls[1].reasoningEffort, 'off');
  // The fallback re-asks the same question; it does not append a turn.
  assert.equal(llm.calls[1].messages.length, llm.calls[0].messages.length);
  assert.deepEqual(frames.filter((frame) => frame.type === 'delta').map((frame) => frame.text), ['A real answer.']);
});

test('a route that rejects the thinking-off override still finishes the answer', async () => {
  const llm = scriptedLlm([
    () => streamOf([{ type: 'text-delta', index: 0, text: 'First half' }], { kind: 'max-tokens' })(),
    () => (async function* () {
      throw Object.assign(new Error('this model offers no "off" level'), { code: 'UNSUPPORTED_REASONING_EFFORT' });
    })(),
    () => streamOf([{ type: 'text-delta', index: 0, text: ' and the rest.' }], { kind: 'stop' })(),
  ]);
  const res = await call(hostFor({ agent: fakeAgent({ header: headerConfig }), llm }).host, makeReq());
  const frames = parseFrames(res.body());
  assert.equal(llm.calls.length, 3);
  assert.equal(llm.calls[1].reasoningEffort, 'off');
  // The retry inherits the routed effort instead of forcing "off" again.
  assert.equal(llm.calls[2].reasoningEffort, 'max');
  const done = frames.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.finish, 'stop');
  assert.deepEqual(
    frames.filter((frame) => frame.type === 'delta').map((frame) => frame.text),
    ['First half', ' and the rest.'],
  );
});

test('continuations are bounded and a still-truncated answer says so', async () => {
  const llm = scriptedLlm([
    () => streamOf([{ type: 'text-delta', index: 0, text: 'more' }], { kind: 'max-tokens' })(),
  ]);
  const res = await call(hostFor({ agent: fakeAgent({ header: headerConfig }), llm, config: { continuations: 1 } }).host, makeReq());
  const frames = parseFrames(res.body());
  assert.equal(llm.calls.length, 2);
  const done = frames.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.finish, 'max-tokens');
  assert.equal(done.continuations, 1);
});

test('continuations can be disabled entirely', async () => {
  const llm = scriptedLlm([
    () => streamOf([{ type: 'text-delta', index: 0, text: 'cut' }], { kind: 'max-tokens' })(),
  ]);
  const res = await call(hostFor({ agent: fakeAgent({ header: headerConfig }), llm, config: { continuations: 0 } }).host, makeReq());
  const frames = parseFrames(res.body());
  assert.equal(llm.calls.length, 1);
  assert.equal(frames.at(-1).finish, 'max-tokens');
});

test('a terminal failure becomes exactly one error frame and the stream ends', async () => {
  const llm = {
    stream: async function* () {
      yield { type: 'text-delta', index: 0, text: 'partial' };
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'slow down' } } };
    },
  };
  const res = await call(hostFor({ agent: fakeAgent({ header: headerConfig }), llm }).host, makeReq());
  const frames = parseFrames(res.body());
  assert.deepEqual(frames.filter((frame) => frame.type === 'error'), [{ type: 'error', code: 'RATE_LIMIT', message: 'slow down' }]);
  assert.equal(frames.filter((frame) => frame.type === 'done').length, 0);
  // The partial text still reached the browser before the failure.
  assert.deepEqual(frames.filter((frame) => frame.type === 'delta').map((frame) => frame.text), ['partial']);
});

test('a thrown stream error still produces one error frame', async () => {
  const llm = {
    stream: async function* () {
      throw new Error('boom');
    },
  };
  const res = await call(hostFor({ agent: fakeAgent({ header: headerConfig }), llm }).host, makeReq());
  const frames = parseFrames(res.body());
  assert.equal(frames.at(-1).type, 'error');
  assert.equal(frames.at(-1).message, 'boom');
});

test('closing the response aborts the provider signal; the deadline aborts too', async () => {
  const seen = [];
  const llm = {
    stream: async function* (options) {
      seen.push(options.signal);
      await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
      yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'client left' } } };
    },
  };
  const req = makeReq();
  const res = makeRes();
  const pending = hostFor({ agent: fakeAgent({ header: headerConfig }), llm }).host.handleRequest(req, res);
  await waitUntil('the provider stream to start', () => seen.length > 0);
  res.emit('close');
  await pending;
  assert.equal(seen[0].aborted, true);
  const timed = hostFor({ agent: fakeAgent({ header: headerConfig }), llm, config: { timeoutMs: 20 } }).host;
  const frames = parseFrames((await call(timed, makeReq())).body());
  assert.equal(frames.at(-1).type, 'error');
});

test('a stalled stream reports STALLED and keeps the partial text', async () => {
  const llm = {
    stream: (options) => (async function* () {
      yield { type: 'text-delta', index: 0, text: 'half an answer' };
      await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
    })(),
  };
  const { host } = hostFor({
    agent: fakeAgent({ header: headerConfig }),
    llm,
    config: { stallTimeoutMs: 30, continuations: 0 },
  });
  const frames = parseFrames((await call(host, makeReq())).body());
  assert.deepEqual(frames.filter((frame) => frame.type === 'delta').map((frame) => frame.text), ['half an answer']);
  const error = frames.at(-1);
  assert.equal(error.type, 'error');
  assert.equal(error.code, 'STALLED');
  assert.match(error.message, /stopped sending output/);
});

test('the overall deadline reports DEADLINE rather than a bare abort', async () => {
  const llm = {
    stream: (options) => (async function* () {
      await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
    })(),
  };
  const { host } = hostFor({
    agent: fakeAgent({ header: headerConfig }),
    llm,
    config: { deadlineMs: 30, stallTimeoutMs: 60000 },
  });
  const frames = parseFrames((await call(host, makeReq())).body());
  const error = frames.at(-1);
  assert.equal(error.type, 'error');
  assert.equal(error.code, 'DEADLINE');
  assert.match(error.message, /deadline/);
});

test('a real client disconnect aborts the provider call (real node:http socket)', async () => {
  const seen = [];
  const llm = {
    stream: async function* (options) {
      seen.push(options);
      await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
      yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'client left' } } };
    },
  };
  const { host } = hostFor({ agent: fakeAgent({ header: headerConfig }), llm, config: { deadlineMs: 8000 } });
  const server = http.createServer((req, res) => {
    void host.handleRequest(req, res).catch(() => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const client = http.request({
      host: '127.0.0.1', port, path: '/btw/ask', method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    client.on('error', () => {});
    client.write(JSON.stringify({ sessionId: 'sess-1', question: 'why?' }));
    client.end();
    await waitUntil('the provider stream to start', () => seen.length > 0);
    client.destroy();
    await waitUntil(
      'the provider signal to abort after the client destroyed the socket',
      () => seen[0].signal.aborted === true,
    );
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a real oversized body receives HTTP 413 TOO_LARGE instead of a reset', async () => {
  const { host } = hostFor();
  const server = http.createServer((req, res) => {
    void host.handleRequest(req, res).catch(() => {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/btw/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'sess-1', question: 'x'.repeat(40000) }),
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error.code, 'TOO_LARGE');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
