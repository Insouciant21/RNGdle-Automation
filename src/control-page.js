function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderControlPage(baseUrl) {
  const rngdleUrl = escapeHtml(baseUrl);
  const iconUrl = `${rngdleUrl}/favicon/web-app-manifest-192x192.png`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>RNGdle Control</title>
  <link rel="icon" href="${iconUrl}">
  <link rel="preload" href="/assets/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/space-mono-400-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/space-mono-700-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/vendor/perfect-scrollbar.css">
  <style>
    @font-face { font-family:Inter; font-style:normal; font-display:swap; font-weight:100 900; src:url("/assets/fonts/inter-latin.woff2") format("woff2"); }
    @font-face { font-family:"Space Mono"; font-style:normal; font-display:swap; font-weight:400; src:url("/assets/fonts/space-mono-400-latin.woff2") format("woff2"); }
    @font-face { font-family:"Space Mono"; font-style:normal; font-display:swap; font-weight:700; src:url("/assets/fonts/space-mono-700-latin.woff2") format("woff2"); }
    :root { color-scheme:light; --font-sans:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; --font-mono:"Space Mono",ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace; --site:#fafafa; --surface:#fff; --raised:#f3f4f6; --prose:#111827; --prose-2:#4b5563; --prose-3:#9ca3af; --outline:#e5e7eb; --strong:#9ca3af; --success:#047857; --danger:#dc2626; --warning:#c2410c; }
    @media (prefers-color-scheme:dark) { :root { color-scheme:dark; --site:#19181d; --surface:#25242a; --raised:#302f36; --prose:#f0f0f0; --prose-2:#c4c4c4; --prose-3:#9a9a9a; --outline:#52515a; --strong:#85838f; --success:#6ee7b7; --danger:#fca5a5; --warning:#fdba74; } }
    * { box-sizing:border-box; }
    html,body { height:100%; min-height:100%; }
    body { display:flex; flex-direction:column; margin:0; overflow:hidden; background:var(--site); color:var(--prose); font:14px/1.5 var(--font-sans); font-kerning:normal; letter-spacing:0; }
    button,input,select { font:inherit; }
    .topbar { flex:0 0 auto; min-height:50px; display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:stretch; gap:12px; padding:0 16px; border-bottom:1px solid var(--outline); background:var(--site); }
    .brand { grid-column:1; display:inline-flex; align-items:center; justify-self:start; gap:9px; color:var(--prose); font:800 18px/1.2 var(--font-sans); letter-spacing:.04em; text-decoration:none; }
    .brand img { width:24px; height:24px; border-radius:5px; }
    .brand-context,.mono,.label { font-family:var(--font-mono); }
    .brand-context { color:var(--prose-3); font-size:10px; text-transform:uppercase; }
    .header-state { grid-column:3; display:flex; align-items:center; justify-self:end; gap:8px; min-width:0; color:var(--prose-2); font:700 11px/1.2 var(--font-mono); text-align:right; text-transform:uppercase; }
    .header-action { padding:5px 8px; border:1px solid var(--outline); border-radius:4px; background:transparent; color:var(--prose-2); font:700 10px/1.2 var(--font-mono); text-transform:uppercase; cursor:pointer; }
    .header-action:hover { border-color:var(--prose); color:var(--prose); background:var(--raised); }
    .dot { flex:0 0 auto; width:8px; height:8px; border-radius:50%; background:var(--prose-3); }
    .dot.waiting,.dot.error { background:var(--danger); }
    .dot.authenticated,.dot.idle,.dot.success { background:var(--success); }
    .tabs { grid-column:2; display:flex; align-self:stretch; justify-content:center; min-width:0; }
    .tab { min-width:96px; min-height:49px; padding:10px 14px; border:0; border-bottom:2px solid transparent; background:transparent; color:var(--prose-3); font:700 11px/1.2 var(--font-sans); letter-spacing:.08em; text-transform:uppercase; cursor:pointer; }
    .tab:hover { color:var(--prose); background:var(--raised); }
    .tab.active { border-bottom-color:var(--prose); color:var(--prose); }
    .main-scroll { position:relative; flex:1 1 auto; min-height:0; overflow:auto; }
    main { width:100%; max-width:1040px; margin:0 auto; padding:36px 20px 56px; }
    .view[hidden] { display:none; }
    .view-title { margin:0; color:var(--prose); font:700 22px/1.25 var(--font-sans); }
    .view-kicker { margin:3px 0 24px; color:var(--prose-3); font:700 11px/1.4 var(--font-mono); text-transform:uppercase; }
    .status-hero { text-align:center; padding:18px 0 36px; }
    .status-frame { display:flex; align-items:center; justify-content:center; width:min(100%,360px); min-height:94px; margin:0 auto; padding:16px; border:3px solid var(--strong); border-radius:8px; background:var(--surface); }
    .status-copy { max-width:100%; color:var(--prose); font:700 24px/1.2 var(--font-sans); overflow-wrap:anywhere; }
    .meta { display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:9px; margin:14px 0 0; color:var(--prose-3); font:700 11px/1.3 var(--font-mono); text-transform:uppercase; }
    .tag { display:inline-block; padding:3px 8px; border:1px solid var(--outline); border-radius:4px; background:var(--raised); color:var(--prose-2); font:700 10px/1.3 var(--font-mono); text-transform:uppercase; }
    .tag.waiting,.tag.failed,.tag.error { color:var(--danger); }
    .tag.idle,.tag.success,.tag.authenticated { color:var(--success); }
    .overview-grid { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr); gap:24px; align-items:start; }
    .section { min-width:0; }
    .section + .section { margin-top:32px; }
    .section-heading { display:flex; align-items:end; justify-content:space-between; gap:14px; margin-bottom:10px; }
    .section-heading h2 { margin:0; color:var(--prose); font:700 17px/1.3 var(--font-sans); }
    .section-meta { color:var(--prose-3); font:700 10px/1.4 var(--font-mono); text-transform:uppercase; }
    .panel { border:1px solid var(--outline); border-radius:8px; background:var(--surface); overflow:hidden; }
    .result-summary { padding:22px; text-align:center; }
    .roll-number { display:inline-block; min-width:190px; padding:12px 20px; border:3px solid var(--rarity-border,var(--strong)); border-radius:10px; background:var(--rarity-card-bg,var(--surface)); color:var(--rarity-text,var(--prose-2)); box-shadow:0 0 14px var(--rarity-accent,#d1d5db); font:700 34px/1.3 var(--font-mono); font-variant-numeric:tabular-nums; }
    .roll-rarity { display:flex; align-items:center; justify-content:center; gap:8px; width:max-content; margin:12px auto 0; padding:4px 9px; border:1px solid var(--rarity-border,#d1d5db); border-radius:4px; background:var(--rarity-bg,#f9fafb); color:var(--rarity-text,#6b7280); font:700 10px/1.3 var(--font-mono); text-transform:uppercase; }
    .rarity-trash { --rarity-bg:#fffbeb; --rarity-card-bg:linear-gradient(135deg,#fffbeb,#fff7ed); --rarity-border:#d97706; --rarity-text:#92400e; --rarity-accent:#c8a87c; }
    .rarity-common { --rarity-bg:#f9fafb; --rarity-card-bg:linear-gradient(135deg,#f3f4f6,#fff); --rarity-border:#9ca3af; --rarity-text:#4b5563; --rarity-accent:#d1d5db; }
    .rarity-uncommon { --rarity-bg:#ecfdf5; --rarity-card-bg:linear-gradient(135deg,#d1fae5,#f0fdf4); --rarity-border:#10b981; --rarity-text:#047857; --rarity-accent:#6ee7b7; }
    .rarity-rare { --rarity-bg:#eff6ff; --rarity-card-bg:linear-gradient(135deg,#dbeafe,#f0f9ff); --rarity-border:#3b82f6; --rarity-text:#1d4ed8; --rarity-accent:#93c5fd; }
    .rarity-epic { --rarity-bg:#f5f3ff; --rarity-card-bg:linear-gradient(135deg,#ede9fe,#fdf4ff); --rarity-border:#8b5cf6; --rarity-text:#6d28d9; --rarity-accent:#c4b5fd; }
    .rarity-anomaly { --rarity-bg:#fff7ed; --rarity-card-bg:linear-gradient(135deg,#fed7aa,#fffbeb); --rarity-border:#f97316; --rarity-text:#c2410c; --rarity-accent:#fdba74; }
    .rarity-mythic { --rarity-bg:#fff1f2; --rarity-card-bg:linear-gradient(135deg,#ffe4e6,#faf5ff 52%,#cffafe); --rarity-border:#db2777; --rarity-text:#b91c1c; --rarity-accent:#f9a8d4; }
    .rarity-unknown { --rarity-bg:#f9fafb; --rarity-card-bg:linear-gradient(135deg,#f3f4f6,#fff); --rarity-border:#d1d5db; --rarity-text:#6b7280; --rarity-accent:#d1d5db; }
    .badge-breakdown { padding:0 14px 14px; }
    .badge-breakdown-heading { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 0 8px; border-top:1px solid var(--outline); color:var(--prose); font-size:13px; font-weight:800; text-transform:uppercase; }
    .badge-list { display:grid; gap:7px; }
    .badge-item { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:9px; align-items:start; padding:9px 10px; border:1px solid var(--rarity-border,#d1d5db); border-left-width:3px; border-radius:6px; background:var(--rarity-bg,#f9fafb); }
    .badge-emoji { min-width:22px; font-size:17px; line-height:22px; text-align:center; }
    .badge-copy { min-width:0; }
    .badge-name { color:var(--prose); font:600 13px/1.35 var(--font-sans); overflow-wrap:anywhere; }
    .badge-description { margin-top:3px; color:var(--prose-3); font:12px/1.4 var(--font-sans); overflow-wrap:anywhere; }
    .badge-meta { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:6px; min-width:0; text-align:right; }
    .badge-rarity { display:inline-block; padding:3px 6px; border:1px solid var(--rarity-border,#d1d5db); border-radius:4px; color:var(--rarity-text,#6b7280); font:700 10px/1.25 var(--font-sans); letter-spacing:.04em; text-transform:uppercase; }
    .badge-score { display:inline-block; padding:3px 7px; border:1px solid #fbbf24; border-radius:999px; background:#fffbeb; color:#b45309; font:600 11px/1.25 var(--font-mono); font-variant-numeric:tabular-nums; white-space:nowrap; }
    .badge-new { margin-left:4px; color:#92400e; font-size:9px; }
    .badge-empty { padding:12px; color:var(--prose-3); font:11px/1.4 var(--font-mono); text-align:center; text-transform:uppercase; }
    .stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); border-top:1px solid var(--outline); }
    .stat { min-width:0; padding:13px 12px; text-align:center; }
    .stat + .stat { border-left:1px solid var(--outline); }
    .stat-value { display:block; color:var(--prose); font:700 13px/1.35 var(--font-mono); overflow-wrap:anywhere; }
    .stat-label { display:block; margin-top:3px; color:var(--prose-3); font:700 9px/1.3 var(--font-mono); text-transform:uppercase; }
    .detail-row { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:52px; padding:10px 14px; }
    .detail-row + .detail-row { border-top:1px solid var(--outline); }
    .detail-label { flex:0 0 auto; color:var(--prose-3); font:700 10px/1.3 var(--font-mono); text-transform:uppercase; }
    .detail-value { min-width:0; color:var(--prose); font:700 12px/1.4 var(--font-mono); text-align:right; overflow-wrap:anywhere; }
    .auth-actions,.sidebar-actions { padding:14px; }
    .sidebar-actions { display:grid; gap:8px; }
    .sidebar-actions .button { width:100%; }
    .field-label { display:block; margin:15px 0 6px; color:var(--prose-3); font:700 10px/1.3 var(--font-mono); text-transform:uppercase; }
    .input,.select { width:100%; min-height:42px; padding:9px 11px; border:1px solid var(--strong); border-radius:6px; outline:0; background:var(--site); color:var(--prose); font:14px/1.4 var(--font-sans); }
    .input:focus,.select:focus { border-color:var(--prose); box-shadow:0 0 0 1px var(--prose); }
    .button { display:inline-flex; align-items:center; justify-content:center; min-height:40px; padding:9px 14px; border:2px solid var(--prose); border-radius:6px; background:var(--prose); color:var(--surface); font:700 11px/1.3 var(--font-sans); letter-spacing:.06em; text-align:center; text-decoration:none; text-transform:uppercase; cursor:pointer; }
    .button.block { width:100%; }
    .button.secondary { background:transparent; color:var(--prose); }
    .button.quiet { border-color:var(--outline); background:var(--surface); color:var(--prose-2); }
    .button:disabled { border-color:var(--outline); background:var(--raised); color:var(--prose-3); cursor:not-allowed; }
    .feedback { min-height:18px; margin:10px 0 0; color:var(--success); font:700 11px/1.4 var(--font-mono); }
    .feedback.error { color:var(--danger); }
    .toolbar { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:12px; }
    .toolbar-group { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
    .toolbar .select { width:auto; min-width:120px; min-height:38px; }
    .check { display:inline-flex; align-items:center; gap:7px; color:var(--prose-2); font:700 10px/1.3 var(--font-mono); text-transform:uppercase; }
    .check input { width:16px; height:16px; margin:0; accent-color:var(--prose); }
    .log-panel { contain:paint; height:520px; border:1px solid var(--outline); border-radius:8px; background:var(--surface); overflow:auto; }
    .log-empty { padding:40px 18px; color:var(--prose-3); font:12px/1.5 var(--font-mono); text-align:center; }
    .log-row { display:grid; grid-template-columns:168px 58px minmax(0,1fr); gap:12px; padding:10px 12px; border-bottom:1px solid var(--outline); font:11px/1.45 var(--font-mono); }
    .log-time { color:var(--prose-3); }
    .log-level { font-weight:700; text-transform:uppercase; }
    .log-level.error { color:var(--danger); }
    .log-message { min-width:0; color:var(--prose); overflow-wrap:anywhere; }
    .log-fields { grid-column:3; margin:0; color:var(--prose-3); white-space:pre-wrap; overflow-wrap:anywhere; }
    .email-feedback { margin:0; }
    .auth-page { width:min(100%,640px); margin:0 auto; }
    .settings-form { border-top:1px solid var(--outline); }
    .settings-group { display:grid; grid-template-columns:190px minmax(0,1fr); gap:28px; padding:24px 0; border-bottom:1px solid var(--outline); }
    .settings-heading h2 { margin:0; font-size:15px; line-height:1.35; text-transform:uppercase; }
    .settings-heading p { margin:4px 0 0; color:var(--prose-3); font:10px/1.5 var(--font-mono); text-transform:uppercase; }
    .form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px 16px; }
    .form-field { min-width:0; }
    .form-field.full { grid-column:1/-1; }
    .form-field .field-label { margin:0 0 6px; }
    .settings-actions { display:flex; align-items:center; justify-content:flex-end; gap:14px; padding-top:20px; }
    .secret-state { color:var(--success); }
    .password-help { margin:8px 0 0; color:var(--prose-3); font:11px/1.45 var(--font-mono); }
    .main-scroll.ps,.log-panel.ps { overflow:hidden !important; }
    .ps--active-y > .ps__rail-y { width:10px; opacity:.5; background:transparent; z-index:20; }
    .ps--active-x > .ps__rail-x { height:10px; opacity:.5; background:transparent; z-index:20; }
    .ps .ps__rail-y:hover,.ps .ps__rail-y:focus,.ps .ps__rail-y.ps--clicking,.ps .ps__rail-x:hover,.ps .ps__rail-x:focus,.ps .ps__rail-x.ps--clicking { opacity:1; background:var(--raised); }
    .ps__thumb-y { right:2px; width:5px; border-radius:4px; background:var(--strong); }
    .ps__thumb-x { bottom:2px; height:5px; border-radius:4px; background:var(--strong); }
    .ps__rail-y:hover > .ps__thumb-y,.ps__rail-y:focus > .ps__thumb-y,.ps__rail-y.ps--clicking .ps__thumb-y { width:5px; background:var(--prose-2); }
    .ps__rail-x:hover > .ps__thumb-x,.ps__rail-x:focus > .ps__thumb-x,.ps__rail-x.ps--clicking .ps__thumb-x { height:5px; background:var(--prose-2); }
    @media (max-width:760px) { .topbar { grid-template-columns:minmax(0,1fr) auto; gap:0; padding:0; } .brand { grid-column:1; grid-row:1; min-height:49px; padding:7px 12px; } .header-state { grid-column:2; grid-row:1; min-height:49px; padding:7px 12px; } .tabs { grid-column:1/-1; grid-row:2; width:100%; border-top:1px solid var(--outline); overflow-x:auto; } .tab { flex:1 0 78px; min-width:78px; min-height:43px; padding:10px 8px; } main { padding:28px 16px 44px; } .overview-grid { grid-template-columns:1fr; } .settings-group { grid-template-columns:1fr; gap:14px; } .log-row { grid-template-columns:1fr auto; gap:4px 10px; } .log-message,.log-fields { grid-column:1/-1; } .log-panel { height:460px; } }
    @media (max-width:520px) { .brand-context { display:none; } .header-state { max-width:100%; } main { padding:24px 12px 36px; } .status-hero { padding-top:4px; } .status-frame { min-height:82px; } .status-copy { font-size:21px; } .stats { grid-template-columns:repeat(2,minmax(0,1fr)); } .stat:nth-child(3) { border-left:0; } .stat:nth-child(n+3) { border-top:1px solid var(--outline); } .form-grid { grid-template-columns:1fr; } .form-field.full { grid-column:auto; } .settings-actions { align-items:stretch; flex-direction:column; } .settings-actions .button { width:100%; } .toolbar { align-items:stretch; flex-direction:column; } .toolbar-group { justify-content:space-between; } }
  </style>
</head>
<body>
  <header class="topbar">
    <a id="brand-link" class="brand" href="${rngdleUrl}" target="_blank" rel="noopener noreferrer"><img src="${iconUrl}" alt=""><span>RNGdle</span><span class="brand-context">Control</span></a>
    <nav class="tabs" role="tablist" aria-label="Control views">
      <button class="tab active" role="tab" aria-selected="true" data-view="overview">Overview</button>
      <button class="tab" role="tab" aria-selected="false" data-view="logs">Logs</button>
      <button class="tab" role="tab" aria-selected="false" data-view="auth">Authentication</button>
      <button class="tab" role="tab" aria-selected="false" data-view="settings">Settings</button>
    </nav>
    <div class="header-state"><span id="header-dot" class="dot"></span><span id="header-status">Connecting</span><button id="logout-button" class="header-action" type="button">Sign out</button></div>
  </header>
  <div id="main-scroll" class="main-scroll" tabindex="0">
  <main>
    <section id="view-overview" class="view" role="tabpanel">
      <div class="status-hero">
        <div class="status-frame"><strong id="status" class="status-copy" aria-live="polite">Loading</strong></div>
        <div class="meta"><span id="state-tag" class="tag">Connecting</span><span aria-hidden="true">•</span><span id="schedule-meta">Loading schedule</span></div>
      </div>
      <div class="overview-grid">
        <div>
          <section class="section">
            <div class="section-heading"><h2>Latest roll</h2><span id="result-date" class="section-meta">No result</span></div>
            <div class="panel">
              <div class="result-summary"><span id="roll-number" class="roll-number">------</span><div id="roll-rarity" class="roll-rarity rarity-unknown"><span id="roll-rarity-icon">?</span><span id="roll-rarity-label">Rarity unavailable</span></div></div>
              <div class="stats">
                <div class="stat"><span id="earned-ep" class="stat-value">-</span><span class="stat-label">Earned EP</span></div>
                <div class="stat"><span id="total-ep" class="stat-value">-</span><span class="stat-label">Lifetime EP</span></div>
                <div class="stat"><span id="badge-count" class="stat-value">-</span><span class="stat-label">Badges</span></div>
                <div class="stat"><span id="mail-state" class="stat-value">-</span><span class="stat-label">Email</span></div>
              </div>
              <div class="badge-breakdown"><div class="badge-breakdown-heading"><span>Badge breakdown</span><span id="badge-count-label" class="section-meta">-</span></div><div id="badge-list" class="badge-list"><div class="badge-empty">No badge data</div></div></div>
            </div>
          </section>
        </div>
        <aside>
          <section class="section">
            <div class="section-heading"><h2>Run state</h2><span id="run-date" class="section-meta">Today</span></div>
            <div class="panel">
              <div class="detail-row"><span class="detail-label">Status</span><strong id="run-status" class="detail-value">-</strong></div>
              <div class="detail-row"><span class="detail-label">RNGdle attempts</span><strong id="run-attempts" class="detail-value">-</strong></div>
              <div class="detail-row"><span class="detail-label">RNGdle next retry</span><strong id="next-rngdle-retry" class="detail-value">-</strong></div>
              <div class="detail-row"><span class="detail-label">Email attempts</span><strong id="email-attempts" class="detail-value">-</strong></div>
              <div class="detail-row"><span class="detail-label">Email next retry</span><strong id="next-email-retry" class="detail-value">-</strong></div>
              <div class="detail-row"><span class="detail-label">Recipients</span><strong id="mail-recipients" class="detail-value">-</strong></div>
            </div>
          </section>
          <section class="section">
            <div class="section-heading"><h2>Email</h2><span class="section-meta">Result delivery</span></div>
            <div class="panel">
              <div class="sidebar-actions">
                <button id="email-send" class="button" type="button">Send email</button>
                <a id="preview-open" class="button quiet" href="/preview/email?type=result" target="_blank">Open preview</a>
                <div id="email-message" class="feedback email-feedback" role="status"></div>
              </div>
            </div>
          </section>
          <section id="error-section" class="section" hidden>
            <div class="section-heading"><h2>Last error</h2></div>
            <div class="panel"><div class="detail-row"><span id="last-error" class="detail-value" style="text-align:left"></span></div></div>
          </section>
        </aside>
      </div>
    </section>

    <section id="view-logs" class="view" role="tabpanel" hidden>
      <h1 class="view-title">Logs</h1><p class="view-kicker">Current RNGdle service process</p>
      <div class="toolbar">
        <div class="toolbar-group"><select id="log-level" class="select" aria-label="Log level"><option value="all">All levels</option><option value="info">Info</option><option value="error">Errors</option></select><label class="check"><input id="log-auto" type="checkbox" checked>Auto refresh</label></div>
        <button id="log-refresh" class="button quiet" type="button">Refresh</button>
      </div>
      <div id="log-panel" class="log-panel" tabindex="0" aria-live="polite"><div class="log-empty">Loading logs</div></div>
    </section>

    <section id="view-auth" class="view" role="tabpanel" hidden>
      <h1 class="view-title">Authentication</h1><p class="view-kicker">Persistent RNGdle HTTP session</p>
      <div class="auth-page">
        <section class="section">
          <div class="section-heading"><h2>RNGdle account</h2><span class="section-meta">Magic link</span></div>
          <div class="panel">
            <div class="detail-row"><span class="detail-label">Account</span><strong id="rngdle-account" class="detail-value">Loading</strong></div>
            <div class="auth-actions">
              <a id="rngdle-link" class="button block" href="${rngdleUrl}" target="_blank" rel="noopener noreferrer">Request sign-in link</a>
              <form id="auth-form">
                <label class="field-label" for="auth-link">Email magic-link URL</label>
                <input class="input" id="auth-link" type="url" inputmode="url" autocomplete="off" placeholder="https://www.rngdle.com/..." required>
                <button class="button block secondary" id="auth-submit" type="submit" style="margin-top:10px">Verify magic link</button>
              </form>
              <div id="auth-message" class="feedback" role="status"></div>
            </div>
          </div>
        </section>
      </div>
    </section>

    <section id="view-settings" class="view" role="tabpanel" hidden>
      <h1 class="view-title">Settings</h1><p class="view-kicker">Persisted runtime configuration</p>
      <form id="settings-form" class="settings-form">
        <section class="settings-group">
          <div class="settings-heading"><h2>Automation</h2><p>Schedule and browser</p></div>
          <div class="form-grid">
            <div class="form-field"><label class="field-label" for="timezone">Timezone</label><input class="input" id="timezone" required></div>
            <div class="form-field"><label class="field-label" for="schedule-time">Daily time</label><input class="input" id="schedule-time" type="time" required></div>
            <div class="form-field"><label class="field-label" for="rngdle-retry-minutes">RNGdle retry minutes</label><input class="input" id="rngdle-retry-minutes" type="number" min="1" max="1440" required></div>
            <div class="form-field"><label class="field-label" for="email-retry-minutes">Email retry minutes</label><input class="input" id="email-retry-minutes" type="number" min="1" max="1440" required></div>
            <div class="form-field"><label class="field-label" for="poll-seconds">Poll seconds</label><input class="input" id="poll-seconds" type="number" min="5" max="3600" required></div>
            <div class="form-field"><label class="field-label" for="browser-timeout">Browser timeout ms</label><input class="input" id="browser-timeout" type="number" min="5000" max="300000" required></div>
            <div class="form-field"><label class="field-label" for="control-url">Control public URL</label><input class="input" id="control-url" type="url" required></div>
          </div>
        </section>
        <section class="settings-group">
          <div class="settings-heading"><h2>Delivery</h2><p>Account and recipients</p></div>
          <div class="form-grid">
            <div class="form-field"><label class="field-label" for="rngdle-email">RNGdle email</label><input class="input" id="rngdle-email" type="email" required></div>
            <div class="form-field"><label class="field-label" for="smtp-username">SMTP username</label><input class="input" id="smtp-username" type="email" required></div>
            <div class="form-field"><label class="field-label" for="smtp-from">From address</label><input class="input" id="smtp-from" type="email" required></div>
            <div class="form-field"><label class="field-label" for="sender-name">Sender name</label><input class="input" id="sender-name" required></div>
            <div class="form-field"><label class="field-label" for="subject-prefix">Subject prefix</label><input class="input" id="subject-prefix" required></div>
            <div class="form-field full"><label class="field-label" for="mail-to">Recipients</label><input class="input" id="mail-to" required></div>
          </div>
        </section>
        <section class="settings-group">
          <div class="settings-heading"><h2>SMTP</h2><p>Mail transport</p></div>
          <div class="form-grid">
            <div class="form-field"><label class="field-label" for="smtp-host">Host</label><input class="input" id="smtp-host" required></div>
            <div class="form-field"><label class="field-label" for="smtp-port">Port</label><input class="input" id="smtp-port" type="number" min="1" max="65535" required></div>
            <div class="form-field full"><label class="field-label" for="smtp-password">SMTP password <span id="secret-state" class="secret-state"></span></label><input class="input" id="smtp-password" type="password" autocomplete="new-password" placeholder="Leave blank to keep current password"></div>
            <div class="form-field full"><div class="toolbar-group"><label class="check"><input id="smtp-secure" type="checkbox">Implicit TLS</label><label class="check"><input id="smtp-require-tls" type="checkbox">Require STARTTLS</label></div></div>
          </div>
        </section>
        <section class="settings-group">
          <div class="settings-heading"><h2>Security</h2><p>Control access</p></div>
          <div class="form-grid">
            <div class="form-field"><label class="field-label" for="control-password">New Control password</label><input class="input" id="control-password" type="password" autocomplete="new-password" minlength="8"></div>
            <div class="form-field"><label class="field-label" for="control-password-confirm">Confirm password</label><input class="input" id="control-password-confirm" type="password" autocomplete="new-password" minlength="8"></div>
            <div class="form-field full"><p class="password-help">Changing the password signs out all active sessions. Minimum 8 characters.</p><div id="password-message" class="feedback" role="status"></div><button id="password-save" class="button secondary" type="button">Change Control password</button></div>
          </div>
        </section>
        <div class="settings-actions"><span id="settings-message" class="feedback" role="status"></span><button id="settings-save" class="button" type="submit">Save settings</button></div>
      </form>
    </section>
  </main>
  </div>
  <script src="/assets/vendor/perfect-scrollbar.min.js"></script>
  <script>
    const byId = (id) => document.getElementById(id);
    const createScrollbar = (element, options) => window.PerfectScrollbar
      ? new window.PerfectScrollbar(element, options)
      : { update() {} };
    const mainScrollbar = createScrollbar(byId('main-scroll'), { suppressScrollX:true, wheelPropagation:false });
    const logScrollbar = createScrollbar(byId('log-panel'), { suppressScrollX:true, wheelPropagation:false });
    let activeView = 'overview';
    let mailRecipients = [];
    let settingsLoaded = false;
    let csrfToken = null;

    async function request(url, options) {
      const method=(options?.method||'GET').toUpperCase();
      const headers={...(options?.headers||{})};
      if (!['GET','HEAD','OPTIONS'].includes(method) && csrfToken) headers['X-CSRF-Token']=csrfToken;
      const response = await fetch(url, { cache:'no-store', credentials:'same-origin', ...options, headers });
      const data = await response.json();
      if (response.status === 401) { window.location.href='/login'; throw new Error(data.message || 'Authentication required'); }
      if (!response.ok) throw new Error(data.message || ('HTTP ' + response.status));
      return data;
    }

    function text(id, value, fallback = '-') { byId(id).textContent = value === null || value === undefined || value === '' ? fallback : String(value); }
    function number(value) { return value === null || value === undefined ? '-' : Number(value).toLocaleString('en-US'); }
    function dateTime(value) { return value ? new Date(value).toLocaleString() : '-'; }
    const rarityLabels = { trash:'Trash', common:'Common', uncommon:'Uncommon', rare:'Rare', epic:'Epic', anomaly:'Anomaly', mythic:'Mythic', unknown:'Rarity unavailable' };
    const rarityIcons = { trash:'🟫', common:'⬜', uncommon:'🟩', rare:'🟦', epic:'🟪', anomaly:'🟧', mythic:'🟥', unknown:'?' };
    const badgeRarityFromScore = (score) => { const value=Number(score); if (!Number.isFinite(value)||value<0) return 'unknown'; if(value<1000)return 'common'; if(value<10000)return 'uncommon'; if(value<100000)return 'rare'; if(value<1000000)return 'epic'; if(value<10000000)return 'anomaly'; return 'mythic'; };
    function renderBadges(result) {
      const list=byId('badge-list'); const badges=Array.isArray(result.badges)?result.badges:[];
      byId('badge-count-label').textContent=badges.length+' badge'+(badges.length===1?'':'s');
      list.replaceChildren();
      if (!badges.length) { const empty=document.createElement('div'); empty.className='badge-empty'; empty.textContent='No badges earned'; list.append(empty); return; }
      badges.forEach((badge)=>{
        const rarity=rarityLabels[badge.rarity] ? badge.rarity : badgeRarityFromScore(badge.score);
        const item=document.createElement('div'); item.className='badge-item rarity-'+rarity;
        const emoji=document.createElement('span'); emoji.className='badge-emoji'; emoji.textContent=badge.emoji||'✨';
        const copy=document.createElement('div'); copy.className='badge-copy';
        const name=document.createElement('div'); name.className='badge-name'; name.textContent=badge.label||badge.id||'Unknown badge';
        if (badge.isNew) { const fresh=document.createElement('span'); fresh.className='badge-new'; fresh.textContent='NEW'; name.append(fresh); }
        copy.append(name);
        if (badge.description) { const description=document.createElement('div'); description.className='badge-description'; description.textContent=badge.description; copy.append(description); }
        const meta=document.createElement('div'); meta.className='badge-meta'; const label=document.createElement('span'); label.className='badge-rarity'; label.textContent=rarityLabels[rarity]; const score=document.createElement('span'); score.className='badge-score'; score.textContent='+'+number(badge.score)+' EP'; meta.append(label,score); item.append(emoji,copy,meta); list.append(item);
      });
    }

    function showView(name) {
      activeView = name;
      document.querySelectorAll('.view').forEach((view) => { view.hidden = view.id !== 'view-' + name; });
      document.querySelectorAll('.tab').forEach((tab) => { const selected = tab.dataset.view === name; tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', String(selected)); });
      if (name === 'logs') loadLogs();
      if (name === 'settings' && !settingsLoaded) loadSettings();
      byId('main-scroll').scrollTop=0;
      requestAnimationFrame(()=>mainScrollbar.update());
    }

    async function refreshOverview() {
      try {
        const data = await request('/api/overview');
        const state = data.status.state;
        text('status', data.status.label);
        text('header-status', data.status.label);
        byId('header-dot').className = 'dot ' + state;
        text('state-tag', state);
        byId('state-tag').className = 'tag ' + state;
        text('schedule-meta', data.schedule.time + ' ' + data.schedule.timezone);
        text('rngdle-account', data.rngdle.email);
        byId('rngdle-link').href = data.rngdle.baseUrl;
        byId('brand-link').href = data.rngdle.baseUrl;
        byId('auth-submit').disabled = state !== 'waiting';
        mailRecipients = data.mail.to;
        text('mail-recipients', mailRecipients.join(', '));
        if (data.result) {
          text('result-date', data.result.date);
          text('roll-number', data.result.number);
          text('earned-ep', number(data.result.earnedEp));
          text('total-ep', number(data.result.totalEp));
          text('badge-count', Array.isArray(data.result.badges) ? data.result.badges.length : data.result.badges);
          const rarity=data.result.rarity && rarityLabels[data.result.rarity] ? data.result.rarity : 'unknown';
          byId('roll-number').className='roll-number rarity-'+rarity;
          byId('roll-rarity').className='roll-rarity rarity-'+rarity;
          text('roll-rarity-icon',rarityIcons[rarity]); text('roll-rarity-label',rarityLabels[rarity]);
          renderBadges(data.result);
        }
        if (data.latest) {
          text('run-date', data.latest.date);
          text('run-status', data.latest.status);
          text('run-attempts', data.latest.attempts);
          text('next-rngdle-retry', dateTime(data.latest.nextRngdleRetryAt));
          text('email-attempts', data.latest.emailAttempts);
          text('next-email-retry', dateTime(data.latest.nextEmailRetryAt));
          text('mail-state', data.latest.emailSent ? 'Sent' : 'Pending');
          byId('error-section').hidden = !data.latest.lastError;
          text('last-error', data.latest.lastError);
        }
        mainScrollbar.update();
      } catch (error) {
        text('status', 'Unavailable'); text('header-status', 'Offline');
        byId('header-dot').className = 'dot error';
      }
    }

    async function loadLogs() {
      const panel = byId('log-panel');
      try {
        const data = await request('/api/logs?limit=200&level=' + encodeURIComponent(byId('log-level').value));
        panel.replaceChildren();
        if (!data.logs.length) { const empty=document.createElement('div'); empty.className='log-empty'; empty.textContent='No matching logs'; panel.append(empty); logScrollbar.update(); return; }
        data.logs.forEach((entry) => {
          const row=document.createElement('div'); row.className='log-row';
          const time=document.createElement('time'); time.className='log-time'; time.textContent=new Date(entry.timestamp).toLocaleString();
          const level=document.createElement('span'); level.className='log-level ' + entry.level; level.textContent=entry.level;
          const message=document.createElement('span'); message.className='log-message'; message.textContent=entry.message;
          row.append(time,level,message);
          if (entry.fields && Object.keys(entry.fields).length) { const fields=document.createElement('pre'); fields.className='log-fields'; fields.textContent=JSON.stringify(entry.fields,null,2); row.append(fields); }
          panel.append(row);
        });
        logScrollbar.update(); panel.scrollTop=panel.scrollHeight; logScrollbar.update();
      } catch (error) { panel.textContent=error.message; }
    }

    function setInput(id, value) { byId(id).value = value ?? ''; }
    async function loadSettings() {
      try {
        const data=await request('/api/settings');
        setInput('timezone',data.timezone); setInput('schedule-time',data.scheduleTime); setInput('rngdle-retry-minutes',data.rngdleRetryMinutes); setInput('email-retry-minutes',data.emailRetryMinutes); setInput('poll-seconds',data.pollSeconds); setInput('browser-timeout',data.browserTimeoutMs); setInput('control-url',data.controlPublicUrl);
        setInput('rngdle-email',data.rngdleEmail); setInput('smtp-username',data.smtpUsername); setInput('smtp-from',data.smtpFrom); setInput('sender-name',data.mailFromName); setInput('subject-prefix',data.mailSubjectPrefix); setInput('mail-to',data.mailTo);
        setInput('smtp-host',data.smtpHost); setInput('smtp-port',data.smtpPort); byId('smtp-secure').checked=data.smtpSecure; byId('smtp-require-tls').checked=data.smtpRequireTls; byId('smtp-password').value=''; text('secret-state',data.hasSmtpPassword ? '(configured)' : '(missing)');
        settingsLoaded=true;
        mainScrollbar.update();
      } catch (error) { text('settings-message',error.message); byId('settings-message').className='feedback error'; }
    }

    document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click',()=>showView(tab.dataset.view)));
    byId('auth-form').addEventListener('submit',async(event)=>{ event.preventDefault(); const message=byId('auth-message'); message.className='feedback'; message.textContent=''; byId('auth-submit').disabled=true; try { const data=await request('/api/auth-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({link:byId('auth-link').value})}); message.textContent=data.message; byId('auth-link').value=''; } catch(error) { message.className='feedback error'; message.textContent=error.message; } await refreshOverview(); });
    byId('log-refresh').addEventListener('click',loadLogs); byId('log-level').addEventListener('change',loadLogs);
    byId('email-send').addEventListener('click',async()=>{ const recipients=mailRecipients.length ? mailRecipients.join(', ') : 'the configured recipients'; if(!window.confirm('Send the result email to '+recipients+'?')) return; const button=byId('email-send'); const message=byId('email-message'); button.disabled=true; button.textContent='Sending'; message.className='feedback email-feedback'; message.textContent=''; try { const data=await request('/api/email/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'result'})}); message.textContent=data.message; } catch(error) { message.className='feedback email-feedback error'; message.textContent=error.message; } finally { button.disabled=false; button.textContent='Send email'; } });
    byId('settings-form').addEventListener('submit',async(event)=>{ event.preventDefault(); const message=byId('settings-message'); const save=byId('settings-save'); message.className='feedback'; message.textContent=''; save.disabled=true; const payload={timezone:byId('timezone').value,scheduleTime:byId('schedule-time').value,rngdleRetryMinutes:Number(byId('rngdle-retry-minutes').value),emailRetryMinutes:Number(byId('email-retry-minutes').value),pollSeconds:Number(byId('poll-seconds').value),browserTimeoutMs:Number(byId('browser-timeout').value),controlPublicUrl:byId('control-url').value,rngdleEmail:byId('rngdle-email').value,smtpUsername:byId('smtp-username').value,smtpFrom:byId('smtp-from').value,mailFromName:byId('sender-name').value,mailSubjectPrefix:byId('subject-prefix').value,mailTo:byId('mail-to').value,smtpHost:byId('smtp-host').value,smtpPort:Number(byId('smtp-port').value),smtpSecure:byId('smtp-secure').checked,smtpRequireTls:byId('smtp-require-tls').checked,smtpAppPassword:byId('smtp-password').value}; try { const data=await request('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); message.textContent=data.message; settingsLoaded=false; await loadSettings(); await refreshOverview(); } catch(error) { message.className='feedback error'; message.textContent=error.message; } finally { save.disabled=false; } });
    byId('password-save').addEventListener('click',async()=>{ const message=byId('password-message'); const button=byId('password-save'); message.className='feedback'; message.textContent=''; button.disabled=true; try { await request('/api/auth/password',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:byId('control-password').value,confirmation:byId('control-password-confirm').value})}); message.textContent='Password changed. Redirecting to sign in...'; setTimeout(()=>{ window.location.href='/login'; },500); } catch(error) { message.className='feedback error'; message.textContent=error.message; button.disabled=false; } });
    byId('logout-button').addEventListener('click',async()=>{ try { await request('/api/auth/logout',{method:'POST'}); } finally { window.location.href='/login'; } });
    window.addEventListener('resize',()=>{ mainScrollbar.update(); logScrollbar.update(); });
    setInterval(()=>{ refreshOverview(); if(activeView==='logs'&&byId('log-auto').checked) loadLogs(); },3000);
    (async()=>{ try { const session=await request('/api/auth/session'); if (!session.authenticated) { window.location.href='/login'; return; } csrfToken=session.csrfToken; await refreshOverview(); } catch (_) {} })();
  </script>
</body>
</html>`;
}

export function renderLoginPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>RNGdle Control sign in</title>
  <link rel="preload" href="/assets/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/space-mono-400-latin.woff2" as="font" type="font/woff2" crossorigin>
  <style>
    @font-face { font-family:Inter; font-style:normal; font-display:swap; font-weight:100 900; src:url("/assets/fonts/inter-latin.woff2") format("woff2"); }
    @font-face { font-family:"Space Mono"; font-style:normal; font-display:swap; font-weight:400; src:url("/assets/fonts/space-mono-400-latin.woff2") format("woff2"); }
    :root { color-scheme:light; --site:#fafafa; --surface:#fff; --prose:#111827; --muted:#6b7280; --outline:#d1d5db; --danger:#b91c1c; }
    @media (prefers-color-scheme:dark) { :root { color-scheme:dark; --site:#19181d; --surface:#25242a; --prose:#f0f0f0; --muted:#aaa8b1; --outline:#52515a; --danger:#fca5a5; } }
    * { box-sizing:border-box; } html,body { min-height:100%; margin:0; } body { display:grid; place-items:center; padding:24px; background:var(--site); color:var(--prose); font:14px/1.5 Inter,system-ui,sans-serif; }
    .login { width:min(100%,420px); padding:30px; border:1px solid var(--outline); border-radius:8px; background:var(--surface); box-shadow:0 16px 40px rgba(17,24,39,.08); }
    h1 { margin:0; font-size:22px; } p { margin:6px 0 24px; color:var(--muted); font:11px/1.5 "Space Mono",monospace; text-transform:uppercase; }
    label { display:block; margin:0 0 7px; color:var(--muted); font:700 10px/1.3 "Space Mono",monospace; text-transform:uppercase; }
    input { width:100%; min-height:44px; padding:10px 12px; border:1px solid var(--outline); border-radius:6px; background:transparent; color:var(--prose); font:16px/1.4 Inter,system-ui,sans-serif; outline:0; } input:focus { border-color:var(--prose); box-shadow:0 0 0 1px var(--prose); }
    button { width:100%; min-height:42px; margin-top:14px; border:2px solid var(--prose); border-radius:6px; background:var(--prose); color:var(--surface); font:700 11px/1.3 Inter,system-ui,sans-serif; letter-spacing:.06em; text-transform:uppercase; cursor:pointer; } button:disabled { opacity:.55; cursor:wait; }
    .feedback { min-height:20px; margin-top:14px; color:var(--danger); font:11px/1.4 "Space Mono",monospace; }
  </style>
</head>
<body>
  <main class="login">
    <h1>RNGdle Control</h1>
    <p>Private operations console</p>
    <form id="login-form">
      <label for="password">Control password</label>
      <input id="password" type="password" autocomplete="current-password" required autofocus>
      <button id="submit" type="submit">Sign in</button>
      <div id="feedback" class="feedback" role="alert"></div>
    </form>
  </main>
  <script>
    const form=document.getElementById('login-form'); const password=document.getElementById('password'); const button=document.getElementById('submit'); const feedback=document.getElementById('feedback');
    form.addEventListener('submit',async(event)=>{ event.preventDefault(); button.disabled=true; feedback.textContent=''; try { const response=await fetch('/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:password.value})}); const data=await response.json(); if(!response.ok) throw new Error(data.message||'Sign in failed'); window.location.href='/'; } catch(error) { feedback.textContent=error.message; password.select(); button.disabled=false; } });
  </script>
</body>
</html>`;
}

export function renderSetupPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Set up RNGdle Control</title>
  <link rel="preload" href="/assets/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/space-mono-400-latin.woff2" as="font" type="font/woff2" crossorigin>
  <style>
    @font-face { font-family:Inter; font-style:normal; font-display:swap; font-weight:100 900; src:url("/assets/fonts/inter-latin.woff2") format("woff2"); }
    @font-face { font-family:"Space Mono"; font-style:normal; font-display:swap; font-weight:400; src:url("/assets/fonts/space-mono-400-latin.woff2") format("woff2"); }
    :root { color-scheme:light; --site:#fafafa; --surface:#fff; --prose:#111827; --muted:#6b7280; --outline:#d1d5db; --danger:#b91c1c; }
    @media (prefers-color-scheme:dark) { :root { color-scheme:dark; --site:#19181d; --surface:#25242a; --prose:#f0f0f0; --muted:#aaa8b1; --outline:#52515a; --danger:#fca5a5; } }
    * { box-sizing:border-box; } html,body { min-height:100%; margin:0; } body { display:grid; place-items:center; padding:24px; background:var(--site); color:var(--prose); font:14px/1.5 Inter,system-ui,sans-serif; }
    .setup { width:min(100%,460px); padding:30px; border:1px solid var(--outline); border-radius:8px; background:var(--surface); box-shadow:0 16px 40px rgba(17,24,39,.08); }
    h1 { margin:0; font-size:22px; } p { margin:6px 0 24px; color:var(--muted); font:11px/1.5 "Space Mono",monospace; text-transform:uppercase; } .note { margin:-10px 0 22px; text-transform:none; }
    label { display:block; margin:0 0 7px; color:var(--muted); font:700 10px/1.3 "Space Mono",monospace; text-transform:uppercase; }
    input { width:100%; min-height:44px; margin-bottom:14px; padding:10px 12px; border:1px solid var(--outline); border-radius:6px; background:transparent; color:var(--prose); font:16px/1.4 Inter,system-ui,sans-serif; outline:0; } input:focus { border-color:var(--prose); box-shadow:0 0 0 1px var(--prose); }
    button { width:100%; min-height:42px; margin-top:2px; border:2px solid var(--prose); border-radius:6px; background:var(--prose); color:var(--surface); font:700 11px/1.3 Inter,system-ui,sans-serif; letter-spacing:.06em; text-transform:uppercase; cursor:pointer; } button:disabled { opacity:.55; cursor:wait; }
    .feedback { min-height:20px; margin-top:14px; color:var(--danger); font:11px/1.4 "Space Mono",monospace; }
  </style>
</head>
<body>
  <main class="setup">
    <h1>Set up RNGdle Control</h1>
    <p>First-run access protection</p>
    <p class="note">Create the password used to access this Control page. It is stored as a one-way hash in the Docker data volume.</p>
    <form id="setup-form">
      <label for="password">Control password</label>
      <input id="password" type="password" autocomplete="new-password" minlength="8" required>
      <label for="confirmation">Confirm password</label>
      <input id="confirmation" type="password" autocomplete="new-password" minlength="8" required>
      <button id="submit" type="submit">Create password</button>
      <div id="feedback" class="feedback" role="alert"></div>
    </form>
  </main>
  <script>
    const form=document.getElementById('setup-form'); const password=document.getElementById('password'); const confirmation=document.getElementById('confirmation'); const button=document.getElementById('submit'); const feedback=document.getElementById('feedback');
    form.addEventListener('submit',async(event)=>{ event.preventDefault(); button.disabled=true; feedback.textContent=''; try { const response=await fetch('/api/auth/setup',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:password.value,confirmation:confirmation.value})}); const data=await response.json(); if(!response.ok) throw new Error(data.message||'Setup failed'); window.location.href='/'; } catch(error) { feedback.textContent=error.message; button.disabled=false; } });
  </script>
</body>
</html>`;
}
