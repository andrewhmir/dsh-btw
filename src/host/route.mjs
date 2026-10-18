// dsh-btw host route: one tool-less side-question call, streamed as NDJSON.
//
// This route is the entire host half of the ephemeral /btw path. It never
// touches the agent loop, the command registry, or session persistence: it
// reads the live session's model-visible history, appends exactly one frozen
// user message, and forwards the provider stream to the browser.
//
// Pure route logic in the sense that every harness dependency is injected, so
// tests can drive `createBtwHost` with fakes and no running harness.

import { MAX_BODY_BYTES, MAX_QUESTION_CHARS, resolveConfig } from './config.mjs';
import { buildRequestEnvelope } from './prompt.mjs';

/** Loopback addresses this plugin accepts. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** @param {object} req @returns {boolean} whether the request came from loopback. */
export function isLoopback(req) {
  const address = req?.socket?.remoteAddress ?? '';
  return LOOPBACK.has(address);
}

/** Send one plain JSON response. @param {object} res @param {number} status @param {object} payload */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Send one plain JSON error. @param {object} res @param {number} status @param {string} code @param {string} message */
function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

/**
 * Read a capped request body.
 * @param {object} req - in-flight request.
 * @returns {Promise<string>} the UTF-8 body text.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error('body too large');
        error.code = 'too_large';
        req.destroy?.();
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Map a terminal finish reason to the single closing NDJSON frame.
 * @param {object|undefined} reason - provider FinishReason.
 * @param {object|undefined} usage - last reported TokenUsage.
 * @returns {object} a done or error frame.
 */
function finishFrame(reason, usage) {
  const kind = reason?.kind;
  const withUsage = usage === undefined ? {} : { usage };
  if (kind === 'stop') return { type: 'done', finish: 'stop', ...withUsage };
  if (kind === 'max-tokens') return { type: 'done', finish: 'max-tokens', ...withUsage };
  if (kind === 'tool-calls') {
    return {
      type: 'error',
      code: 'UNEXPECTED_TOOL_CALLS',
      message: 'the model attempted a tool call although no tools were sent',
    };
  }
  const failure = reason?.failure ?? {};
  return {
    type: 'error',
    code: typeof failure.code === 'string' ? failure.code : kind === 'aborted' ? 'ABORTED' : 'INTERNAL',
    message: typeof failure.message === 'string' ? failure.message : 'the model request failed',
  };
}

/**
 * Build the host face around injected harness services.
 *
 * @param {object} deps - injected dependencies.
 * @param {{register: (route: object) => () => void}} deps.webServer - harness web server.
 * @param {{get: (id: string) => object | undefined}} deps.agents - live agent registry.
 * @param {{stream: (options: object) => AsyncIterable<object>}} deps.llm - LLM runtime.
 * @param {object} [deps.logger] - optional harness logger.
 * @param {object} [deps.config] - raw optional row config (`maxTokens`, `timeoutMs`).
 * @returns {{handleRequest: (req: object, res: object) => Promise<void>, register: () => (() => void) | undefined}} host face.
 */
