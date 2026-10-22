// Pure presentation model for the /btw panel, so the copy and the state
// mapping are testable without a DOM or React.

/**
 * Format a character count for the activity line ("1.5k").
 * @param {number} value - non-negative character count.
 * @returns {string} compact count.
 */
function formatCount(value) {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 1000) return String(Math.floor(value));
  const scaled = value / 1000;
  return `${scaled >= 10 ? Math.round(scaled) : scaled.toFixed(1)}k`;
}

/**
 * Explain an unusual ending without hiding the answer.
 * @param {object} run - resolved run facts.
 * @returns {string|null} note text, or null for an ordinary finish.
 */
function noteFor({ status, finish, answer, reasoningChars, continuations }) {
  if (status === 'error') {
    return answer.length > 0 ? 'The text above arrived before the stream ended.' : null;
  }
  if (finish !== 'max-tokens') return null;
  if (answer.length === 0) {
    return reasoningChars > 0
      ? 'The output limit was reached during thinking, before any answer text arrived.'
      : 'The output limit was reached before any answer text arrived.';
  }
  if (continuations > 0) {
    return `Still cut off at the length limit after ${continuations} continuation${continuations === 1 ? '' : 's'}.`;
  }
  return 'The answer was cut off at the length limit.';
}

/**
 * Map one store state to the view the component renders.
 * @param {object} state - overlay store state.
 * @returns {object} view fields.
 */
export function buildOverlayView(state) {
  const status = typeof state?.status === 'string' ? state.status : 'idle';
  const answer = typeof state?.answer === 'string' ? state.answer : '';
  const finish = state?.finish ?? null;
  const usage = state?.usage ?? null;
  const reasoningChars = Number.isFinite(state?.reasoningChars) ? state.reasoningChars : 0;
  const continuations = Number.isFinite(state?.continuations) ? state.continuations : 0;
  const streaming = status === 'streaming';

  let statusLabel = '';
  if (streaming) {
    statusLabel =
      answer.length > 0
        ? 'Answering…'
        : reasoningChars > 0
          ? `Thinking… ${formatCount(reasoningChars)}`
          : 'Thinking…';
  } else if (status === 'done' && continuations > 0) {
    statusLabel = `continued ×${continuations}`;
  }

  return {
    visible: state?.open === true,
    title: 'Side question — not saved to this conversation',
    question: typeof state?.question === 'string' ? state.question : '',
    answer,
    hint: '× closes · Esc while this card is focused',
    error: typeof state?.error === 'string' ? state.error : null,
    errorCode: typeof state?.errorCode === 'string' ? state.errorCode : null,
    note: noteFor({ status, finish, answer, reasoningChars, continuations }),
    statusLabel,
    cacheReadTokens:
      usage !== null && Number.isFinite(usage.cacheReadTokens) ? usage.cacheReadTokens : null,
    status,
  };
}
