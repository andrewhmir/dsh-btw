import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT_MS, MAX_QUESTION_CHARS } from '../src/host/config.mjs';
import { SIDE_QUESTION_INSTRUCTION, buildSideQuestionMessage, buildRequestEnvelope } from '../src/host/prompt.mjs';

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
