import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBtwLine, makeBtwClaim, createBtwSource, BTW_HINT } from '../src/client/trigger.mjs';

const session = { sessionId: 'sess-1' };
const signal = new AbortController().signal;

test('parseBtwLine claims only a leading /btw command line', () => {
  assert.deepEqual(parseBtwLine('/btw hello there'), { token: '/btw', question: 'hello there' });
  assert.deepEqual(parseBtwLine('  /BTW   spaced   '), { token: '/BTW', question: 'spaced' });
  assert.deepEqual(parseBtwLine('/btw'), { token: '/btw', question: '' });
  for (const line of ['/btwx nope', 'foo /btw nope', '/btw\nsecond line', '/ btw x', 'hello']) {
    assert.equal(parseBtwLine(line), undefined, JSON.stringify(line));
  }
});

test('claims trim arguments and refuse empty or over-long questions locally', async () => {
  const calls = [];
  const claim = makeBtwClaim({ sessionId: 'sess-1', submitQuestion: (sid, q) => { calls.push([sid, q]); return { kind: 'success' }; } });
  assert.equal(claim.name, 'btw');
  assert.equal(claim.token, '/btw ');
  assert.equal(claim.hint, BTW_HINT);
  assert.deepEqual(await claim.submit('   '), { kind: 'error', text: 'Usage: /btw <question>' });
  assert.equal(calls.length, 0);
  const long = await claim.submit('x'.repeat(4001));
  assert.equal(long.kind, 'error');
  assert.match(long.text, /too long/);
  assert.deepEqual(await claim.submit(' real question '), { kind: 'success' });
  assert.deepEqual(calls, [['sess-1', 'real question']]);
});

test('matchEnter claims the line and refuses attachments', async () => {
  const source = createBtwSource({ submitQuestion: () => ({ kind: 'success' }) });
  const outcome = await source.matchEnter(session, '/btw hello', signal, { attachments: 0 });
  assert.equal(outcome.claim.name, 'btw');
  assert.deepEqual(outcome.claim.submit('hello'), { kind: 'success' });
  assert.equal(await source.matchEnter(session, 'not a command', signal, { attachments: 0 }), undefined);
  await assert.rejects(
    source.matchEnter(session, '/btw with image', signal, { attachments: 1 }),
    /does not accept attachments/,
  );
});

test('matchSpace and matchClaim resolve the bare token without acting', () => {
  const source = createBtwSource({ submitQuestion: () => { throw new Error('must not submit'); } });
  assert.equal(source.matchSpace(session, '/btw').claim.token, '/btw ');
  assert.equal(source.matchSpace(session, '/model'), undefined);
  return source.matchClaim(session, '/btw', signal).then((claim) => assert.equal(claim.token, '/btw '));
});

test('the menu row is discoverable and picks to a claim', async () => {
  const source = createBtwSource({ submitQuestion: () => ({ kind: 'success' }) });
  assert.equal(source.trigger, '/');
  assert.equal(source.name, 'btw');
  const rows = await source.candidates(session, { query: 'bt', position: 'leading', drilled: false, signal });
  assert.deepEqual(rows.map((r) => r.name), ['btw']);
  assert.match(rows[0].description, /conversation/i);
  assert.equal((await source.candidates(session, { query: 'zzz', position: 'leading', drilled: false, signal })).length, 0);
  const pick = source.onPick({ candidate: { name: 'btw' }, session, position: 'leading', via: 'menu', action: 'pick', span: { from: 0, to: 4, rev: 0 } });
  assert.equal(pick.claim.name, 'btw');
});

test('a typed spelling is preserved in the claim token so args survive case-sensitive argsAfter', async () => {
  // The harness computes a claim's arguments with a case-sensitive
  // `argsAfter(draft, claim.token)`; a fixed '/btw ' token would drop the
  // question for '/BTW ...'. Mirror that logic here.
  const argsAfter = (draft, token) => (draft.startsWith(token) ? draft.slice(token.length) : '');
  const submitted = [];
  const source = createBtwSource({ submitQuestion: (sid, q) => { submitted.push([sid, q]); return { kind: 'success' }; } });

  const upper = await source.matchEnter(session, '/BTW What is up?', signal, { attachments: 0 });
  assert.equal(upper.claim.token, '/BTW ');
  assert.equal(argsAfter('/BTW What is up?', upper.claim.token), 'What is up?');
  assert.equal((await upper.claim.submit(argsAfter('/BTW What is up?', upper.claim.token))).kind, 'success');
  assert.deepEqual(submitted, [['sess-1', 'What is up?']]);

  const spaced = source.matchSpace(session, '/bTw');
  assert.equal(spaced.claim.token, '/bTw ');
  const restored = await source.matchClaim(session, '/BTW', signal);
  assert.equal(restored.token, '/BTW ');
});

test('the claim accepts the harness attachment envelope and refuses attachments on every path', async () => {
  const submitted = [];
  const claim = makeBtwClaim({ sessionId: 'sess-1', submitQuestion: (sid, q) => { submitted.push(q); return { kind: 'success' }; } });
  assert.equal(claim.attachments, true);
  const refused = await claim.submit('question', {}, [{ type: 'image' }]);
  assert.equal(refused.kind, 'error');
  assert.match(refused.text, /does not accept attachments/);
  assert.equal(submitted.length, 0);
  const ok = await claim.submit('question', {}, []);
  assert.equal(ok.kind, 'success');
  assert.deepEqual(submitted, ['question']);
});
