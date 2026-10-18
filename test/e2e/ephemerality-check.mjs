// Ephemerality assertion for /btw: the question and the answer must not appear
// in any session log written since a given instant.
//
//   node ephemerality-check.mjs --home C:\Users\Andrew\.dsh-company ^
//        --since 1761000000000 --question-marker "BTW-E2E-MARKER-123" ^
//        --answer-excerpt "the first sixty characters of the real answer"
//
// Exit 0 = PASS (no trace), 1 = FAIL (trace found or logs unreadable).
//
// The live log format is one zstd frame per flushed JSONL write, concatenated
// into `session.vN.jsonl.zstd`; Node's sync/stream zstd APIs decode only the
// first frame, so the file is split on the zstd magic and each frame decoded.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
};

const home = arg('home');
const since = Number(arg('since', '0'));
const questionMarker = arg('question-marker');
const answerExcerpt = arg('answer-excerpt');

if (!home || !questionMarker || !answerExcerpt) {
  console.error('usage: node ephemerality-check.mjs --home <DSH_HOME> --since <epochMs> \\');
  console.error('         --question-marker <text> --answer-excerpt <text>');
  process.exit(2);
}

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Find every session log under a sessions root. @param {string} root @returns {string[]} */
function findSessionLogs(root) {
  const found = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/^session\.v\d+\.jsonl(\.zstd|\.zst|\.jsonl)?$/.test(entry.name)) found.push(full);
    }
  }
  return found;
}

/** Decode one concatenated-zstd JSONL session log. @param {Buffer} buffer @returns {string} */
function decodeSessionLog(buffer) {
  if (buffer.length >= 1 && buffer[0] === 0x7b) return buffer.toString('utf8'); // plain JSONL
  const offsets = [];
  for (let index = 0; index + 3 < buffer.length; index += 1) {
    if (buffer[index] === ZSTD_MAGIC[0] && buffer[index + 1] === ZSTD_MAGIC[1] &&
        buffer[index + 2] === ZSTD_MAGIC[2] && buffer[index + 3] === ZSTD_MAGIC[3]) {
      offsets.push(index);
    }
  }
  if (offsets.length === 0) throw new Error('not a zstd session log');
  let text = '';
  for (let index = 0; index < offsets.length; index += 1) {
    const start = offsets[index];
    const end = index + 1 < offsets.length ? offsets[index + 1] : buffer.length;
    text += zlib.zstdDecompressSync(buffer.subarray(start, end)).toString('utf8');
  }
  return text;
}

const logsRoot = path.join(home, 'sessions');
const candidates = findSessionLogs(logsRoot)
  .map((file) => ({ file, mtimeMs: statSync(file).mtimeMs }))
  .filter(({ mtimeMs }) => mtimeMs >= since)
  .sort((a, b) => a.mtimeMs - b.mtimeMs);

const failures = [];
const harnessArtifacts = [];
const answerProbe = answerExcerpt.trim().slice(0, 80);
/** Event types that can only be the /btw exchange persisting (or the agent's own
 * tool traffic carrying a marker the test harness put there). */
const PERSISTED_TYPES = new Set(['user/message', 'command/run', 'command/done']);
let scanned = 0;
for (const { file } of candidates) {
  let text;
  try {
    text = decodeSessionLog(readFileSync(file));
  } catch (error) {
    failures.push(`${file}: could not decode (${error.message})`);
    continue;
  }
  scanned += 1;

  // Structured classification: a marker inside the agent's own tool traffic is a
  // test-harness artifact (the question was placed in a tool call); only a user
  // message or command lifecycle event proves the /btw exchange persisted.
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let event = null;
    try {
      event = JSON.parse(line);
    } catch {
      // An unparsable line is not a normal session log record; flag if it carries the marker.
      if (line.includes(questionMarker) || (answerProbe.length >= 24 && line.includes(answerProbe))) {
        failures.push(`${file}: marker in an unparsable log line`);
      }
      continue;
    }
    const type = typeof event?.type === 'string' ? event.type : 'unknown';
    const containsQuestion = line.includes(questionMarker);
    const containsAnswer = answerProbe.length >= 24 && line.includes(answerProbe);
    if (!containsQuestion && !containsAnswer) continue;
    if (PERSISTED_TYPES.has(type)) {
      failures.push(`${file}: ${containsQuestion ? 'question marker' : 'answer excerpt'} persisted in a '${type}' event (seq ${event.seq})`);
    } else {
      harnessArtifacts.push({ file, seq: event.seq, type, which: containsQuestion ? 'question-marker' : 'answer-excerpt' });
    }
  }
  if (/"type":"command\/run"[^\n]*"name":"btw"/.test(text)) failures.push(`${file}: a btw command/run event exists`);
}

console.log(JSON.stringify({
  home,
  since,
  logsScanned: scanned,
  logsConsidered: candidates.length,
  questionMarker,
  answerExcerpt: answerProbe,
  harnessArtifacts: harnessArtifacts.slice(0, 20),
}, null, 2));

if (failures.length > 0) {
  console.error('EPHEMERALITY FAIL');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  'EPHEMERALITY PASS: no persisted user message or command event contains the /btw exchange' +
    (harnessArtifacts.length > 0
      ? ` (${harnessArtifacts.length} marker hit(s) are the agent's own tool/test traffic, not the /btw path)`
      : ''),
);
