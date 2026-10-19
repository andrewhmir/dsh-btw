// Focused sensitivity + behaviour tests for the /btw ephemerality checker.
// The checker is the load-bearing verification for strict parity, so it must be
// proven to flag persisted exchanges (not just to pass on clean logs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { scanHome } from '../test/e2e/ephemerality-check.mjs';

function makeHome(lines, fileName = 'session.v4.jsonl.zstd') {
  const root = mkdtempSync(path.join(tmpdir(), 'btw-ephem-'));
  const sessionDir = path.join(root, 'sessions', 'ws', 'sess-1');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(path.join(sessionDir, fileName), zlib.zstdCompressSync(Buffer.from(lines.join('\n'), 'utf8')));
  return root;
}

const clean = [JSON.stringify({ type: 'session', version: 4, id: 'sess-1' })];

test('a clean session log passes', () => {
  const home = makeHome(clean);
  try {
    const result = scanHome({ home, since: 0, questionMarker: 'MARK', answerExcerpt: 'unused' });
    assert.deepEqual(result.failures, []);
    assert.equal(result.scanned, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a persisted question as a user message fails', () => {
  const home = makeHome([...clean, JSON.stringify({
    type: 'user/message', seq: 1,
    data: { message: { role: 'user', content: [{ type: 'text', text: '/btw MARK question' }] } },
  })]);
  try {
    const result = scanHome({ home, since: 0, questionMarker: 'MARK', answerExcerpt: 'unused' });
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /user\/message/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a persisted side answer as an assistant message fails on the excerpt', () => {
  const home = makeHome([...clean, JSON.stringify({
    type: 'assistant/message', seq: 2,
    data: { message: { role: 'assistant', content: [{ type: 'text', text: 'Here is the side answer: DISTINCTIVE-ANSWER-TEXT-FOR-TEST.' }] } },
  })]);
  try {
    const result = scanHome({ home, since: 0, questionMarker: 'MARK', answerExcerpt: 'DISTINCTIVE-ANSWER-TEXT-FOR-TEST' });
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /assistant\/message/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a question marker in the agent tool traffic is reported as an artifact, not a failure', () => {
  const home = makeHome([...clean, JSON.stringify({
    type: 'tool/call', seq: 3,
    data: { toolName: 'ask_user_question', arguments: { question: 'run /btw MARK please' } },
  })]);
  try {
    const result = scanHome({ home, since: 0, questionMarker: 'MARK', answerExcerpt: 'unused' });
    assert.deepEqual(result.failures, []);
    assert.equal(result.artifacts.length, 1);
    assert.equal(result.artifacts[0].type, 'tool/call');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
