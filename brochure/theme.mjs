// Look and behaviour of the catalogue: "Paper & Ink" (design.md): warm paper, ink text, deep teal, one amber accent.
// Pages are laid out at A4-landscape size (1122 x 793 px) and scaled to the window; the same markup prints to PDF at 297 x 210 mm.

export const MARK = (size = 20) =>
  `<svg viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="SchoolSync" class="mark"><path d="M22 8H28A4 4 0 0 1 32 12V44A4 4 0 0 1 28 48H22A16 16 0 0 1 6 32V24A16 16 0 0 1 22 8Z" fill="#0E5A63"/><path d="M38 16H42A16 16 0 0 1 58 32V40A16 16 0 0 1 42 56H38A4 4 0 0 1 34 52V20A4 4 0 0 1 38 16Z" fill="#D1411B"/></svg>`;

export const ICONS = {
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.3 2.4 2.4 4.6-5"/>',
  download: '<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M5 19.5h14"/>',
  db: '<ellipse cx="12" cy="5.5" rx="7.5" ry="3"/><path d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  shield: '<path d="M12 3 4.5 6v6c0 4.6 3.1 7.6 7.5 9 4.4-1.4 7.5-4.4 7.5-9V6z"/><path d="m9 12 2.2 2.2L15.2 10"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5"/><path d="m16 7 2.5 2.5"/>',
  users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20c0-3.5 2.8-5.8 6.2-5.8s6.2 2.3 6.2 5.8"/><circle cx="17" cy="9" r="2.4"/><path d="M17 14.2c2.7 0 4.2 1.8 4.2 4.3"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.8 2H4.2z"/><path d="M10 21h4"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5V5.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="m8 15 3.5-4 3 2.5L19 8"/>',
  upload: '<path d="M12 16V5"/><path d="m7.5 9 4.5-4.5L16.5 9"/><path d="M5 19.5h14"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l.8 12.5h8.4L17 7"/>',
};

