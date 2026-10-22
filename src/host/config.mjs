// Host-side constants and defensive row-config resolution for dsh-btw.
// Pure module: no Cordis and no @deepseek-ai imports.

/**
 * Default output budget for ONE side answer, thinking included.
 *
 * The routed Messages protocol counts reasoning tokens against `max_tokens`, so
 * this number has to cover the thinking AND the visible answer. The old 1200 was
 * a whole-answer budget that thinking alone could consume, which is why long
 * answers were cut and thinking-heavy answers printed nothing at all.
 */
export const DEFAULT_MAX_TOKENS = 8192;
/** Automatic "continue where you stopped" rounds after a max-tokens finish. */
export const DEFAULT_CONTINUATIONS = 2;
export const MAX_CONTINUATIONS = 5;
/**
 * Abort when the provider sends no chunk at all (thinking included) for this
 * long. A progress-based watchdog, not a wall clock: a slow but healthy answer
 * must not be killed mid-stream.
 */
export const DEFAULT_STALL_TIMEOUT_MS = 60_000;
/** Hard ceiling for one side question, so a wedged request cannot run forever. */
export const DEFAULT_DEADLINE_MS = 600_000;
export const MAX_QUESTION_CHARS = 4000;
export const MAX_BODY_BYTES = 32 * 1024;

/** Keep the session's routed reasoning effort for the side call. */
export const THINKING_INHERIT = 'inherit';
/** Answer without thinking: faster, cheaper, weaker on hard questions. */
export const THINKING_OFF = 'off';

/**
 * Keep only a positive finite number.
 * @param {unknown} value - configured value.
 * @param {number} fallback - value used when the input is unusable.
 * @returns {number} a positive number.
 */
function positive(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Keep only a non-negative integer up to `max`.
 * @param {unknown} value - configured value.
 * @param {number} fallback - value used when the input is unusable.
 * @param {number} max - inclusive upper bound.
 * @returns {number} a bounded integer.
 */
function boundedCount(value, fallback, max) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return fallback;
  return Math.min(value, max);
}

/**
 * Resolve the plugin row's optional config.
 *
 * The row config is intentionally schema-free (the dsh-topbar precedent): the
 * plugin declares no Config export so it never imports a validation library.
 * `timeoutMs` is still accepted as the hard-ceiling alias it always was.
 *
 * @param {unknown} raw - the Loader row's config object, if any.
 * @returns {{maxTokens: number, continuations: number, stallTimeoutMs: number, deadlineMs: number, thinking: 'inherit'|'off'}} resolved values.
 */
export function resolveConfig(raw) {
  const config = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    maxTokens: positive(config.maxTokens, DEFAULT_MAX_TOKENS),
    continuations: boundedCount(config.continuations, DEFAULT_CONTINUATIONS, MAX_CONTINUATIONS),
    stallTimeoutMs: positive(config.stallTimeoutMs, DEFAULT_STALL_TIMEOUT_MS),
    deadlineMs: positive(config.deadlineMs ?? config.timeoutMs, DEFAULT_DEADLINE_MS),
    thinking: config.thinking === THINKING_OFF ? THINKING_OFF : THINKING_INHERIT,
  };
}
