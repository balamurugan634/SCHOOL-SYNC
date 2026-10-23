/** Print a standalone HTML document through a hidden iframe (no pop-up blockers, no app chrome in the printout). */
export const esc = (s: string | number | null | undefined): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const BASE_CSS = `
  *{box-sizing:border-box} body{font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1c1a17;margin:24px}
  h1{font:700 20px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:-.01em;margin:0 0 4px} h2{font:600 14px/1.3 system-ui;margin:18px 0 6px} p{margin:2px 0}
  .muted{color:#6f695f} table{width:100%;border-collapse:collapse;margin-top:6px} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e7e2d9;vertical-align:top}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#4f4a42;background:#f4f1ec} td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
  .row{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap} .box{border:1px solid #d3ccc0;border-radius:8px;padding:10px 14px;margin-top:10px}
  .stop{break-inside:avoid;margin-top:14px} @media print{body{margin:12mm}}
`;

export function printHtml(title: string, bodyHtml: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc || !iframe.contentWindow) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${BASE_CSS}</style></head><body>${bodyHtml}</body></html>`);
  doc.close();
  const win = iframe.contentWindow;
  const go = () => {
    win.focus();
    win.print();
    setTimeout(() => iframe.remove(), 2000);
  };
  if (doc.readyState === 'complete') setTimeout(go, 50);
  else iframe.onload = () => setTimeout(go, 50);
}
