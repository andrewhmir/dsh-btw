import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT_MS, MAX_QUESTION_CHARS } from '../src/host/config.mjs';
import { SIDE_QUESTION_INSTRUCTION, buildSideQuestionMessage, buildRequestEnvelope, sanitizeHistory } from '../src/host/prompt.mjs';

const history = Object.freeze([
  Object.freeze({ role: 'system', content: Object.freeze([{ type: 'text', text: 'SYSTEM PROMPT' }]) }),
  Object.freeze({ role: 'user', content: Object.freeze([{ type: 'text', text: 'earlier question' }]) }),
]);

function fakeAgent({ header, options, id = 'sess-1' } = {}) {
  const session = {
    id,
    requestHeader: () => header,
    deriveMessages: () => history,
  };
  return { session, options: options ?? {} };
}

test('resolveConfig applies defaults and rejects non-positive numbers', () => {
  assert.deepEqual(resolveConfig(undefined), { maxTokens: DEFAULT_MAX_TOKENS, timeoutMs: DEFAULT_TIMEOUT_MS });
  assert.deepEqual(resolveConfig({ maxTokens: 64, timeoutMs: 5000 }), { maxTokens: 64, timeoutMs: 5000 });
  assert.deepEqual(resolveConfig({ maxTokens: -1, timeoutMs: 'x' }), { maxTokens: DEFAULT_MAX_TOKENS, timeoutMs: DEFAULT_TIMEOUT_MS });
  assert.equal(MAX_QUESTION_CHARS, 4000);
});

test('the side-question message is the instruction plus the question, deep-frozen', () => {
  const message = buildSideQuestionMessage('why does it work?');
  assert.equal(message.role, 'user');
  assert.equal(message.content.length, 1);
  assert.equal(message.content[0].type, 'text');
  assert.equal(message.content[0].text, SIDE_QUESTION_INSTRUCTION + '\n' + 'why does it work?');
  assert.ok(SIDE_QUESTION_INSTRUCTION.includes('no tools'));
  assert.ok(Object.isFrozen(message) && Object.isFrozen(message.content));
});

test('envelope inherits the routed header and appends exactly one message', () => {
  const agent = fakeAgent({ header: { config: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max', temperature: 0.3 } } });
  const env = buildRequestEnvelope({ agent, question: 'q?', maxTokens: 1200 });
  assert.equal(env.provider, 'deepseek-official');
  assert.equal(env.model, 'deepseek-flash');
  assert.equal(env.reasoningEffort, 'max');
  assert.equal(env.temperature, 0.3);
  assert.equal(env.maxTokens, 1200);
  assert.equal(env.sessionId, 'sess-1');
  assert.ok(Object.isFrozen(env.messages));
  assert.equal(env.messages.length, history.length + 1);
  assert.equal(env.messages[env.messages.length - 1].content[0].text, SIDE_QUESTION_INSTRUCTION + '\n' + 'q?');
  for (const key of ['tools', 'toolHistory', 'system', 'purpose']) assert.ok(!(key in env), key);
});

test('envelope falls back to agent options and omits absent sampling fields', () => {
  const env = buildRequestEnvelope({ agent: fakeAgent({ options: { provider: 'p', model: 'm' } }), question: 'q', maxTokens: 100 });
  assert.equal(env.provider, 'p');
  assert.equal(env.model, 'm');
  assert.ok(!('reasoningEffort' in env));
  assert.ok(!('temperature' in env));
});

test('envelope fails loud when no model route is available', () => {
  assert.throws(
    () => buildRequestEnvelope({ agent: fakeAgent(), question: 'q', maxTokens: 100 }),
    (error) => error.code === 'NO_MODEL_ROUTE',
  );
});

// A mid-turn snapshot can end with an assistant tool call whose tool/result
// event is not committed yet. Appending the side question then produces
// "DeepSeek Messages tool calls need immediate results" (the adapter's
// INVALID_REQUEST), so the replayed prefix must be trimmed to a resolved step.
const call = (id) => ({ type: 'tool-call', id, name: 'pwsh', arguments: '{}' });
const toolResult = (id) => ({ role: 'tool', toolCallId: id, content: [{ type: 'text', text: 'ok' }] });
const assistantWith = (...content) => ({ role: 'assistant', content });

test('sanitizeHistory leaves a fully resolved history unchanged', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'run it' }] },
    assistantWith(call('c1')),
    toolResult('c1'),
    assistantWith({ type: 'text', text: 'done' }),
  ];
  const { messages: kept, trimmed } = sanitizeHistory(messages);
  assert.equal(trimmed, 0);
  assert.equal(kept.length, messages.length);
});

test('sanitizeHistory drops a trailing assistant tool call with no result', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'run it' }] },
    assistantWith({ type: 'text', text: 'running' }, call('c1')),
  ];
  const { messages: kept, trimmed } = sanitizeHistory(messages);
  assert.equal(trimmed, 1);
  assert.deepEqual(kept.map((m) => m.role), ['user']);
});

test('sanitizeHistory drops a partially resolved call batch and its trailing results', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'run both' }] },
    assistantWith(call('c1'), call('c2')),
    toolResult('c1'),
  ];
  const { messages: kept, trimmed } = sanitizeHistory(messages);
  assert.equal(trimmed, 2);
  assert.deepEqual(kept.map((m) => m.role), ['user']);
});

test('sanitizeHistory drops orphan tool results', () => {
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    toolResult('missing'),
  ];
  const { messages: kept, trimmed } = sanitizeHistory(messages);
  assert.equal(trimmed, 1);
  assert.deepEqual(kept.map((m) => m.role), ['user']);
});

test('the envelope never appends the side question after an unresolved tool call', () => {
  const agent = fakeAgent({ header: { config: { provider: 'p', model: 'm' } } });
  agent.session.deriveMessages = () => ([
    { role: 'user', content: [{ type: 'text', text: 'run it' }] },
    assistantWith(call('c1')),
  ]);
  const env = buildRequestEnvelope({ agent, question: 'q?', maxTokens: 100 });
  assert.deepEqual(env.messages.map((m) => m.role), ['user', 'user']);
  assert.equal(env.messages.at(-1).content[0].text.endsWith('q?'), true);
  const unresolved = env.messages
    .filter((m) => m.role === 'assistant')
    .flatMap((m) => m.content.filter((b) => b.type === 'tool-call'));
  assert.equal(unresolved.length, 0);
});
