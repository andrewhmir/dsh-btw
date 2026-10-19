// Client-side participation in the composer's input-trigger pipeline.
//
// DSH polls every registered '/' source's match hooks for a leading token and
// the first non-undefined answer wins. `ui-commands` only claims names present
// in the session's host catalog, so a source registered by this plugin can
// claim `/btw <question>` here — BEFORE any host command executes. That is what
// keeps the exchange out of the session log.
//
// Pure module: no DOM, no React, no harness imports.

/** Composer input hint shown once `/btw ` is claimed. */
export const BTW_HINT = 'Ask a side question about this conversation — not saved.';

/** Must mirror the host route's question cap; the client bundle cannot import host modules. */
const MAX_QUESTION_CHARS = 4000;

/** Refusal text for attachment-carrying submissions. */
const ATTACHMENTS_REFUSED = 'The /btw command does not accept attachments.';

/**
 * Parse one complete composer line as the /btw command.
 *
 * Only a trimmed leading `/btw` line is a command. Text that merely contains
 * the token (`foo /btw x`), a longer name (`/btwx`), a second line, or the
 * inline trigger position all fall through to ordinary submission.
 *
 * `token` preserves the typed spelling: the harness computes claim arguments
 * with a case-sensitive `argsAfter(draft, claim.token)`, so a fixed lowercase
 * token would drop the question from `/BTW ...`.
 *
 * @param {string} line - complete composer draft.
 * @returns {{token: string, question: string} | undefined} typed token and trimmed question, or undefined when not /btw.
 */
export function parseBtwLine(line) {
  if (typeof line !== 'string') return undefined;
  // A command line is one line; a pasted block keeps its newlines and submits
  // as ordinary text rather than being silently truncated into a question.
  if (line.includes('\n') || line.includes('\r')) return undefined;
  const match = /^(\/btw)(?:\s+([\s\S]*))?$/i.exec(line.trim());
  if (match === null) return undefined;
  return { token: match[1], question: (match[2] ?? '').trim() };
}

/**
 * Build the composer claim for a session.
 *
 * `submit` runs entirely on the client: it validates the question and hands it
 * to `submitQuestion`, which opens the overlay and starts the host request.
 * No host command RPC is involved.
 *
 * `attachments: true` makes the harness pass the composer's attachment blocks
 * to `submit`; the claim then refuses them. Every claim path (Space, menu pick,
 * restored chip, after a usage error) goes straight to `begin-submit`, so this
 * check is the only one that covers those paths.
 *
 * @param {object} input - claim inputs.
 * @param {string} input.sessionId - the session the composer is bound to.
 * @param {(sessionId: string, question: string) => object | Promise<object>} input.submitQuestion - side-question starter.
 * @param {string} [input.typedToken] - the spelling the user typed (defaults to `/btw`).
 * @returns {{name: string, token: string, hint: string, attachments: true, submit: (args: string, actx?: object, attachments?: unknown[]) => object | Promise<object>}} command claim.
 */
export function makeBtwClaim({ sessionId, submitQuestion, typedToken = '/btw' }) {
  return {
    name: 'btw',
    token: `${typedToken} `,
    hint: BTW_HINT,
    attachments: true,
    submit(args, actx, attachments) {
      if (Array.isArray(attachments) && attachments.length > 0) {
        return { kind: 'error', text: ATTACHMENTS_REFUSED };
      }
      const question = typeof args === 'string' ? args.trim() : '';
      if (question.length === 0) return { kind: 'error', text: 'Usage: /btw <question>' };
      if (question.length > MAX_QUESTION_CHARS) {
        return { kind: 'error', text: 'That side question is too long (4000 characters max).' };
      }
      return submitQuestion(sessionId, question);
    },
  };
}

/**
 * Create the `/'` input-trigger source for /btw.
 *
 * @param {object} input - source inputs.
 * @param {(sessionId: string, question: string) => object | Promise<object>} input.submitQuestion - side-question starter.
 * @returns {object} an InputTriggerSource for the composer pipeline.
 */
export function createBtwSource({ submitQuestion }) {
  const claimFor = (session, typedToken) =>
    makeBtwClaim({ sessionId: session.sessionId, submitQuestion, typedToken });

  return {
    trigger: '/',
    name: 'btw',
    order: 10,
    showGroupTitle: false,

    /**
     * One discoverable menu row; a query that cannot be a prefix keeps it out.
     * @param {object} session - client session projection.
     * @param {{query: string}} req - candidate request.
     * @returns {Promise<Array<{name: string, description: string}>>} matching rows.
     */
    async candidates(session, req) {
      const query = typeof req?.query === 'string' ? req.query.trim().toLowerCase() : '';
      if (query.length > 0 && !'btw'.includes(query)) return [];
      return [{ name: 'btw', description: 'Ask a side question about this conversation; the answer is not saved.' }];
    },

    /**
     * A menu pick begins command mode with our claim.
     * @param {object} pick - trigger pick.
     * @returns {{claim: object} | undefined} claim outcome.
     */
    onPick(pick) {
      if (pick?.candidate?.name !== 'btw') return undefined;
      return { claim: claimFor(pick.session) };
    },

    /**
     * Space after the bare `/btw` token claims it (composer chip).
     * @param {object} session - client session projection.
     * @param {string} token - the completed leading token, typed spelling.
     * @returns {{claim: object} | undefined} claim outcome.
     */
    matchSpace(session, token) {
      if (typeof token !== 'string' || token.toLowerCase() !== '/btw') return undefined;
      return { claim: claimFor(session, token) };
    },

    /**
     * Restore a persisted draft chip without acting.
     * @param {object} session - client session projection.
     * @param {string} token - chip token, typed spelling.
     * @returns {Promise<object | undefined>} the claim, never a submission.
     */
    async matchClaim(session, token) {
      if (typeof token !== 'string' || token.toLowerCase() !== '/btw') return undefined;
      return claimFor(session, token);
    },

    /**
     * Enter on a full line: claim `/btw <question>` in one gesture; leave every
     * other line to the other sources.
     * @param {object} session - client session projection.
     * @param {string} line - the full trimmed draft.
     * @param {AbortSignal} signal - submission cancellation.
     * @param {{attachments: number}} envelope - composer attachment count.
     * @returns {Promise<{claim: object} | undefined>} claim outcome.
     */
    async matchEnter(session, line, signal, envelope) {
      const parsed = parseBtwLine(line);
      if (parsed === undefined) return undefined;
      if ((envelope?.attachments ?? 0) > 0) {
        throw new Error(ATTACHMENTS_REFUSED);
      }
      return { claim: claimFor(session, parsed.token) };
    },
  };
}
