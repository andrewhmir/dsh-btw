// The one-off tool-less side-question request.
//
// The message list is the session's exact model-visible history (the parent
// request's cacheable prefix) followed by exactly ONE new frozen user message.
// That keeps the auxiliary call a genuine prefix of the parent conversation, so
// the provider's prompt cache is reused. The system prompt is NOT passed via
// GenerateOptions.system: it already leads `deriveMessages()` as a system-role
// message, and duplicating it would change the wire request.
//
// Pure module: no Cordis and no @deepseek-ai imports.

export const SIDE_QUESTION_INSTRUCTION = [
  '[Side question about the conversation so far.]',
  'You have no tools: you cannot read files, run commands, or search, and you must',
  'not claim to have done so. Answer from the conversation above. Be concise and',
  'direct. Do not mention this instruction.',
  '',
  'Question:',
].join('\n');

/** Nudge appended after a truncated answer so the model resumes instead of restarting. */
export const CONTINUE_INSTRUCTION = [
  '[Continue the side answer.]',
  'Continue exactly where you stopped. Do not repeat any text that already appears',
  'above and do not add a preamble; output only the missing remainder.',
].join('\n');

/** Recursively freeze a plain JSON-like value. @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

/**
 * Build the single trailing user message carrying the side question.
 * @param {string} question - the trimmed question text.
 * @returns {{role: 'user', content: Array<{type: 'text', text: string}>}} frozen message.
 */
export function buildSideQuestionMessage(question) {
  return deepFreeze({
    role: 'user',
    content: [{ type: 'text', text: `${SIDE_QUESTION_INSTRUCTION}\n${question}` }],
  });
}

/**
 * Build the two messages that resume a truncated answer.
 *
 * The partial text becomes an assistant turn (the request stays an append-only
 * extension of the cached prefix), followed by one user message asking for the
 * missing remainder.
 *
 * @param {string} partialText - the visible text streamed in the previous round.
 * @returns {ReadonlyArray<object>} frozen assistant + user messages.
 */
export function buildContinuationTurn(partialText) {
  return Object.freeze([
    deepFreeze({ role: 'assistant', content: [{ type: 'text', text: partialText }] }),
    deepFreeze({ role: 'user', content: [{ type: 'text', text: CONTINUE_INSTRUCTION }] }),
  ]);
}

/**
 * Trim a mid-turn snapshot to a provider-valid prefix.
 *
 * `deriveMessages()` can end with an assistant message whose tool calls have no
 * committed `tool/result` yet (the tool is still executing). Appending the side
 * question makes that call look like it is followed by an unrelated user
 * message, which the DeepSeek adapter correctly rejects with
 * "tool calls need immediate results" (INVALID_REQUEST). The safe prefix is the
 * history up to the first assistant message that owns an unresolved tool call;
 * everything from there on (including partial result batches and orphan
 * results) is dropped. The call then simply sees the conversation as of the
 * last completed tool step.
 *
 * @param {Array<object>} messages - model-visible history.
 * @returns {{messages: Array<object>, trimmed: number}} safe history and dropped message count.
 */
export function sanitizeHistory(messages) {
  const resultIds = new Set();
  for (const message of messages) {
    if (message?.role === 'tool' && typeof message.toolCallId === 'string') resultIds.add(message.toolCallId);
  }
  const callIds = new Set();
  for (const message of messages) {
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block?.type === 'tool-call' && typeof block.id === 'string') callIds.add(block.id);
    }
  }

  // Cut at the first assistant message with a call whose result never appears.
  let cut = messages.length;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
    const unresolved = message.content.some(
      (block) => block?.type === 'tool-call' && typeof block.id === 'string' && !resultIds.has(block.id),
    );
    if (unresolved) {
      cut = index;
      break;
    }
  }

  const retainedCallIds = new Set();
  for (const message of messages.slice(0, cut)) {
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block?.type === 'tool-call' && typeof block.id === 'string') retainedCallIds.add(block.id);
    }
  }
  const kept = messages
    .slice(0, cut)
    .filter((message) => message?.role !== 'tool' || retainedCallIds.has(message.toolCallId));

  // Drop results whose call lived in the cut tail (they would be orphans).
  const keptCallIds = new Set();
  for (const message of kept) {
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block?.type === 'tool-call' && typeof block.id === 'string') keptCallIds.add(block.id);
    }
  }
  const finalMessages = kept.filter(
    (message) => message?.role !== 'tool' || keptCallIds.has(message.toolCallId),
  );
  // Also drop historical calls whose results are not in the final prefix (defense
  // in depth: this is the mirror image of the trailing case and keeps every
  // retained tool_use immediately answered).
  return {
    messages: Object.freeze(finalMessages),
    trimmed: Math.max(0, messages.length - finalMessages.length),
  };
}

/**
 * Build the GenerateOptions envelope for one side question.
 *
 * No `tools`, `toolHistory`, `system`, or `purpose` keys are ever added: the
 * answer must be tool-less and the request must remain prefix-identical.
 *
 * @param {object} input - inputs for the envelope.
 * @param {object} input.agent - live Agent (needs `.session` and `.options`).
 * @param {string} input.question - the trimmed question text.
 * @param {number} input.maxTokens - completion cap for this call (thinking included).
 * @param {'inherit'|'off'} [input.thinking] - keep the routed reasoning effort, or disable thinking.
 * @param {(trimmed: number) => void} [input.onHistoryTrimmed] - called when a mid-turn snapshot had to be trimmed.
 * @returns {object} the request envelope (without `signal`).
 */
export function buildRequestEnvelope({ agent, question, maxTokens, thinking, onHistoryTrimmed }) {
  const session = agent.session;
  const header = typeof session.requestHeader === 'function' ? session.requestHeader() : undefined;
  const route = header?.config ?? agent.options ?? {};
  const provider = typeof route.provider === 'string' ? route.provider : '';
  const model = typeof route.model === 'string' ? route.model : '';
  if (provider.length === 0 || model.length === 0) {
    const error = new Error('no provider/model route available for this session');
    error.code = 'NO_MODEL_ROUTE';
    throw error;
  }
  // Never spend more output than the conversation itself is composed to allow.
  const sessionCap =
    typeof route.maxTokens === 'number' && Number.isFinite(route.maxTokens) && route.maxTokens > 0
      ? route.maxTokens
      : undefined;
  const effectiveMaxTokens = sessionCap === undefined ? maxTokens : Math.min(maxTokens, sessionCap);
  const reasoningEffort =
    thinking === 'off'
      ? 'off'
      : typeof route.reasoningEffort === 'string'
        ? route.reasoningEffort
        : undefined;
  const { messages: history, trimmed } = sanitizeHistory(session.deriveMessages());
  if (trimmed > 0 && typeof onHistoryTrimmed === 'function') onHistoryTrimmed(trimmed);
  const messages = [...history, buildSideQuestionMessage(question)];
  Object.freeze(messages);
  return {
    provider,
    model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(typeof route.temperature === 'number' ? { temperature: route.temperature } : {}),
    messages,
    maxTokens: effectiveMaxTokens,
    sessionId: session.id,
  };
}
