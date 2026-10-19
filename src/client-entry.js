// dsh-btw client entry (concatenated verbatim into the generated client.js).
//
// Two registrations on the browser plugin context:
//   1. a '/' input-trigger source that claims `/btw <question>` before any host
//      command runs — the strict-ephemerality seam;
//   2. a `shell.overlay` list entry that renders the side answer.
//
// `submitQuestion` is the only bridge between them: it opens the overlay store,
// starts the one host request without awaiting it, and lets the composer treat
// the invocation as successful (the draft clears, the overlay owns the stream).

var React = require('react');
var primitives = null;
try {
  primitives = require('@deepseek-ai/dsh-client-ui-primitives');
} catch (error) {
  // The primitives package is seeded by the shipped shell; an older shell that
  // lacks it degrades to the plain-text answer path.
  primitives = null;
}
var MarkdownText = primitives !== null && typeof primitives.MarkdownText === 'function' ? primitives.MarkdownText : undefined;
var trigger = __dsh_btw.trigger;
var storeModule = __dsh_btw.store;
var stream = __dsh_btw.stream;
var overlay = __dsh_btw.overlay;

function apply(ctx) {
  var store = storeModule.createOverlayStore();

  var source = trigger.createBtwSource({
    submitQuestion: function (sessionId, question) {
      var run = store.start({ sessionId: sessionId, question: question });
      void stream.askBtw({
        url: '/btw/ask',
        sessionId: sessionId,
        question: question,
        signal: run.signal,
        handlers: { onDelta: run.onDelta, onDone: run.onDone, onError: run.onError },
      });
      return { kind: 'success' };
    },
  });

  var inputTriggers = ctx.get('inputTriggers');
  if (inputTriggers !== undefined) {
    ctx.effect(function () {
      return inputTriggers.registerSource(source);
    }, 'btw: slash source');
  }

  var slots = ctx.get('slots');
  if (slots !== undefined) {
    slots.inject('shell.overlay', function () {
      return slots.register(
        { name: 'shell.overlay', id: 'btw-overlay', order: 100 },
        overlay.createOverlayComponent({ React: React, store: store, MarkdownText: MarkdownText }),
      );
    });
  }
}

exports.name = "dsh-btw";
exports.inject = ["slots", "inputTriggers"];
exports.apply = apply;