export function createBtwHost({ webServer, agents, llm, logger, config }) {
  const { maxTokens, timeoutMs } = resolveConfig(config);

  /**
   * One POST /btw/ask exchange.
   * @param {object} req - request.
   * @param {object} res - response.
   * @returns {Promise<void>} resolves when the response is fully settled.
   */
  async function handleRequest(req, res) {
    if (!isLoopback(req)) {
      sendError(res, 403, 'FORBIDDEN', 'loopback only');
      return;
    }
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      sendError(res, 400, 'BAD_REQUEST', 'malformed request URL');
      return;
    }
    if (url.pathname !== '/btw/ask') {
      sendError(res, 404, 'NOT_FOUND', 'not found');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' });
      res.end();
      return;
    }

    let rawBody;
    try {
      rawBody = await readBody(req);
    } catch (error) {
      if (error?.code === 'too_large') {
        sendError(res, 413, 'TOO_LARGE', 'request body too large');
        return;
      }
      sendError(res, 400, 'BAD_REQUEST', 'could not read the request body');
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(rawBody === '' ? '{}' : rawBody);
    } catch {
      sendError(res, 400, 'BAD_REQUEST', 'request body must be JSON');
      return;
    }

    const sessionId = typeof parsed?.sessionId === 'string' ? parsed.sessionId.trim() : '';
    const question = typeof parsed?.question === 'string' ? parsed.question.trim() : '';
    if (sessionId.length === 0) {
      sendError(res, 400, 'BAD_REQUEST', 'sessionId is required');
      return;
    }
    if (question.length === 0) {
      sendError(res, 400, 'BAD_QUESTION', 'question is required');
      return;
    }
    if (question.length > MAX_QUESTION_CHARS) {
      sendError(res, 400, 'BAD_QUESTION', `question exceeds ${MAX_QUESTION_CHARS} characters`);
      return;
    }

    const agent = agents.get(sessionId);
    if (agent === undefined || agent === null) {
      sendError(res, 409, 'NO_LIVE_AGENT', 'no live agent for this session');
      return;
    }

    let envelope;
    try {
      envelope = buildRequestEnvelope({ agent, question, maxTokens });
    } catch (error) {
      if (error?.code === 'NO_MODEL_ROUTE') {
        sendError(res, 409, 'NO_MODEL_ROUTE', error.message);
        return;
      }
      sendError(res, 500, 'SNAPSHOT_FAILED', error?.message ?? String(error));
      return;
    }

    const started = Date.now();
    const controller = new AbortController();
    const onClose = () => controller.abort();
    req.on('close', onClose);
    const deadline = setTimeout(() => controller.abort(), timeoutMs);
    deadline.unref?.();

    let headersSent = false;
    let usage;
    let terminal = null;
    const writeFrame = (frame) => {
      res.write(`${JSON.stringify(frame)}\n`);
    };

    try {
      res.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.flushHeaders?.();
      headersSent = true;
      logger?.info?.(
        `btw: side question started (model=${envelope.model}, messages=${envelope.messages.length}, questionLength=${question.length})`,
      );

      for await (const chunk of llm.stream({ ...envelope, signal: controller.signal })) {
        if (chunk === null || typeof chunk !== 'object') continue;
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
          writeFrame({ type: 'delta', text: chunk.text });
        } else if (chunk.type === 'usage') {
          usage = chunk.usage;
        } else if (chunk.type === 'finish') {
          terminal = finishFrame(chunk.reason, usage);
          writeFrame(terminal);
          break;
        }
      }

      if (terminal === null) {
        terminal = { type: 'error', code: 'EMPTY_RESPONSE', message: 'the model returned no terminal result' };
        writeFrame(terminal);
      }
    } catch (error) {
      const failure = {
        type: 'error',
        code: typeof error?.code === 'string' ? error.code : 'INTERNAL',
        message: error?.message ?? String(error),
      };
      terminal = failure;
      if (headersSent) writeFrame(failure);
      else sendError(res, 500, 'SNAPSHOT_FAILED', failure.message);
    } finally {
      clearTimeout(deadline);
      req.removeListener?.('close', onClose);
      res.end();
      const cacheReadTokens = usage?.cacheReadTokens;
      logger?.info?.(
        `btw: side answer settled (durationMs=${Date.now() - started}, ` +
          `finish=${terminal?.type === 'done' ? terminal.finish : terminal?.code ?? 'none'}, ` +
          `cacheReadTokens=${cacheReadTokens ?? 'unknown'})`,
      );
    }
  }

  function register() {
    if (webServer === undefined || typeof webServer.register !== 'function') return undefined;
    return webServer.register({ kind: 'prefix', path: '/btw', handler: handleRequest });
  }

  return { handleRequest, register };
}
