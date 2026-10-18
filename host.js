// dsh-btw host half.
//
// One Loader plugin row (`id: btw, name: dsh-btw`): resolve the injected
// services, build the loopback-only /btw route, and own its lifetime through
// `ctx.effect`. The service lookup is defensive because a missing service means
// the row cannot work and must not take the rest of the profile down with it;
// Cordis `inject` normally guarantees they exist.

import { createBtwHost } from './src/host/route.mjs';

export const name = 'dsh-btw';
export const inject = ['webServer', 'llm', 'agents'];

/**
 * Mount the host half on the composed harness context.
 * @param {object} ctx - Cordis context carrying the injected services.
 * @param {object} [config] - raw optional row config (`maxTokens`, `timeoutMs`).
 * @returns {void}
 */
export function apply(ctx, config) {
  const webServer = ctx.get('webServer');
  const llm = ctx.get('llm');
  const agents = ctx.get('agents');
  if (webServer === undefined || llm === undefined || agents === undefined) return;
  const host = createBtwHost({ webServer, llm, agents, logger: ctx.logger, config });
  ctx.effect(host.register, 'btw: web route');
}
