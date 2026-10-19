// Ephemerality assertion for /btw: the question and the answer must not appear
// in any session log written since a given instant.
//
//   node ephemerality-check.mjs --home C:\Users\Andrew\.dsh-company ^
//        --since 1761000000000 --question-marker "BTW-E2E-MARKER-123" ^
//        --answer-excerpt "the first sixty characters of the real answer"
//
// Exit 0 = PASS (no persisted trace), 1 = FAIL, 2 = usage.
//
// Classification rules (from the review fix pass):
//   * the ANSWER excerpt must not appear in ANY event type — a side answer has
//     no legitimate reason to be persisted anywhere;
//   * the QUESTION marker fails only in event types that prove it persisted as
//     conversation or command state (`user/message`, `command/run`,
//     `command/done`); inside agent tool/test traffic it is a harness artifact
//     (the test harness injected the marker through a tool call) and is
//     reported, not failed.
//
// The live log format is one zstd frame per flushed JSONL write, concatenated
// into `session.vN.jsonl.zstd`; Node's sync/stream zstd APIs decode only the
// first frame, so the file is split on the zstd magic and each frame decoded.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Event types that prove a persisted conversation/command record. */
const PERSISTED_TYPES = new Set(['user/message', 'command/run', 'command/done']);

/** Find every session log under a sessions root. @param {string} root @returns {string[]} */
export function findSessionLogs(root) {
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
export function decodeSessionLog(buffer) {
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

/**
 * Scan every session log in a home written since `since` for a persisted /btw exchange.
 * @param {object} input - scan input.
 * @param {string} input.home - DSH home (sessions live under `<home>/sessions`).
 * @param {number} [input.since] - epoch milliseconds; 0 scans everything.
 * @param {string} input.questionMarker - unique question text to look for.
 * @param {string} [input.answerExcerpt] - distinguishing answer text to look for.
 * @returns {{scanned: number, considered: number, failures: string[], artifacts: Array<object>}} scan result.
 */
export function scanHome({ home, since = 0, questionMarker, answerExcerpt }) {
  const answerProbe = (answerExcerpt ?? '').trim().slice(0, 80);
  const logsRoot = path.join(home, 'sessions');
  const candidates = findSessionLogs(logsRoot)
    .map((file) => ({ file, mtimeMs: statSync(file).mtimeMs }))
    .filter(({ mtimeMs }) => mtimeMs >= since)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  const failures = [];
  const artifacts = [];
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

    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      const hasQuestion = line.includes(questionMarker);
      const hasAnswer = answerProbe.length >= 24 && line.includes(answerProbe);
      if (!hasQuestion && !hasAnswer) continue;

      let event = null;
      try {
        event = JSON.parse(line);
      } catch {
        failures.push(`${file}: marker in an unparsable log line`);
        continue;
      }
      const type = typeof event?.type === 'string' ? event.type : 'unknown';
      const seq = event?.seq;
      if (hasAnswer) {
        // An answer has no legitimate persistence site: fail on every event type.
        failures.push(`${file}: answer excerpt persisted in a '${type}' event (seq ${seq})`);
      }
      if (hasQuestion) {
        if (PERSISTED_TYPES.has(type)) {
          failures.push(`${file}: question marker persisted in a '${type}' event (seq ${seq})`);
        } else {
          artifacts.push({ file, seq, type, which: 'question-marker' });
        }
      }
    }
    if (/"type":"command\/run"[^\n]*"name":"btw"/.test(text)) failures.push(`${file}: a btw command/run event exists`);
  }
  return { scanned, considered: candidates.length, failures, artifacts };
}

/**
 * CLI entry. @param {string[]} [argv] @returns {number} exit code.
 */
export function main(argv = process.argv.slice(2)) {
  const arg = (name, fallback) => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : fallback;
  };
  const home = arg('home');
  const since = arg('since');
  const questionMarker = arg('question-marker');
  const answerExcerpt = arg('answer-excerpt');
  if (!home || !questionMarker || !answerExcerpt) {
    console.error('usage: node ephemerality-check.mjs --home <DSH_HOME> --since <epochMs> \\');
    console.error('         --question-marker <text> --answer-excerpt <text>');
    return 2;
  }
  const result = scanHome({
    home,
    since: since === undefined ? 0 : Number(since),
    questionMarker,
    answerExcerpt,
  });
  console.log(JSON.stringify({
    home,
    since: since === undefined ? 0 : Number(since),
    logsScanned: result.scanned,
    logsConsidered: result.considered,
    questionMarker,
    answerExcerpt: answerExcerpt.trim().slice(0, 80),
    harnessArtifacts: result.artifacts.slice(0, 20),
  }, null, 2));
  if (result.failures.length > 0) {
    console.error('EPHEMERALITY FAIL');
    for (const failure of result.failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log(
    'EPHEMERALITY PASS: no persisted user message, command event, or assistant message contains the /btw exchange' +
      (result.artifacts.length > 0
        ? ` (${result.artifacts.length} question-marker hit(s) are the agent's own tool/test traffic, not the /btw path)`
        : ''),
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