export const CSS = String.raw`
@font-face{font-family:'Manrope';src:url(assets/fonts/Manrope-var.ttf) format('truetype');font-weight:200 800;font-display:swap}
@font-face{font-family:'Inter';src:url(assets/fonts/Inter-400.ttf) format('truetype');font-weight:400;font-display:swap}
@font-face{font-family:'Inter';src:url(assets/fonts/Inter-500.ttf) format('truetype');font-weight:500;font-display:swap}
@font-face{font-family:'Inter';src:url(assets/fonts/Inter-600.ttf) format('truetype');font-weight:600;font-display:swap}
:root{--paper:#F4F1EC;--surface:#fff;--ink:#1C1A17;--ink2:#4F4A42;--ink3:#6F695F;--line:#E7E2D9;--teal:#0E5A63;--teal-ink:#0B474F;--teal-soft:#E3EFF0;--teal-mid:#CFE6E8;--verm:#D1411B;--verm-ink:#A93310;--verm-soft:#FCE7DD;--amber:#C9731A;--amber-ink:#8A4D0E;--amber-soft:#FBEFD9;--s:1;--ease:cubic-bezier(.2,.7,.2,1)}
*{box-sizing:border-box;margin:0;padding:0}
html{background:#E8E4DC;scroll-behavior:smooth;scroll-padding-top:64px}
body{font:400 15px/1.5 Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
img{display:block;max-width:100%}
a{color:inherit}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}

/* ── navigation (screen only) ─────────────────────────────────────────── */
.nav{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:16px;height:52px;padding:0 20px;background:#F4F1EC;border-bottom:1px solid var(--line)}
.nav-brand{display:flex;align-items:center;gap:9px;text-decoration:none;margin-right:auto}
.nav-brand b{font:700 16px Manrope,Inter,sans-serif;letter-spacing:-.02em}
.nav-brand span{font-size:13px;color:var(--ink3);padding-left:10px;border-left:1px solid var(--line)}
.nav select{height:34px;max-width:46vw;padding:0 30px 0 12px;border:1px solid var(--line);border-radius:8px;background:#fff;font:500 13px Inter,sans-serif;color:var(--ink);cursor:pointer}
.nav-pdf{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border-radius:8px;background:var(--teal);color:#fff;font:600 13px Inter,sans-serif;text-decoration:none;transition:background .15s}
.nav-pdf:hover{background:var(--teal-ink)}
.nav-pdf .ico{width:16px;height:16px}
.progress{position:absolute;left:0;bottom:-1px;height:3px;width:100%;background:var(--verm);transform-origin:0 50%;transform:scaleX(0)}
@media (max-width:640px){.nav{gap:8px;padding:0 12px}.nav-brand span,.nav-brand b{display:none}.nav select{max-width:52vw}}

/* ── deck: every sheet is a fixed-size page scaled to the window ───────── */
.deck{display:flex;flex-direction:column;align-items:center;gap:26px;padding:26px 16px 90px}
.sheet{position:relative;width:calc(1122px*var(--s));height:calc(793px*var(--s));overflow:hidden;border-radius:calc(10px*var(--s));background:var(--paper);box-shadow:0 1px 2px rgba(28,26,23,.08),0 14px 34px rgba(28,26,23,.10)}
.page{position:absolute;left:0;top:0;width:1122px;height:793px;padding:50px 60px 58px;transform:scale(var(--s));transform-origin:0 0;display:flex;flex-direction:column;overflow:hidden}

/* ── type ─────────────────────────────────────────────────────────────── */
.kicker{display:flex;align-items:center;gap:10px;font:600 11.5px Inter,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:var(--teal)}
.kicker::before{content:'';width:20px;height:3px;border-radius:2px;background:var(--verm)}
.title{margin-top:10px;font:700 32px/1.14 Manrope,Inter,sans-serif;letter-spacing:-.025em;text-wrap:balance}
.title em{font-style:normal;color:var(--teal)}
.lede{font-size:14.5px;line-height:1.55;color:var(--ink2);max-width:46ch}
.head{display:block}
.head .lede{margin-top:14px}
.head.wide{display:grid;grid-template-columns:1.15fr 1fr;gap:44px;align-items:end}
.head.wide .lede{margin:0 0 3px}
.points{list-style:none;margin-top:22px;display:grid;gap:11px}
.points li{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;line-height:1.45;color:var(--ink)}
.points .ico{flex:none;width:18px;height:18px;margin-top:1px;color:var(--teal)}
.points.row{display:flex;flex-wrap:wrap;gap:8px 26px;margin-top:16px}
.points.row li{font-size:13px}

/* ── screens ──────────────────────────────────────────────────────────── */
.shot{position:relative;min-width:0}
.frame{overflow:hidden;border:1px solid #DAD4C9;border-radius:10px;background:#fff;box-shadow:0 12px 30px rgba(28,26,23,.14);transition:transform .3s var(--ease),box-shadow .3s var(--ease)}
.bar{display:flex;gap:5px;align-items:center;height:20px;padding:0 9px;background:#F1EEE8;border-bottom:1px solid #E4DFD6}
.bar i{width:7px;height:7px;border-radius:50%;background:#D3CCC0}
.frame img{width:100%;height:auto;cursor:zoom-in}
.shot:hover .frame{transform:translateY(-3px);box-shadow:0 18px 38px rgba(28,26,23,.18)}
figcaption{margin-top:11px;padding-right:6px}
figcaption b{display:block;font:600 13px Inter,sans-serif;color:var(--ink)}
figcaption span{display:block;margin-top:2px;font-size:12px;line-height:1.45;color:var(--ink2)}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:20px}
.row3{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:34px}
.step{position:relative}
.crop{position:relative;aspect-ratio:4/3.9;overflow:hidden}
.crop img{position:absolute;left:0;top:0;width:100%;height:auto;cursor:zoom-in}
.step .num{position:absolute;z-index:2;left:-10px;top:-14px;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--verm);color:#fff;font:700 14px Manrope,sans-serif;box-shadow:0 0 0 4px var(--paper)}
.split{display:grid;grid-template-columns:330px 1fr;gap:42px;flex:1;min-height:0;align-items:center}
.split .side{align-self:start;padding-top:8px}
.split .stage{display:grid;gap:18px;align-content:center}
.phonesplit{grid-template-columns:250px 1fr;gap:30px}
.phonesplit .side .title{font-size:27px}
.phonesplit .side .lede{font-size:13.5px}
.phones{display:flex;gap:12px;align-items:flex-start;justify-content:flex-end}
.phones .shot{width:172px}
.device{padding:6px;border-radius:30px;background:#1C1A17;box-shadow:0 16px 32px rgba(28,26,23,.22),inset 0 0 0 1px #3a3631;transition:transform .3s var(--ease)}
.device img{width:100%;height:auto;border-radius:24px;cursor:zoom-in;background:#fff}
.shot.phone:hover .device{transform:translateY(-4px)}
.pair{display:flex;gap:18px;justify-content:center}
.pair .shot{width:160px}

/* ── page footer ─────────────────────────────────────────────────────── */
.foot{position:absolute;left:60px;right:60px;bottom:22px;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--ink3);letter-spacing:.01em}
.foot .brand{display:inline-flex;align-items:center;gap:7px}.foot .brand b{color:var(--ink);font-weight:600}
.foot em{font-style:normal;font-weight:600;color:var(--ink);margin-left:14px;font-variant-numeric:tabular-nums}

/* ── cover ───────────────────────────────────────────────────────────── */
.cover{padding:0;background:var(--paper)}
.cover .panel{position:absolute;right:0;top:0;bottom:0;width:560px;background:var(--teal)}
.cover .panel::before{content:'';position:absolute;left:-1px;top:0;bottom:0;width:70px;background:var(--paper);border-radius:0 70px 70px 0}
.cover .copy{position:absolute;left:60px;top:70px;width:470px}
.cover .wordmark{display:flex;align-items:center;gap:12px;font:700 24px Manrope,sans-serif;letter-spacing:-.025em}
.cover h1{margin-top:74px;font:700 47px/1.08 Manrope,Inter,sans-serif;letter-spacing:-.035em;text-wrap:balance}
.cover h1 em{font-style:normal;color:var(--teal)}
.cover .sub{margin-top:20px;font-size:16px;line-height:1.55;color:var(--ink2);max-width:40ch}
.cover .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:30px}
.chip{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 13px;border-radius:15px;background:#fff;border:1px solid var(--line);font:500 12.5px Inter,sans-serif;color:var(--ink)}
.chip b{font-weight:700;color:var(--teal)}
.cover .note{position:absolute;left:60px;bottom:34px;font-size:11.5px;color:var(--ink3)}
.cover .dash{position:absolute;left:520px;top:128px;width:560px;--rot:-1.2deg;animation:drift 7s ease-in-out infinite}
.cover .dash .frame{box-shadow:0 26px 50px rgba(0,0,0,.28);border-color:transparent}
.cover .ph1{position:absolute;left:468px;top:372px;width:168px;--rot:-3deg;animation:drift 6s ease-in-out -2s infinite}
.cover .ph2{position:absolute;left:896px;top:420px;width:168px;--rot:2.5deg;animation:drift 8s ease-in-out -4s infinite}
.cover .ph1 .device,.cover .ph2 .device{box-shadow:0 26px 46px rgba(0,0,0,.34)}
.cover .dot{position:absolute;border-radius:50%;background:var(--verm)}
.cover .dot.a{left:1010px;top:60px;width:26px;height:26px}
.cover .dot.b{left:612px;top:700px;width:12px;height:12px;background:#CFE6E8}
@keyframes drift{0%,100%{transform:translateY(0) rotate(var(--rot,0deg))}50%{transform:translateY(-9px) rotate(var(--rot,0deg))}}

/* ── contents ────────────────────────────────────────────────────────── */
.toc-list{display:grid;grid-template-columns:1fr 1fr;column-gap:56px;margin-top:26px;align-content:start}
.toc-row{display:flex;align-items:baseline;gap:10px;padding:8px 0;text-decoration:none;border-bottom:1px solid var(--line);transition:background .15s,padding .2s var(--ease)}
.toc-row:hover{padding-left:8px;background:#fff}
.toc-name b{display:block;font:600 14.5px Manrope,Inter,sans-serif;letter-spacing:-.01em}
.toc-name small{display:block;font-size:12px;color:var(--ink3);margin-top:1px}
.toc-dots{flex:1}
.toc-pg{font:700 14px Manrope,sans-serif;color:var(--teal);font-variant-numeric:tabular-nums}

/* ── at a glance ─────────────────────────────────────────────────────── */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:34px}
.stat{padding:18px 20px;border-radius:14px;background:#fff;border:1px solid var(--line)}
.stat .n{font:700 44px/1 Manrope,sans-serif;letter-spacing:-.04em;color:var(--teal);font-variant-numeric:lining-nums tabular-nums}
.stat .n small{font-size:.5em;letter-spacing:0;margin-left:2px;color:var(--ink3)}
.stat .l{margin-top:8px;font:600 13px Inter,sans-serif}
.stat .d{margin-top:2px;font-size:12px;color:var(--ink2);line-height:1.4}
.roles{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:20px}
.role{display:flex;flex-direction:column;border-radius:14px;background:#fff;border:1px solid var(--line);overflow:hidden}
.role .art{background:var(--teal-soft);padding:6px 10px;height:150px;display:grid;place-items:center}
.role .art img{height:136px;width:auto}
.role .tx{padding:14px 16px 16px}
.role h3{font:700 16px Manrope,sans-serif;letter-spacing:-.02em}
.role p{margin-top:5px;font-size:12.5px;line-height:1.5;color:var(--ink2)}
.role .on{margin-top:10px;font:600 11px Inter,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:var(--verm-ink)}

/* ── architecture diagram ────────────────────────────────────────────── */
.arch{display:grid;grid-template-columns:250px 56px 1fr 56px 290px;gap:0;align-items:center;margin-top:36px;flex:1;min-height:0;padding-bottom:20px}
.col-h{font:600 11px Inter,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3);margin-bottom:12px}
.box{border-radius:12px;background:#fff;border:1px solid var(--line);padding:12px 14px;display:flex;gap:12px;align-items:center}
.box+.box{margin-top:10px}
.box .ico{width:22px;height:22px;color:var(--teal);flex:none}
.box b{display:block;font:600 13px Inter,sans-serif}
.box small{display:block;font-size:11.5px;color:var(--ink2);line-height:1.35}
.core{padding:22px;border-radius:16px;background:var(--teal);color:#fff}
.core h3{font:700 19px Manrope,sans-serif;letter-spacing:-.02em}
.core p{margin-top:6px;font-size:12.5px;line-height:1.5;color:#D6E8EA}
.core ul{list-style:none;margin-top:14px;display:grid;gap:8px}
.core li{display:flex;gap:9px;font-size:12.5px;color:#fff}
.core li .ico{width:16px;height:16px;flex:none;margin-top:1px;color:#F2C48D}
.flow{width:100%;height:30px}
.flow line{stroke:var(--verm);stroke-width:2;stroke-dasharray:6 7;animation:dash 1.2s linear infinite}
@keyframes dash{to{stroke-dashoffset:-26}}
.db{position:relative;border-radius:12px;background:#fff;border:1px solid var(--line);padding:12px 14px 12px 50px}
.db+.db{margin-top:10px}
.db .ico{position:absolute;left:14px;top:50%;margin-top:-13px;width:26px;height:26px;color:var(--teal)}
.db b{display:block;font:600 13px Inter,sans-serif}
.db small{display:block;font-size:11.5px;color:var(--ink2)}
.db.ctl{background:var(--verm-soft);border-color:#F1C6B3}
.db.ctl .ico{color:var(--verm)}

/* ── cards: security / pricing ───────────────────────────────────────── */
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:34px}
.cards.c3{grid-template-columns:repeat(3,1fr)}
.cards.c2{grid-template-columns:repeat(2,1fr)}
.card{padding:20px 19px 21px;border-radius:14px;background:#fff;border:1px solid var(--line);transition:transform .25s var(--ease),border-color .2s}
.card:hover{transform:translateY(-3px);border-color:#CFC7B8}
.card .ic{display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:var(--teal-soft);color:var(--teal)}
.card .ic .ico{width:19px;height:19px}
.card h3{margin-top:12px;font:700 14.5px Manrope,sans-serif;letter-spacing:-.015em}
.card p{margin-top:6px;font-size:12.8px;line-height:1.55;color:var(--ink2)}
.road{margin-top:26px;display:flex;gap:10px;align-items:center;padding:11px 16px;border-radius:12px;background:var(--amber-soft);border:1px solid #EBD3AA;font-size:12.3px;color:var(--ink)}
.road b{font-weight:600;color:var(--amber-ink);white-space:nowrap}

/* ── pricing ─────────────────────────────────────────────────────────── */
.price-grid .card{padding:15px 17px 16px}
.price-grid .card h3{margin-top:10px}
.price-grid{display:grid;grid-template-columns:1fr 440px;gap:30px;margin-top:22px;flex:1;min-height:0;align-items:start}
.big{display:flex;align-items:baseline;gap:14px;margin-top:6px}
.big .u{font:700 52px/1 Manrope,sans-serif;letter-spacing:-.04em;color:var(--teal)}
.big .t{font:600 16px Manrope,sans-serif;color:var(--ink2);letter-spacing:-.01em}
.life{display:flex;align-items:center;margin-top:20px;padding:14px 16px;border-radius:14px;background:#fff;border:1px solid var(--line)}
.life .st{flex:1;text-align:center}
.life .st b{display:block;font:600 12.5px Inter,sans-serif}
.life .st small{display:block;font-size:11px;color:var(--ink2);margin-top:2px;line-height:1.35}
.life .pill{display:inline-block;margin-bottom:6px;padding:3px 10px;border-radius:10px;font:600 10.5px Inter,sans-serif;letter-spacing:.05em;text-transform:uppercase}
.p-ok{background:#E2F0E6;color:#2A7448}.p-grace{background:var(--amber-soft);color:var(--amber-ink)}.p-ro{background:#EFEAE0;color:var(--ink2)}
.life .ar{width:34px;height:14px;color:var(--ink3);flex:none}
.life .ar line{stroke:currentColor;stroke-width:1.6;stroke-dasharray:4 5;animation:dash 1.4s linear infinite}

/* ── roll-out timeline ───────────────────────────────────────────────── */
.tl{display:grid;grid-template-columns:repeat(4,1fr);gap:22px;margin-top:56px;position:relative}
.tl::before{content:'';position:absolute;left:16px;right:16px;top:17px;height:2px;background:repeating-linear-gradient(90deg,var(--verm) 0 7px,transparent 7px 14px)}
.tl .st{position:relative;padding-top:50px}
.tl .st .n{position:absolute;top:0;left:0;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--teal);color:#fff;font:700 15px Manrope,sans-serif;box-shadow:0 0 0 6px var(--paper)}
.tl h3{font:700 16px Manrope,sans-serif;letter-spacing:-.02em}
.tl p{margin-top:8px;font-size:13.2px;line-height:1.55;color:var(--ink2)}
.closing{margin-top:64px;display:grid;grid-template-columns:1fr 260px;gap:30px;align-items:center;padding:38px 42px;border-radius:18px;background:var(--teal);color:#fff}
.closing h3{font:700 26px/1.2 Manrope,sans-serif;letter-spacing:-.03em}
.closing p{margin-top:8px;font-size:13.5px;line-height:1.55;color:#D6E8EA;max-width:52ch}
.closing img{width:240px;justify-self:end}

/* ── lightbox ────────────────────────────────────────────────────────── */
.lightbox{position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:rgba(28,26,23,.82);padding:28px;cursor:zoom-out;animation:fade .2s var(--ease)}
.lightbox[hidden]{display:none}
.lightbox img{max-width:min(96vw,1700px);max-height:92vh;border-radius:10px;box-shadow:0 30px 80px rgba(0,0,0,.5);background:#fff}
.lb-close{position:absolute;right:18px;top:12px;width:40px;height:40px;border:0;border-radius:50%;background:#fff;font-size:26px;line-height:1;cursor:pointer}
@keyframes fade{from{opacity:0}}

/* ── entrance animation (screen only; skipped for print and reduced motion) ── */
.js [data-r]{opacity:0;transform:translateY(16px);transition:opacity .6s var(--ease) calc(var(--i,0)*90ms),transform .6s var(--ease) calc(var(--i,0)*90ms)}
.js [data-r="phone"]{transform:translateY(46px)}
.js .sheet.in [data-r]{opacity:1;transform:none}
.js .cover .dash,.js .cover .ph1,.js .cover .ph2{opacity:0}
.js .sheet.in .cover .dash,.js .sheet.in .cover .ph1,.js .sheet.in .cover .ph2{opacity:1;transition:opacity .8s var(--ease) .3s}
@media (prefers-reduced-motion:reduce){
  .js [data-r],.js [data-r="phone"]{opacity:1;transform:none;transition:none}
  *{animation:none!important}
}

/* ── print: A4 landscape, one sheet per page ─────────────────────────── */
@page{size:297mm 210mm;margin:0}
@media print{
  :root{--s:1}
  html,body{background:#fff}
  .nav,.lightbox{display:none!important}
  .deck{display:block;padding:0;gap:0}
  .sheet{width:297mm;height:210mm;border-radius:0;box-shadow:none;break-after:page;page-break-after:always}
  .sheet:last-child{break-after:auto;page-break-after:auto}
  .page{transform:none!important;width:297mm;height:210mm}
  *{animation:none!important;transition:none!important}
  [data-r],.js [data-r]{opacity:1!important;transform:none!important}
  .cover .dash,.cover .ph1,.cover .ph2{opacity:1!important}
  body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
`;

