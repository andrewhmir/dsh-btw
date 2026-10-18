// Pure presentation model for the /btw overlay, so the copy and the state
// mapping are testable without a DOM or React.

/**
 * Map one overlay-store state to the view the component renders.
 * @param {object} state - overlay store state.
 * @returns {object} view fields.
 */
export function buildOverlayView(state) {
  const finish = state?.finish ?? null;
  const usage = state?.usage ?? null;
  return {
    visible: state?.open === true,
    title: 'Side question — not saved to this conversation',
    question: typeof state?.question === 'string' ? state.question : '',
    answer: typeof state?.answer === 'string' ? state.answer : '',
    hint: 'Space / Enter / Esc to close',
    error: typeof state?.error === 'string' ? state.error : null,
    truncationNote: finish === 'max-tokens' ? 'The answer was cut off at the length limit.' : null,
    statusLabel: state?.status === 'streaming' ? 'Answering…' : '',
    cacheReadTokens:
      usage !== null && Number.isFinite(usage.cacheReadTokens) ? usage.cacheReadTokens : null,
    status: typeof state?.status === 'string' ? state.status : 'idle',
  };
}
