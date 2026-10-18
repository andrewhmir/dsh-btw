// Stylesheet for the /btw overlay. Rendered as a <style> React element inside
// the overlay root, so unmounting the overlay removes it. Every color/shadow
// comes from the harness theme tokens; no hard-coded palette.

export const OVERLAY_CSS = [
  '[data-shortcut-modal="btw"].dsh-btw-backdrop{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;pointer-events:auto;background:color-mix(in srgb,var(--dsw-alias-bg-mask,rgba(8,12,10,.35)) 70%,transparent)}',
  '.dsh-btw-card{box-sizing:border-box;display:flex;flex-direction:column;width:min(640px,100%);max-height:min(70vh,560px);padding:16px 18px;gap:10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:16px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:var(--dsw-shadow-lv2,0 16px 48px rgba(0,0,0,.25))}',
  '.dsh-btw-title{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary,#555)}',
  '.dsh-btw-close{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#555);font-size:16px;line-height:1;padding:4px 8px;border-radius:8px;cursor:pointer}',
  '.dsh-btw-close:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#111)}',
  '.dsh-btw-question{border-left:2px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));padding-left:10px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#555);white-space:pre-wrap;overflow-wrap:anywhere}',
  '.dsh-btw-answer{flex:1 1 auto;min-height:60px;overflow-y:auto;overscroll-behavior:contain;font-size:14px;line-height:22px;white-space:pre-wrap;overflow-wrap:anywhere}',
  '.dsh-btw-thinking{color:var(--dsw-alias-label-secondary,#555)}',
  '.dsh-btw-error{color:var(--dsw-alias-state-error-primary,#b3261e)}',
  '.dsh-btw-note{font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-primary,#8a5a00)}',
  '.dsh-btw-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#777)}',
  '.dsh-btw-status{font-variant-numeric:tabular-nums}',
].join('\n');
