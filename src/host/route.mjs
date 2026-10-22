// dsh-btw host route: one tool-less side-question call, streamed as NDJSON.
//
// This route is the entire host half of the ephemeral /btw path. It never
// touches the agent loop, the command registry, or session persistence: it
// reads the live session's model-visible history, appends exactly one frozen
// user message, and forwards the provider stream to the browser.
//
// Two answers about "why did long answers break" live here:
//   * the routed Messages protocol counts thinking against `max_tokens`, so the
//     budget has to cover reasoning AND text (hence the larger default and the
//     thinking-off retry when the budget dies before any text exists);
//   * a truncated finish is not the end of the answer: the route continues from
//     the partial text instead of handing the user half a sentence.
// Aborts are a stall watchdog plus a hard ceiling, never a wall clock that kills
// a healthy answer mid-stream.
//
// Pure route logic in the sense that every harness dependency is injected, so
// tests can drive `createBtwHost` with fakes and no running harness.

import { MAX_BODY_BYTES, MAX_QUESTION_CHARS, resolveConfig } from './config.mjs';
import { buildContinuationTurn, buildRequestEnvelope } from './prompt.mjs';

/** Loopback addresses this plugin accepts. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Reasoning characters buffered before a progress frame is written. Throttling
 * by volume keeps a chatty thinking stream from producing hundreds of writes
 * while still proving liveness to the overlay.
 */
const PROGRESS_CHARS = 200;

const ABORT_REASONS = {
  stall: 'stall',
  deadline: 'deadline',
  client: 'client',
};

/** @param {object} req @returns {boolean} whether the request came from loopback. */
export function isLoopback(req) {
  const address = req?.socket?.remoteAddress ?? '';
  return LOOPBACK.has(address);
}

/**
 * Send one plain JSON response.
 * @param {object} res - response.
 * @param {number} status - HTTP status.
 * @param {object} payload - JSON body.
 * @param {object} [extraHeaders] - additional response headers.
 */
function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...extraHeaders,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Send one plain JSON error. @param {object} res @param {number} status @param {string} code @param {string} message @param {object} [extraHeaders] */
function sendError(res, status, code, message, extraHeaders) {
  sendJson(res, status, { error: { code, message } }, extraHeaders);
}

/**
 * Read a capped request body.
 *
 * An over-cap body is DRAINED rather than destroyed: destroying the request
 * resets the connection, so the caller could never receive the 413 JSON.
 *
 * @param {object} req - in-flight request.
 * @returns {Promise<string>} the UTF-8 body text.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      settle(value);
    };
    const onData = (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error('body too large');
        error.code = 'too_large';
        // Keep consuming the rest so the response can be written on this socket.
        req.resume?.();
        finish(reject, error);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(resolve, Buffer.concat(chunks).toString('utf8'));
    const onError = (error) => finish(reject, error);

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/**
 * Render a watchdog duration for a human ("60s", "500ms").
 * @param {number} ms - numeric timeout.
 * @returns {string} compact duration.
 */
function describeDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${Math.round(ms / 1000)}s`;
}

/**
 * Map one failed/aborted watchdog to the closing error frame.
 * @param {string|null} abortedBy - the watchdog that fired.
 * @param {{stallTimeoutMs: number, deadlineMs: number}} limits - resolved limits.
 * @returns {{code: string, message: string}} failure facts.
 */
function abortFailure(abortedBy, { stallTimeoutMs, deadlineMs }) {
  if (abortedBy === ABORT_REASONS.stall) {
    return {
      code: 'STALLED',
      message: `the model stopped sending output for ${describeDuration(stallTimeoutMs)}`,
    };
  }
  if (abortedBy === ABORT_REASONS.deadline) {
    return {
      code: 'DEADLINE',
      message: `the side question exceeded the ${describeDuration(deadlineMs)} deadline`,
    };
  }
  return { code: 'ABORTED', message: 'the side question was aborted' };
}

/**
 * Build the closing done frame.
 * @param {string} finish - terminal finish kind ('stop' | 'max-tokens').
 * @param {object|undefined} usage - last reported TokenUsage.
 * @param {{continuations: number, reasoningChars: number}} facts - run counters.
 * @returns {object} the done frame.
 */
function doneFrame(finish, usage, { continuations, reasoningChars }) {
  return {
    type: 'done',
    finish,
    ...(usage === undefined ? {} : { usage }),
    ...(continuations === 0 ? {} : { continuations }),
    ...(reasoningChars === 0 ? {} : { reasoningChars }),
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
 * @param {object} [deps.config] - raw optional row config (`maxTokens`, `continuations`, `stallTimeoutMs`, `deadlineMs`/`timeoutMs`, `thinking`).
 * @returns {{handleRequest: (req: object, res: object) => Promise<void>, register: () => (() => void) | undefined}} host face.
 */
export function createBtwHost({ webServer, agents, llm, logger, config }) {
  const { maxTokens, continuations, stallTimeoutMs, deadlineMs, thinking } = resolveConfig(config);

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
      sendError(res, 405, 'METHOD_NOT_ALLOWED', 'POST required', { allow: 'POST' });
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
      envelope = buildRequestEnvelope({
        agent,
        question,
        maxTokens,
        thinking,
        onHistoryTrimmed: (count) =>
          logger?.info?.(
            `btw: trimmed ${count} message(s) from a mid-turn snapshot so the replayed prefix is provider-valid`,
          ),
      });
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
    let abortedBy = null;
    const abortWith = (reason) => {
      if (controller.signal.aborted) return;
      if (abortedBy === null) abortedBy = reason;
      controller.abort();
    };
    // Dismissal is a RESPONSE-socket event, not a request-body event:
    // `IncomingMessage` emits 'close' as soon as the body has been consumed on
    // Node 24, which would abort every healthy request. A response 'close'
    // before `writableFinished` is the client going away mid-stream.
    const onClose = () => {
      if (res.writableFinished !== true) abortWith(ABORT_REASONS.client);
    };
    if (typeof res.on === 'function') res.on('close', onClose);
    const socket = req.socket;
    if (socket && typeof socket.on === 'function') socket.on('close', onClose);
    // Hard ceiling only: a slow but streaming answer must not be killed.
    const deadline = setTimeout(() => abortWith(ABORT_REASONS.deadline), deadlineMs);
    deadline.unref?.();

    /** Restart the no-output watchdog; every chunk (thinking included) counts as liveness. */
    let stallTimer = null;
    const clearStall = () => {
      if (stallTimer === null) return;
      clearTimeout(stallTimer);
      stallTimer = null;
    };
    const touchStall = () => {
      clearStall();
      stallTimer = setTimeout(() => abortWith(ABORT_REASONS.stall), stallTimeoutMs);
      stallTimer.unref?.();
    };

    let headersSent = false;
    let usage;
    let terminal = null;
    let textSoFar = '';
    let reasoningChars = 0;
    let progressSent = 0;
    let continuationsUsed = 0;
    let thinkingFallbackUsed = false;
    let rounds = 0;
    let messages = envelope.messages;

    const writeFrame = (frame) => {
      try {
        res.write(`${JSON.stringify(frame)}\n`);
      } catch {
        // The client went away; the stream is already unusable.
      }
    };
    const flushProgress = () => {
      if (reasoningChars <= progressSent) return;
      progressSent = reasoningChars;
      writeFrame({ type: 'progress', reasoningChars });
    };

    try {
      res.writeHead(200, {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.flushHeaders?.();
      headersSent = true;
      logger?.info?.(
        `btw: side question started (model=${envelope.model}, messages=${envelope.messages.length}, ` +
          `questionLength=${question.length}, maxTokens=${envelope.maxTokens}, thinking=${thinking})`,
      );
      touchStall();

      let overrideRejected = false;

      while (terminal === null) {
        let roundText = '';
        let roundUsage;
        let finished;
        let roundError;
        // Rounds after the first only finish an answer that already exists:
        // re-thinking would spend the budget twice on the same problem. The
        // override is withdrawn again below when a route rejects "off", because
        // a third-party model need not offer that level.
        const overrideThinking = rounds > 0 && !overrideRejected;
        const request = { ...envelope, messages, signal: controller.signal };
        if (overrideThinking) request.reasoningEffort = 'off';

        try {
          for await (const chunk of llm.stream(request)) {
            touchStall();
            if (chunk === null || typeof chunk !== 'object') continue;
            if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
              roundText += chunk.text;
              textSoFar += chunk.text;
              writeFrame({ type: 'delta', text: chunk.text });
            } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
              reasoningChars += chunk.text.length;
              if (reasoningChars - progressSent >= PROGRESS_CHARS) flushProgress();
            } else if (chunk.type === 'usage') {
              roundUsage = chunk.usage;
            } else if (chunk.type === 'finish') {
              finished = chunk.reason;
              break;
            }
          }
        } catch (error) {
          roundError = error;
        }
        if (roundUsage !== undefined) usage = roundUsage;
        rounds += 1;
        flushProgress();

        if (roundError !== undefined) {
          // A rejected "off" level must not cost the user the rest of the answer:
          // retry this attempt once with the routed effort.
          if (overrideThinking && roundText.length === 0) {
            overrideRejected = true;
            logger?.info?.('btw: the route rejected the thinking-off override; retrying with the routed effort');
            continue;
          }
          terminal =
            abortedBy === null
              ? {
                  type: 'error',
                  code: typeof roundError?.code === 'string' ? roundError.code : 'INTERNAL',
                  message: roundError?.message ?? String(roundError),
                }
              : { type: 'error', ...abortFailure(abortedBy, { stallTimeoutMs, deadlineMs }) };
          break;
        }

        if (finished === undefined || finished === null) {
          terminal =
            abortedBy === null
              ? { type: 'error', code: 'EMPTY_RESPONSE', message: 'the model returned no terminal result' }
              : { type: 'error', ...abortFailure(abortedBy, { stallTimeoutMs, deadlineMs }) };
          break;
        }

        const kind = finished.kind;
        if (kind === 'stop') {
          terminal = doneFrame('stop', usage, { continuations: continuationsUsed, reasoningChars });
          break;
        }
        if (kind === 'max-tokens') {
          // The budget died inside thinking: there is no partial text to
          // continue from, so answer once more with thinking disabled.
          if (textSoFar.trim().length === 0 && !thinkingFallbackUsed && thinking !== 'off') {
            thinkingFallbackUsed = true;
            logger?.info?.(
              'btw: the output budget was spent before any answer text; retrying once without thinking',
            );
            continue;
          }
          if (roundText.trim().length === 0 || continuationsUsed >= continuations) {
            terminal = doneFrame('max-tokens', usage, { continuations: continuationsUsed, reasoningChars });
            break;
          }
          continuationsUsed += 1;
          messages = [...messages, ...buildContinuationTurn(roundText)];
          continue;
        }
        if (kind === 'tool-calls') {
          terminal = {
            type: 'error',
            code: 'UNEXPECTED_TOOL_CALLS',
            message: 'the model attempted a tool call although no tools were sent',
          };
          break;
        }
        // Same withdrawal for a route that reports the rejected level as a
        // terminal error finish instead of throwing.
        if (kind === 'error' && overrideThinking && roundText.length === 0 && abortedBy === null) {
          overrideRejected = true;
          logger?.info?.('btw: the route rejected the thinking-off override; retrying with the routed effort');
          continue;
        }
        const reasonFailure = finished.failure ?? {};
        terminal =
          abortedBy === null
            ? {
                type: 'error',
                code:
                  typeof reasonFailure.code === 'string'
                    ? reasonFailure.code
                    : kind === 'aborted'
                      ? 'ABORTED'
                      : 'INTERNAL',
                message:
                  typeof reasonFailure.message === 'string'
                    ? reasonFailure.message
                    : 'the model request failed',
              }
            : { type: 'error', ...abortFailure(abortedBy, { stallTimeoutMs, deadlineMs }) };
        break;
      }

      writeFrame(terminal);
    } catch (error) {
      const failureFrame =
        abortedBy === null
          ? {
              type: 'error',
              code: typeof error?.code === 'string' ? error.code : 'INTERNAL',
              message: error?.message ?? String(error),
            }
          : { type: 'error', ...abortFailure(abortedBy, { stallTimeoutMs, deadlineMs }) };
      terminal = failureFrame;
      if (headersSent) writeFrame(failureFrame);
      else sendError(res, 500, 'SNAPSHOT_FAILED', failureFrame.message);
    } finally {
      clearStall();
      clearTimeout(deadline);
      res.removeListener?.('close', onClose);
      socket?.removeListener?.('close', onClose);
      res.end();
      logger?.info?.(
        `btw: side answer settled (durationMs=${Date.now() - started}, ` +
          `finish=${terminal?.type === 'done' ? terminal.finish : terminal?.code ?? 'none'}, ` +
          `rounds=${rounds}, continuations=${continuationsUsed}, ` +
          `outputTokens=${usage?.outputTokens ?? 'unknown'}, reasoningChars=${reasoningChars}, ` +
          `cacheReadTokens=${usage?.cacheReadTokens ?? 'unknown'})`,
      );
    }
  }

  function register() {
    if (webServer === undefined || typeof webServer.register !== 'function') return undefined;
    return webServer.register({ kind: 'prefix', path: '/btw', handler: handleRequest });
  }

  return { handleRequest, register };
}
