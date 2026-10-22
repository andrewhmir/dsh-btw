// Stylesheet for the /btw floating card. Rendered as a <style> React element
// inside the panel root, so unmounting the panel removes it. Every color/shadow
// comes from the harness theme tokens; no hard-coded palette.
//
// The dock is click-through (`pointer-events:none`) so only the card itself
// takes input; there is no backdrop and nothing covers the chat.

export const OVERLAY_CSS = [
  '[data-btw-status].dsh-btw-dock{position:absolute;right:20px;bottom:96px;z-index:30;display:flex;justify-content:flex-end;width:min(560px,calc(100% - 32px));pointer-events:none}',
  '.dsh-btw-card{pointer-events:auto;box-sizing:border-box;display:flex;flex-direction:column;width:100%;max-height:min(60vh,520px);padding:14px 16px;gap:8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:14px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:var(--dsw-shadow-lv2,0 16px 48px rgba(0,0,0,.25))}',
  '.dsh-btw-card:focus{outline:2px solid var(--dsw-alias-border-focus,rgba(0,120,255,.45));outline-offset:2px}',
  '.dsh-btw-title{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary,#555)}',
  '.dsh-btw-close{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#555);font-size:16px;line-height:1;padding:4px 8px;border-radius:8px;cursor:pointer}',
  '.dsh-btw-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#111)}',
  '.dsh-btw-question{border-left:2px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));padding-left:10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#555);white-space:pre-wrap;overflow-wrap:anywhere}',
  '.dsh-btw-answer{flex:1 1 auto;min-height:48px;overflow-y:auto;overscroll-behavior:contain;font-size:14px;line-height:22px;white-space:pre-wrap;overflow-wrap:anywhere}',
  '.dsh-btw-answer--markdown{white-space:normal}',
  '.dsh-btw-answer--markdown>:first-child{margin-top:0}',
  '.dsh-btw-answer--markdown>:last-child{margin-bottom:0}',
  '.dsh-btw-answer--markdown pre{max-width:100%;overflow-x:auto}',
  '.dsh-btw-thinking{color:var(--dsw-alias-label-secondary,#555)}',
  '.dsh-btw-error{border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));padding-top:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#b3261e)}',
  '.dsh-btw-note{font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary,#8a5a00)}',
  '.dsh-btw-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#777)}',
  '.dsh-btw-status{font-variant-numeric:tabular-nums}',
].join('\n');
