// Host-side constants and defensive row-config resolution for dsh-btw.
// Pure module: no Cordis and no @deepseek-ai imports.

export const DEFAULT_MAX_TOKENS = 1200;
export const MAX_QUESTION_CHARS = 4000;
export const MAX_BODY_BYTES = 32 * 1024;
export const DEFAULT_TIMEOUT_MS = 120000;

/**
 * Resolve the plugin row's optional config.
 *
 * The row config is intentionally schema-free (the dsh-topbar precedent):
 * the plugin declares no Config export so it never imports a validation
 * library, and only positive finite numbers are honoured.
 *
 * @param {unknown} raw - the Loader row's config object, if any.
 * @returns {{maxTokens: number, timeoutMs: number}} resolved values.
 */
export function resolveConfig(raw) {
  const positive = (value, fallback) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  const config = raw !== null && typeof raw === 'object' ? raw : {};
  return {
    maxTokens: positive(config.maxTokens, DEFAULT_MAX_TOKENS),
    timeoutMs: positive(config.timeoutMs, DEFAULT_TIMEOUT_MS),
  };
}
