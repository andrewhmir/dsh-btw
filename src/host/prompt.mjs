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
 * Build the GenerateOptions envelope for one side question.
 *
 * No `tools`, `toolHistory`, `system`, or `purpose` keys are ever added: the
 * answer must be tool-less and the request must remain prefix-identical.
 *
 * @param {object} input - inputs for the envelope.
 * @param {object} input.agent - live Agent (needs `.session` and `.options`).
 * @param {string} input.question - the trimmed question text.
 * @param {number} input.maxTokens - completion cap for this call.
 * @returns {object} the request envelope (without `signal`).
 */
export function buildRequestEnvelope({ agent, question, maxTokens }) {
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
  const messages = [...session.deriveMessages(), buildSideQuestionMessage(question)];
  Object.freeze(messages);
  return {
    provider,
    model,
    ...(typeof route.reasoningEffort === 'string' ? { reasoningEffort: route.reasoningEffort } : {}),
    ...(typeof route.temperature === 'number' ? { temperature: route.temperature } : {}),
    messages,
    maxTokens,
    sessionId: session.id,
  };
}
