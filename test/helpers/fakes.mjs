// Shared fakes for the dsh-btw host route tests. No harness imports.

import { EventEmitter } from 'node:events';

/**
 * Minimal IncomingMessage stand-in: emits its body as one data chunk, then end.
 * The default body is a valid, live-session request so tests that are not about
 * validation can call `makeReq()` with no arguments. `destroyed`/`resume` exist
 * so the 413 path can be asserted to drain instead of resetting the connection.
 * @param {object} [options] - request shape.
 * @returns {EventEmitter} fake request.
 */
export function makeReq({
  method = 'POST',
  url = '/btw/ask',
  remoteAddress = '127.0.0.1',
  body = JSON.stringify({ sessionId: 'sess-1', question: 'why?' }),
} = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.socket = { remoteAddress, destroyed: false, on: () => {}, removeListener: () => {} };
  req.destroyed = false;
  req.destroy = () => {
    req.destroyed = true;
  };
  req.resume = () => {};
  queueMicrotask(() => {
    if (body !== '') req.emit('data', Buffer.from(body, 'utf8'));
    req.emit('end');
  });
  return req;
}

/**
 * Minimal ServerResponse stand-in capturing status, headers and body.
 * An EventEmitter so the route's response-close abort wiring can be driven, and
 * `writableFinished` so the route can tell a normal finish from a disconnect.
 * @returns {object} fake response with `body()`/`json()` readers.
 */
export function makeRes() {
  const res = new EventEmitter();
  res.status = 0;
  res.headers = undefined;
  res.chunks = [];
  res.ended = false;
  res.flushed = false;
  res.writableFinished = false;
  res.writeHead = function writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  };
  res.write = function write(chunk) {
    this.chunks.push(String(chunk));
    return true;
  };
  res.end = function end(chunk) {
    if (chunk !== undefined) this.chunks.push(String(chunk));
    this.ended = true;
    this.writableFinished = true;
  };
  res.flushHeaders = function flushHeaders() {
    this.flushed = true;
  };
  res.body = function body() {
    return this.chunks.join('');
  };
  res.json = function json() {
    return JSON.parse(this.body());
  };
  return res;
}

/**
 * Fake live Agent with a Session exposing the two APIs the plugin uses.
 * @param {object} [options] - fixture values.
 * @returns {{session: object, options: object}} fake agent.
 */
export function fakeAgent({ messages, header, options, id = 'sess-1', onAppend = () => {} } = {}) {
  const history = Object.freeze(
    messages ?? [Object.freeze({ role: 'user', content: Object.freeze([{ type: 'text', text: 'hi' }]) })],
  );
  const session = {
    id,
    requestHeader: () => header,
    deriveMessages: () => history,
    // Ephemerality invariant: the plugin must never append to a session.
    append: (...args) => {
      onAppend(...args);
      throw new Error('session.append must never be called by dsh-btw');
    },
  };
  return { session, options: options ?? {} };
}