export const JS = String.raw`
(function(){
  var root = document.documentElement;
  root.classList.add('js');
  function fit(){ var s = Math.min(1.3, Math.max(0.28, (root.clientWidth - 32) / 1122)); root.style.setProperty('--s', s.toFixed(4)); }
  fit(); addEventListener('resize', fit);

  function countUp(scope){
    scope.querySelectorAll('[data-count]:not(.done)').forEach(function(el){
      el.classList.add('done');
      var to = +el.dataset.count, t0 = performance.now(), dur = 1100; el.firstChild.nodeValue = 0;
      (function step(t){ var k = Math.min(1, (t - t0) / dur); el.firstChild.nodeValue = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); })(t0);
    });
  }
  var sheets = [].slice.call(document.querySelectorAll('.sheet'));
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function(es){ es.forEach(function(e){ if (e.isIntersecting) { e.target.classList.add('in'); countUp(e.target); } }); }, { threshold: 0.16 });
    sheets.forEach(function(s){ io.observe(s); });
  } else { sheets.forEach(function(s){ s.classList.add('in'); }); }

  var bar = document.getElementById('progress');
  function prog(){ var h = root.scrollHeight - root.clientHeight; bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, scrollY / h) : 0) + ')'; }
  addEventListener('scroll', prog, { passive: true }); prog();

  var jump = document.getElementById('jump');
  jump.addEventListener('change', function(){ if (jump.value) { location.hash = jump.value; jump.selectedIndex = 0; } });

  var lb = document.getElementById('lightbox'), lbImg = lb.querySelector('img');
  document.addEventListener('click', function(e){
    var img = e.target.closest && e.target.closest('.shot img');
    if (img) { lbImg.src = img.currentSrc || img.src; lbImg.alt = img.alt; lb.hidden = false; return; }
    if (!lb.hidden && e.target.closest('.lightbox')) lb.hidden = true;
  });
  addEventListener('keydown', function(e){
    if (e.key === 'Escape') { lb.hidden = true; return; }
    if (!lb.hidden || /input|select|textarea/i.test(e.target.tagName)) return;
    var i = sheets.findIndex(function(s){ var r = s.getBoundingClientRect(); return r.bottom > innerHeight * 0.4; });
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); (sheets[Math.min(sheets.length - 1, i + 1)] || sheets[0]).scrollIntoView(); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); (sheets[Math.max(0, i - 1)] || sheets[0]).scrollIntoView(); }
  });
})();
`;
