const COLORS = {
  ink: "#171815",
  paper: "#f2ead8",
  paper2: "#e9dec5",
  red: "#c44126",
  green: "#16634e",
  gold: "#c69b52",
  muted: "#746e62",
  dark: "#0e110f",
  line: "rgba(23,24,21,.18)",
};

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fmt(value, digits = 0) {
  return Number(value ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function money(value, digits = 2) {
  return `$${fmt(value, digits)}`;
}

function mark(size = 48) {
  return `<span class="mark" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .54)}px">K</span>`;
}

const baseCss = `
  :root { color-scheme: only light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${COLORS.dark}; color: ${COLORS.ink}; }
  body { font-family: "Segoe UI", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  .frame { width: 1920px; height: 1080px; position: relative; overflow: hidden; background:
    radial-gradient(circle at 88% 8%, rgba(196,65,38,.18), transparent 28%),
    radial-gradient(circle at 8% 88%, rgba(22,99,78,.18), transparent 30%),
    ${COLORS.dark}; }
  .frame:before { content: ""; position: absolute; inset: 0; opacity: .16; pointer-events: none;
    background-image: repeating-linear-gradient(0deg, transparent 0 3px, rgba(255,255,255,.025) 4px); }
  .safe { position: absolute; inset: 64px 76px 82px; z-index: 1; }
  .eyebrow { color: ${COLORS.red}; letter-spacing: .2em; text-transform: uppercase; font-size: 17px; font-weight: 800; }
  h1, h2, h3, p { margin: 0; }
  h1, h2 { font-family: Georgia, "Times New Roman", serif; font-weight: 500; letter-spacing: -.035em; }
  h1 { font-size: 92px; line-height: .98; }
  h2 { font-size: 62px; line-height: 1.02; }
  h3 { font-size: 23px; line-height: 1.2; }
  .green { color: ${COLORS.green}; font-style: italic; }
  .red { color: ${COLORS.red}; }
  .muted { color: ${COLORS.muted}; }
  .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 34px; color: ${COLORS.paper}; }
  .brand { display: flex; align-items: center; gap: 14px; font-family: Georgia, serif; font-size: 25px; }
  .mark { display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; color: ${COLORS.red}; background: ${COLORS.paper}; border: 2px solid ${COLORS.red}; font-family: Georgia, serif; font-weight: 700; box-shadow: inset 0 0 0 4px ${COLORS.paper}, inset 0 0 0 5px ${COLORS.red}; }
  .scene-no { color: rgba(242,234,216,.7); font-size: 16px; text-transform: uppercase; letter-spacing: .16em; }
  .browser { background: ${COLORS.paper}; border: 1px solid rgba(255,255,255,.16); border-radius: 17px; overflow: hidden; box-shadow: 0 28px 90px rgba(0,0,0,.42); }
  .browser-bar { height: 48px; display: flex; align-items: center; gap: 12px; padding: 0 18px; border-bottom: 1px solid ${COLORS.line}; background: #e8dfcd; color: #6a655a; font-size: 14px; }
  .dots { display: flex; gap: 7px; }
  .dots i { display: block; width: 10px; height: 10px; border-radius: 50%; background: #c9bda6; }
  .dots i:first-child { background: ${COLORS.red}; }
  .address { flex: 1; border: 1px solid rgba(23,24,21,.13); border-radius: 7px; padding: 7px 14px; background: rgba(255,255,255,.35); }
  .browser-shot { width: 100%; display: block; background: ${COLORS.paper}; }
  .paper-card { background: ${COLORS.paper}; border: 1px solid ${COLORS.line}; box-shadow: 0 22px 60px rgba(0,0,0,.26); }
  .tag { display: inline-flex; align-items: center; border: 1px solid currentColor; border-radius: 999px; padding: 7px 12px; text-transform: uppercase; letter-spacing: .1em; font-size: 13px; font-weight: 800; }
  .caption-bar { position: absolute; left: 76px; right: 76px; bottom: 25px; color: rgba(242,234,216,.62); display: flex; justify-content: space-between; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; z-index: 4; }
  .metric { border-left: 3px solid ${COLORS.red}; padding-left: 18px; }
  .metric strong { font-family: Georgia, serif; font-size: 43px; font-weight: 500; display: block; color: ${COLORS.ink}; }
  .metric span { display: block; margin-top: 5px; color: ${COLORS.muted}; font-size: 14px; text-transform: uppercase; letter-spacing: .1em; }
  .code-card { border-radius: 14px; overflow: hidden; background: #151a17; color: #e7e1d4; border: 1px solid rgba(255,255,255,.14); box-shadow: 0 24px 70px rgba(0,0,0,.36); }
  .code-head { padding: 14px 20px; color: #d9d0bd; background: #202621; border-bottom: 1px solid rgba(255,255,255,.1); font-family: Consolas, monospace; font-size: 15px; }
  pre { margin: 0; padding: 20px 22px; white-space: pre-wrap; font: 15px/1.42 Consolas, "Courier New", monospace; }
  .callout { display: flex; gap: 12px; align-items: flex-start; color: ${COLORS.paper}; }
  .callout b { color: #fff; }
  .callout i { width: 9px; height: 9px; border-radius: 50%; background: ${COLORS.red}; margin-top: 7px; flex: none; }
  .pill-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .pill { color: ${COLORS.paper}; border: 1px solid rgba(242,234,216,.26); background: rgba(242,234,216,.06); border-radius: 999px; padding: 9px 15px; font-size: 15px; }
`;

function shell(title, body, scene, extraCss = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss}${extraCss}</style></head><body>
    <main class="frame">
      <div class="safe">
        <div class="topbar"><div class="brand">${mark()}<span>Keryx</span></div><div class="scene-no">Circle 2026 Cohort 2 · ${esc(scene)}</div></div>
        ${body}
      </div>
      <div class="caption-bar"><span>Every citation pays its creator.</span><span>${esc(title)}</span></div>
    </main>
  </body></html>`;
}

function browser(src, url, className = "") {
  return `<div class="browser ${className}"><div class="browser-bar"><span class="dots"><i></i><i></i><i></i></span><span class="address">${esc(url)}</span><span>LIVE</span></div><img class="browser-shot" src="${esc(src)}"></div>`;
}

function codeCard(path, code) {
  return `<div class="code-card"><div class="code-head">${esc(path)}</div><pre>${esc(code)}</pre></div>`;
}

export function renderScene(scene, ctx) {
  const { media, metrics, health, treasury, code } = ctx;
  if (scene === "01-hook") {
    return shell("The citation economy", `
      <div style="display:grid;grid-template-columns:660px 1fr;gap:52px;align-items:center;height:835px">
        <div style="color:${COLORS.paper}">
          <div class="eyebrow">For the writers AI reads</div>
          <h1 style="margin-top:20px">Citation<br><span class="green">becomes payment.</span></h1>
          <p style="font-size:25px;line-height:1.48;color:rgba(242,234,216,.74);margin-top:30px;max-width:590px">A reading agent with a budget buys exact evidence, explains every decision, and settles weighted USDC rewards to the creators it cites.</p>
          <div class="pill-row" style="margin-top:34px"><span class="pill">USDC</span><span class="pill">Arc</span><span class="pill">x402</span><span class="pill">Gateway Nanopayments</span></div>
        </div>
        ${browser(media.home, "keryx.cc", "hero-browser")}
      </div>`, "01 · thesis", `.hero-browser{transform:rotate(.7deg)} .hero-browser .browser-shot{height:745px;object-fit:cover;object-position:top}`);
  }

  if (scene === "02-loop") {
    const steps = [
      ["01", "Question + budget", "The user funds a bounded session."],
      ["02", "Discover + decide", "BUY · SKIP · CACHE, each with rationale."],
      ["03", "x402 access toll", "Pay only for selected article versions."],
      ["04", "Evidence gate", "Cite only claims supported by paid content."],
      ["05", "Weighted reward", "Settle USDC to creators actually cited."],
    ];
    return shell("The agentic payment loop", `
      <div style="color:${COLORS.paper}"><div class="eyebrow">Agency and payment state stay visible</div><h2 style="margin-top:13px">One budget. Two tolls. <span class="green">No hidden custody.</span></h2></div>
      <div class="flow" style="margin-top:55px;display:grid;grid-template-columns:repeat(5,1fr);gap:18px;position:relative">
        ${steps.map(([n,t,d], i) => `<div class="paper-card" style="height:320px;padding:28px;position:relative;border-top:5px solid ${i === 4 ? COLORS.green : COLORS.red}"><div style="font:700 15px Consolas;color:${COLORS.red}">${n}</div><h3 style="font-family:Georgia,serif;font-size:31px;margin-top:40px">${t}</h3><p style="font-size:18px;line-height:1.45;color:${COLORS.muted};margin-top:20px">${d}</p>${i < 4 ? `<div style="position:absolute;right:-28px;top:139px;z-index:3;color:${COLORS.gold};font-size:30px">→</div>` : ""}</div>`).join("")}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:22px;margin-top:28px;color:${COLORS.paper}">
        <div class="callout"><i></i><div><b>Browser-held session key</b><br><span style="color:rgba(242,234,216,.62)">The funded balance is the economic cap.</span></div></div>
        <div class="callout"><i></i><div><b>SourceRegistry payout authority</b><br><span style="color:rgba(242,234,216,.62)">The chain, not a database edit, selects payees.</span></div></div>
        <div class="callout"><i></i><div><b>Exact micro-USDC accounting</b><br><span style="color:rgba(242,234,216,.62)">Multi-author legs sum without rounding drift.</span></div></div>
      </div>`, "02 · economic loop");
  }

  if (scene === "03-dispatch") {
    return shell("A real public dispatch", `
      <div style="display:grid;grid-template-columns:1fr 420px;gap:30px;height:820px">
        ${browser(media.dispatchTop, "keryx.cc/dispatch/5b5c…", "dispatch-main")}
        <aside class="paper-card" style="padding:32px;align-self:stretch">
          <div class="eyebrow">Arc testnet · settled</div>
          <h2 style="font-size:46px;margin-top:18px">The dispatch,<br><span class="green">itemised.</span></h2>
          <div style="display:grid;gap:28px;margin-top:48px">
            <div class="metric"><strong>$0.050</strong><span>hard budget ceiling</span></div>
            <div class="metric"><strong>3</strong><span>sources cited and rewarded</span></div>
            <div class="metric"><strong>40 / 40 / 20</strong><span>evidence-weighted reward split</span></div>
          </div>
          <div style="margin-top:44px;padding:20px;border:1px solid ${COLORS.line};background:#ece2cd"><b style="color:${COLORS.red}">BUY</b> three relevant pieces<br><b style="color:${COLORS.muted}">SKIP</b> weak or overpriced candidates<br><b style="color:${COLORS.green}">STOP</b> inside the cap</div>
        </aside>
      </div>`, "03 · live product", `.dispatch-main .browser-shot{height:770px;object-fit:cover;object-position:top}`);
  }

  if (scene === "04-receipts") {
    return shell("From HTTP 402 to creator reward", `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;height:815px">
        <div>${browser(media.dispatchAnswer, "keryx.cc/dispatch/5b5c…#answer", "receipt-shot")}<div class="tag" style="color:${COLORS.paper};margin-top:18px">Cited answer + contribution weights</div></div>
        <div>${browser(media.dispatchRewards, "keryx.cc/dispatch/5b5c…#receipts", "receipt-shot")}<div class="tag" style="color:${COLORS.paper};margin-top:18px">Circle settlement references retained</div></div>
      </div>`, "04 · integration demo", `.receipt-shot .browser-shot{height:710px;object-fit:cover;object-position:top}`);
  }

  if (scene === "05-circle-code") {
    return shell("Circle integration in the codebase", `
      <div style="color:${COLORS.paper};display:flex;justify-content:space-between;align-items:end"><div><div class="eyebrow">Actual production code</div><h2 style="margin-top:10px">Buyer and seller,<br><span class="green">both on Gateway.</span></h2></div><div class="pill-row" style="max-width:600px;justify-content:flex-end"><span class="pill">@circle-fin/x402-batching</span><span class="pill">Unified Balance Kit</span><span class="pill">USDC on Arc</span></div></div>
      <div style="display:grid;grid-template-columns:.86fr 1.14fr;gap:26px;margin-top:34px">
        ${codeCard("lib/payments/real-gateway.ts · buyer", code.realGateway)}
        ${codeCard("lib/x402-server.ts · seller requirements", code.x402Server)}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:26px">
        <div class="callout"><i></i><div><b>Exact Arc network + USDC asset</b></div></div>
        <div class="callout"><i></i><div><b>Creator-owned payTo</b></div></div>
        <div class="callout"><i></i><div><b>Gateway verifying contract</b></div></div>
      </div>`, "05 · code walkthrough");
  }

  if (scene === "06-authority-code") {
    return shell("Non-custodial authority boundaries", `
      <div style="display:grid;grid-template-columns:1.18fr .82fr;gap:28px">
        ${codeCard("lib/payments/browser-cosign-gateway.ts", code.browserCosign)}
        ${codeCard("contracts/source-registry.sol", code.registry)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:26px">
        <div class="paper-card" style="padding:24px 28px"><div class="eyebrow">Before signing</div><h3 style="margin-top:9px">Atomic reservation enforces the session cap.</h3><p class="muted" style="margin-top:8px">The browser validates payee, amount and exact article identity again.</p></div>
        <div class="paper-card" style="padding:24px 28px"><div class="eyebrow">After submission</div><h3 style="margin-top:9px">Missing evidence becomes pending, never invented settlement.</h3><p class="muted" style="margin-top:8px">SourceRegistry remains the payout authority.</p></div>
      </div>`, "06 · trust model");
  }

  if (scene === "07-proof") {
    const m = metrics.metrics;
    const t = health.traction;
    return shell("Proof, with its limits attached", `
      <div style="display:grid;grid-template-columns:1.2fr .8fr;gap:28px;height:820px">
        ${browser(media.dashboardTop, "keryx.cc/dashboard", "proof-browser")}
        <div style="display:grid;grid-template-rows:auto 1fr;gap:22px">
          <div class="paper-card" style="padding:28px"><div class="eyebrow">Settled-only snapshot</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:25px"><div class="metric"><strong>${fmt(m.totalPayments)}</strong><span>settled payments</span></div><div class="metric"><strong>${money(m.totalVolumeUsdc, 2)}</strong><span>testnet USDC volume</span></div><div class="metric"><strong>${money(m.totalCreatorPayoutsUsdc, 2)}</strong><span>creator payouts</span></div><div class="metric"><strong>${fmt(m.creatorsEarning)}</strong><span>registry wallets earning</span></div></div></div>
          <div class="paper-card" style="padding:28px;background:#e9dfca"><div class="eyebrow">Independent demand</div><h3 style="font-family:Georgia,serif;font-size:31px;margin-top:10px">${fmt(t.externalQueries)} queries · ${fmt(t.externalPayments)} payments</h3><p style="font-size:18px;line-height:1.5;margin-top:17px;color:${COLORS.muted}">${fmt(t.returningExternalActors)} of ${fmt(t.identifiedExternalActors)} identified external actors returned. ${fmt(t.externalSettlementAttempts)} of ${fmt(t.externalSettlementAttempts)} measured external settlement attempts succeeded.</p><div class="pill-row" style="margin-top:24px"><span class="tag" style="color:${COLORS.green}">0 pending</span><span class="tag" style="color:${COLORS.green}">0 failed</span><span class="tag" style="color:${COLORS.green}">${fmt(health.registry.parity.issueCount)} registry mismatches</span></div></div>
        </div>
      </div>`, "07 · traction and verification", `.proof-browser .browser-shot{height:770px;object-fit:cover;object-position:top}`);
  }

  if (scene === "08-roadmap") {
    return shell("From proven testnet loop to Arc mainnet", `
      <div style="color:${COLORS.paper}"><div class="eyebrow">Circle product roadmap</div><h2 style="margin-top:12px">Shipping evidence first.<br><span class="green">Scaling responsibly next.</span></h2></div>
      <div style="display:grid;grid-template-columns:.9fr 1.1fr;gap:34px;margin-top:44px">
        <div class="paper-card" style="padding:34px;border-top:6px solid ${COLORS.green}"><div class="tag" style="color:${COLORS.green}">Live now</div><h3 style="font-family:Georgia,serif;font-size:34px;margin-top:24px">USDC · Agent Stack · App Kits · Gateway</h3><p class="muted" style="font-size:18px;line-height:1.55;margin-top:18px">Gateway Nanopayments and x402 for buyer and seller flows. Unified Balance Kit for public treasury proof.</p><div style="margin-top:29px;font:15px/1.6 Consolas;color:${COLORS.ink}">Arc testnet<br>${esc(health.registry.address)}<br>Production commit ${esc(health.commit)}</div></div>
        <div class="paper-card" style="padding:34px;border-top:6px solid ${COLORS.red}"><div class="tag" style="color:${COLORS.red}">Grant milestones · 6 months</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:21px;margin-top:25px"><div><b>01 · Security</b><p class="muted" style="margin-top:7px">Independent review and mainnet release candidate.</p></div><div><b>02 · Funding</b><p class="muted" style="margin-top:7px">CCTP + Forwarding Service from Ethereum and Base.</p></div><div><b>03 · Agent access</b><p class="muted" style="margin-top:7px">Optional Circle Wallets for programmatic callers.</p></div><div><b>04 · Adoption</b><p class="muted" style="margin-top:7px">External creator and agent pilots.</p></div></div><div style="margin-top:28px;padding:19px;background:#e9dec7;border:1px solid ${COLORS.line};font-family:Georgia,serif;font-size:25px">Audited Arc mainnet launch.</div></div>
      </div>
      <div style="color:${COLORS.paper};font:34px/1.2 Georgia,serif;margin-top:36px;text-align:center">Every decision visible. Every reward evidence-weighted. <span class="green">Every payment verifiable.</span></div>`, "08 · roadmap and close");
  }

  throw new Error(`Unknown scene: ${scene}`);
}

function deckShell(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${baseCss}
    @page { size: 13.333333in 7.5in; margin: 0; }
    html, body { background: white; }
    .deck { width: 13.333333in; }
    .slide { width: 13.333333in; height: 7.5in; page-break-after: always; position: relative; overflow: hidden; background: ${COLORS.paper}; padding: .44in .55in .42in; }
    .slide.dark { background: ${COLORS.dark}; color: ${COLORS.paper}; }
    .slide:last-child { page-break-after: auto; }
    .slide h1 { font-size: 54pt; }
    .slide h2 { font-size: 34pt; }
    .slide .eyebrow { font-size: 8.5pt; }
    .slide p { font-size: 14pt; line-height: 1.42; }
    .slide .browser { border-radius: 8px; box-shadow: 0 14px 38px rgba(0,0,0,.25); }
    .slide .browser-bar { height: 24px; padding: 0 9px; font-size: 7px; }
    .slide .dots i { width: 5px; height: 5px; }
    .slide .metric strong { font-size: 27pt; }
    .slide .metric span { font-size: 7.5pt; }
    .slide .tag { font-size: 7pt; padding: 4px 8px; }
    .slide .pill { font-size: 8pt; padding: 5px 9px; }
    .slide .mark { box-shadow: inset 0 0 0 2px ${COLORS.paper}, inset 0 0 0 3px ${COLORS.red}; }
    .deck-no { position:absolute; right:.5in; bottom:.23in; font:7pt Consolas;color:${COLORS.muted};letter-spacing:.1em;text-transform:uppercase; }
    .deck-brand { display:flex;align-items:center;gap:8px;font:12pt Georgia,serif; }
    .foot { position:absolute; left:.55in; bottom:.23in; font:7pt "Segoe UI"; color:${COLORS.muted}; }
  </style></head><body><div class="deck">${body}</div></body></html>`;
}

function slide(number, title, body, dark = false) {
  return `<section class="slide ${dark ? "dark" : ""}">${body}<div class="foot">Keryx · Circle 2026 Cohort 2</div><div class="deck-no">${String(number).padStart(2, "0")} · ${esc(title)}</div></section>`;
}

export function renderDeck(ctx) {
  const { media, metrics, health, treasury, capturedAt } = ctx;
  const m = metrics.metrics;
  const t = health.traction;
  const slides = [];

  slides.push(slide(1, "Cover", `
    <div style="display:grid;grid-template-columns:1fr 1.05fr;gap:.45in;height:6.45in;align-items:center">
      <div><div class="deck-brand">${mark(38)} Keryx</div><div class="eyebrow" style="margin-top:.65in">Citation-toll infrastructure for AI agents</div><h1 style="margin-top:.17in">Every citation<br><span class="green">pays its creator.</span></h1><p style="margin-top:.34in;max-width:5.2in;color:rgba(242,234,216,.72)">Keryx lets an agent discover, buy, verify and cite paid knowledge—then settle weighted USDC rewards to the creators it actually uses.</p><div class="pill-row" style="margin-top:.35in"><span class="pill">keryx.cc</span><span class="pill">USDC on Arc</span><span class="pill">Circle Gateway</span></div></div>
      ${browser(media.home, "keryx.cc")}
    </div>`, true));

  slides.push(slide(2, "Problem", `
    <div class="eyebrow">The missing market</div><h2 style="margin-top:.12in;max-width:10.8in">AI consumes evidence at machine speed.<br><span class="red">Creators still monetize like every reader is human.</span></h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.22in;margin-top:.48in">
      <div class="paper-card" style="padding:.28in"><div style="font:30pt Georgia;color:${COLORS.red}">01</div><h3 style="margin-top:.25in">No programmable demand</h3><p class="muted" style="margin-top:.13in">Agents cannot cheaply buy one exact article, dataset fragment or claim.</p></div>
      <div class="paper-card" style="padding:.28in"><div style="font:30pt Georgia;color:${COLORS.red}">02</div><h3 style="margin-top:.25in">Attribution is not payment</h3><p class="muted" style="margin-top:.13in">A link does not compensate the evidence that materially shaped an answer.</p></div>
      <div class="paper-card" style="padding:.28in"><div style="font:30pt Georgia;color:${COLORS.red}">03</div><h3 style="margin-top:.25in">Agent spend is opaque</h3><p class="muted" style="margin-top:.13in">Without visible budgets and receipts, autonomous purchasing is hard to trust.</p></div>
    </div>
    <div style="margin-top:.35in;border-top:1px solid ${COLORS.line};padding-top:.25in;font:21pt Georgia,serif">The opportunity: make <span class="green">citation itself</span> the settlement event.</div>`));

  slides.push(slide(3, "Product", `
    <div class="eyebrow">The product</div><h2 style="margin-top:.12in">Question + budget → paid evidence → cited answer → creator rewards</h2>
    <div style="display:grid;grid-template-columns:1.35fr .65fr;gap:.27in;margin-top:.3in">
      ${browser(media.dispatchTop, "keryx.cc/dispatch/5b5c…")}
      <div style="display:grid;gap:.16in"><div class="paper-card" style="padding:.22in"><div class="tag" style="color:${COLORS.red}">Decide</div><p style="margin-top:.14in"><b>BUY · SKIP · CACHE</b><br><span class="muted">Every choice carries a rationale.</span></p></div><div class="paper-card" style="padding:.22in"><div class="tag" style="color:${COLORS.green}">Verify</div><p style="margin-top:.14in"><b>Evidence gate</b><br><span class="muted">Unsupported claims cannot earn rewards.</span></p></div><div class="paper-card" style="padding:.22in"><div class="tag" style="color:${COLORS.red}">Settle</div><p style="margin-top:.14in"><b>Weighted USDC</b><br><span class="muted">100% of citation rewards reach creator wallets.</span></p></div></div>
    </div>`));

  slides.push(slide(4, "Architecture", `
    <div class="eyebrow">Architecture</div><h2 style="margin-top:.12in">Non-custodial authority, explicit at every boundary</h2>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.16in;margin-top:.42in">
      ${[
        ["Browser", "Session key + hard spend cap", "Co-signs exact x402 authorizations"],
        ["Keryx agent", "Discover · score · BUY/SKIP/CACHE", "Evidence-gated synthesis"],
        ["Circle Gateway", "Batched nanopayment settlement", "USDC receipts + unified balance"],
        ["Arc + IPFS", "SourceRegistry payout authority", "Encrypted article versions"],
      ].map(([a,b,c], i) => `<div class="paper-card" style="padding:.24in;border-top:5px solid ${i === 2 ? COLORS.green : COLORS.red}"><div style="font:8pt Consolas;color:${COLORS.red}">0${i+1}</div><h3 style="margin-top:.22in">${a}</h3><p style="margin-top:.15in"><b>${b}</b></p><p class="muted" style="font-size:10pt;margin-top:.1in">${c}</p></div>`).join("")}
    </div>
    <div style="margin-top:.35in;padding:.26in;background:${COLORS.dark};color:${COLORS.paper};display:grid;grid-template-columns:repeat(3,1fr);gap:.25in"><div><b>Before signing</b><br><span style="opacity:.65">Reserve atomically against the cap.</span></div><div><b>After submission</b><br><span style="opacity:.65">Uncertainty is pending, never fabricated.</span></div><div><b>Before payout</b><br><span style="opacity:.65">Refresh authority from SourceRegistry.</span></div></div>`));

  slides.push(slide(5, "Circle integration", `
    <div class="eyebrow">Circle integration · live today</div><h2 style="margin-top:.12in">Stablecoin rails designed for machine-scale purchases</h2>
    <div style="display:grid;grid-template-columns:1fr 1.15fr;gap:.3in;margin-top:.34in">
      <div><div class="paper-card" style="padding:.27in"><h3>USDC on Arc testnet</h3><p class="muted" style="margin-top:.13in">Six-decimal exact accounting for sub-cent access tolls and citation rewards.</p></div><div class="paper-card" style="padding:.27in;margin-top:.16in"><h3>Agent Stack + Gateway Nanopayments</h3><p class="muted" style="margin-top:.13in">Official <code>@circle-fin/x402-batching</code> buyer and seller paths.</p></div><div class="paper-card" style="padding:.27in;margin-top:.16in"><h3>App Kits</h3><p class="muted" style="margin-top:.13in">Unified Balance Kit publishes the treasury's chain-abstracted balance.</p></div></div>
      <div>${browser(media.status, "keryx.cc/status")}<div class="pill-row" style="margin-top:.17in"><span class="tag" style="color:${COLORS.green}">Real settlement</span><span class="tag" style="color:${COLORS.green}">Arc RPC</span><span class="tag" style="color:${COLORS.green}">Registry parity</span></div></div>
    </div>`));

  slides.push(slide(6, "Traction", `
    <div class="eyebrow">Production traction · Arc testnet</div><h2 style="margin-top:.12in">Settlement scale and independent usage, reported separately</h2>
    <div style="display:grid;grid-template-columns:1.12fr .88fr;gap:.28in;margin-top:.3in">
      ${browser(media.dashboardTop, "keryx.cc/dashboard")}
      <div><div class="paper-card" style="padding:.25in"><div style="display:grid;grid-template-columns:1fr 1fr;gap:.25in"><div class="metric"><strong>${fmt(m.totalPayments)}</strong><span>settled payments</span></div><div class="metric"><strong>${money(m.totalVolumeUsdc, 2)}</strong><span>testnet volume</span></div><div class="metric"><strong>${money(m.totalCreatorPayoutsUsdc, 2)}</strong><span>creator payouts</span></div><div class="metric"><strong>${fmt(m.creatorsEarning)}</strong><span>wallets earning</span></div></div></div><div class="paper-card" style="padding:.25in;margin-top:.16in;background:#e7ddc7"><div class="eyebrow">Independent demand</div><p style="font:23pt Georgia;margin-top:.13in">${fmt(t.externalQueries)} queries · ${fmt(t.externalPayments)} payments</p><p class="muted" style="font-size:10.5pt;margin-top:.11in">${fmt(t.returningExternalActors)}/${fmt(t.identifiedExternalActors)} identified actors returned · ${fmt(t.externalFeedbackTotal)}/${fmt(t.externalFeedbackTotal)} positive feedback · ${fmt(t.externalSettlementAttempts)}/${fmt(t.externalSettlementAttempts)} measured settlements succeeded.</p></div></div>
    </div>
    <div style="font-size:8pt;color:${COLORS.muted};margin-top:.16in">Snapshot ${esc(capturedAt)} · settled-only · pending and simulations excluded · first-party autonomous volume disclosed separately.</div>`));

  slides.push(slide(7, "Users and GTM", `
    <div class="eyebrow">Users and go-to-market</div><h2 style="margin-top:.12in">A two-sided market distributed through agent-native interfaces</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.25in;margin-top:.38in"><div class="paper-card" style="padding:.3in;border-top:5px solid ${COLORS.red}"><h3 style="font:25pt Georgia">Supply</h3><p style="margin-top:.18in"><b>Publishers and independent creators</b></p><p class="muted" style="margin-top:.12in">RSS onboarding, exact article offers, creator-owned payout wallets, portable earnings proof.</p><p style="margin-top:.22in"><b>Research and data providers</b></p><p class="muted" style="margin-top:.12in">Paid APIs, premium evidence, benchmarks and proprietary corpora.</p></div><div class="paper-card" style="padding:.3in;border-top:5px solid ${COLORS.green}"><h3 style="font:25pt Georgia">Demand</h3><p style="margin-top:.18in"><b>Agent developers</b></p><p class="muted" style="margin-top:.12in">MCP, A2A x402, OpenAI-compatible API and public web app.</p><p style="margin-top:.22in"><b>Research-heavy teams</b></p><p class="muted" style="margin-top:.12in">Verifiable, budgeted answers with auditable source spend and payout provenance.</p></div></div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.15in;margin-top:.3in">${["Creator case studies","Agent integrations","Arc/Circle ecosystem","Open-source SDK modules"].map((x,i)=>`<div style="padding:.18in;background:${COLORS.dark};color:${COLORS.paper};font-size:11pt"><span style="color:${COLORS.red}">0${i+1}</span><br>${x}</div>`).join("")}</div>`));

  slides.push(slide(8, "Business model", `
    <div class="eyebrow">Business model</div><h2 style="margin-top:.12in">Charge for orchestration. Keep creator rewards a pass-through pool.</h2>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.22in;margin-top:.45in"><div class="paper-card" style="padding:.3in"><div class="tag" style="color:${COLORS.red}">Developer</div><h3 style="margin-top:.23in">Usage-based agent API</h3><p class="muted" style="margin-top:.15in">Platform fee for discovery, reasoning, policy and settlement operations. Source spend remains explicit.</p></div><div class="paper-card" style="padding:.3in"><div class="tag" style="color:${COLORS.red}">Enterprise</div><h3 style="margin-top:.23in">Integration + reliability plans</h3><p class="muted" style="margin-top:.15in">Private sources, controls, observability, compliance workflows and support.</p></div><div class="paper-card" style="padding:.3in"><div class="tag" style="color:${COLORS.green}">Creator</div><h3 style="margin-top:.23in">Rewards stay creator-owned</h3><p class="muted" style="margin-top:.15in">Keryx currently takes 0% of citation rewards. Pricing tests will not blur source payouts.</p></div></div>
    <div style="margin-top:.4in;display:grid;grid-template-columns:.7fr 1.3fr;gap:.25in"><div style="font:33pt Georgia;color:${COLORS.green}">Aligned incentives</div><p class="muted">Better evidence improves the answer, increases cited contribution, and directs more value to the creator who supplied it. Keryx earns by making that market reliable—not by hiding the toll.</p></div>`));

  slides.push(slide(9, "Roadmap and use of funds", `
    <div class="eyebrow">Six-month roadmap</div><h2 style="margin-top:.12in">Audit → cross-chain funding → external pilot → Arc mainnet</h2>
    <div style="display:grid;grid-template-columns:1.15fr .85fr;gap:.28in;margin-top:.35in"><div><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:.16in">${[
      ["Weeks 1–6","Independent security review","Close all critical/high findings; mainnet release candidate."],
      ["Weeks 5–12","CCTP-funded sessions","Forwarding Service from Ethereum and Base."],
      ["Weeks 9–18","External pilot","10 creator wallets; 5 agent integrations; public case studies."],
      ["Weeks 16–24","Arc mainnet launch","Audited settlement, monitoring, recovery and SDK release."],
    ].map(([a,b,c])=>`<div class="paper-card" style="padding:.23in"><div class="eyebrow">${a}</div><h3 style="margin-top:.13in">${b}</h3><p class="muted" style="font-size:10pt;margin-top:.1in">${c}</p></div>`).join("")}</div></div><div class="paper-card" style="padding:.28in;background:${COLORS.dark};color:${COLORS.paper}"><div class="eyebrow">Grant allocation</div>${[["45%","Engineering + Circle"],["20%","Security review"],["20%","Creator + agent pilots"],["10%","Infrastructure"],["5%","Open source"]].map(([a,b])=>`<div style="display:flex;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.13);padding:.17in 0"><b style="color:${COLORS.gold}">${a}</b><span>${b}</span></div>`).join("")}</div></div>`));

  slides.push(slide(10, "Team and ask", `
    <div style="display:grid;grid-template-columns:.78fr 1.22fr;gap:.5in;height:6.35in;align-items:center"><div><div class="deck-brand">${mark(52)} Keryx</div><div class="eyebrow" style="margin-top:.5in">Founder</div><h1 style="font-size:47pt;margin-top:.15in">Tang Vu</h1><p style="margin-top:.25in;color:rgba(242,234,216,.7)">Solo founder and full-stack engineer across agent reasoning, browser session authority, Circle x402/Gateway settlement, Arc registry, encrypted content, metrics and production operations.</p><div class="pill-row" style="margin-top:.3in"><span class="pill">13 public releases</span><span class="pill">661 app tests</span><span class="pill">16 contract tests</span></div></div><div><div class="eyebrow">The ask</div><h2 style="font-size:38pt;margin-top:.16in">Help turn a proven testnet economy into audited, externally adopted Arc mainnet infrastructure.</h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:.18in;margin-top:.38in"><div class="paper-card" style="padding:.23in"><h3>Milestone funding</h3><p class="muted" style="font-size:10pt;margin-top:.1in">Security, CCTP, Wallets, pilots and mainnet operations.</p></div><div class="paper-card" style="padding:.23in"><h3>Technical partnership</h3><p class="muted" style="font-size:10pt;margin-top:.1in">Circle architecture review and ecosystem distribution.</p></div></div><p style="font:24pt Georgia;margin-top:.38in">Citation becomes a payment.<br><span class="green">Built for the agent economy.</span></p></div></div>`, true));

  return deckShell(slides.join(""));
}

export function renderThumbnail(ctx) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${baseCss}</style></head><body><main class="frame"><img src="${esc(ctx.media.dispatchTop)}" style="position:absolute;right:-40px;top:120px;width:1120px;transform:rotate(1.5deg);box-shadow:0 35px 100px rgba(0,0,0,.5);border:10px solid ${COLORS.paper}"><div style="position:absolute;inset:0;background:linear-gradient(90deg,${COLORS.dark} 0%,${COLORS.dark} 39%,rgba(14,17,15,.8) 55%,rgba(14,17,15,.05) 100%)"></div><div style="position:absolute;left:82px;top:72px;color:${COLORS.paper};display:flex;align-items:center;gap:14px">${mark(58)}<span style="font:30px Georgia">Keryx</span></div><div style="position:absolute;left:82px;top:285px;color:${COLORS.paper};width:900px"><div class="eyebrow">Circle grant technical demo</div><h1 style="font-size:105px;margin-top:22px">Every citation<br><span class="green">pays its creator.</span></h1><div style="margin-top:36px;display:inline-block;background:${COLORS.red};padding:15px 22px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">USDC · x402 · Gateway · Arc</div></div></main></body></html>`;
}
