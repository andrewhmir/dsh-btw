import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNdjsonStream, askBtw } from '../src/client/stream.mjs';

function bodyFrom(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

function recorder() {
  const events = [];
  return {
    events,
    handlers: {
      onDelta: (text) => events.push(['delta', text]),
      onDone: (frame) => events.push(['done', frame.finish, frame.usage?.cacheReadTokens]),
      onError: (error) => events.push(['error', error.code, error.message]),
    },
  };
}

test('parses NDJSON split across arbitrary chunk boundaries, including CRLF', async () => {
  const { events, handlers } = recorder();
  await readNdjsonStream(bodyFrom([
    '{"type":"delta","text":"He',
    'llo"}\r\n{"type":"delta","text":"!"}\n{"type":"done","finish":"stop","usage":{"cacheReadTokens":7}}\n',
  ]), handlers);
  assert.deepEqual(events, [['delta', 'Hello'], ['delta', '!'], ['done', 'stop', 7]]);
});

test('malformed JSON and error frames surface as a single error', async () => {
  const { events, handlers } = recorder();
  await readNdjsonStream(bodyFrom(['not json\n']), handlers);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], ['error', 'CORRUPT_STREAM', 'The side answer stream was corrupted.']);
  const second = recorder();
  await readNdjsonStream(bodyFrom(['{"type":"error","code":"AUTH","message":"bad key"}\n']), second.handlers);
  assert.deepEqual(second.events, [['error', 'AUTH', 'bad key']]);
});

test('askBtw posts the right body and forwards a successful stream', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push([url, init]);
    return new Response(bodyFrom(['{"type":"delta","text":"ok"}\n{"type":"done","finish":"stop"}\n']), { status: 200 });
  };
  const { events, handlers } = recorder();
  await askBtw({ url: '/btw/ask', sessionId: 's1', question: 'q', signal: new AbortController().signal, fetchImpl, handlers });
  assert.equal(seen[0][0], '/btw/ask');
  assert.equal(seen[0][1].method, 'POST');
  assert.equal(seen[0][1].credentials, 'same-origin');
  assert.deepEqual(JSON.parse(seen[0][1].body), { sessionId: 's1', question: 'q' });
  assert.deepEqual(events, [['delta', 'ok'], ['done', 'stop', undefined]]);
});

test('askBtw maps non-2xx JSON errors and network throws to onError; aborts are silent', async () => {
  const jsonError = recorder();
  await askBtw({
    url: '/btw/ask', sessionId: 's1', question: 'q',
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'NO_LIVE_AGENT', message: 'gone' } }), { status: 409 }),
    handlers: jsonError.handlers,
  });
  assert.deepEqual(jsonError.events, [['error', 'NO_LIVE_AGENT', 'gone']]);

  const network = recorder();
  await askBtw({
    url: '/btw/ask', sessionId: 's1', question: 'q',
    fetchImpl: async () => {
      throw Object.assign(new Error('down'), { code: 'NETWORK' });
    },
    handlers: network.handlers,
  });
  assert.deepEqual(network.events, [['error', 'NETWORK', 'down']]);

  const aborted = recorder();
  await askBtw({
    url: '/btw/ask', sessionId: 's1', question: 'q',
    fetchImpl: async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    },
    handlers: aborted.handlers,
  });
  assert.equal(aborted.events.length, 0);
});
