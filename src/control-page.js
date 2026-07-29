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
  <style>
    @font-face { font-family:Inter; font-style:normal; font-display:swap; font-weight:100 900; src:url("/assets/fonts/inter-latin.woff2") format("woff2"); }
    @font-face { font-family:"Space Mono"; font-style:normal; font-display:swap; font-weight:400; src:url("/assets/fonts/space-mono-400-latin.woff2") format("woff2"); }
    @font-face { font-family:"Space Mono"; font-style:normal; font-display:swap; font-weight:700; src:url("/assets/fonts/space-mono-700-latin.woff2") format("woff2"); }
    :root { color-scheme:light; --font-sans:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; --font-mono:"Space Mono",ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace; --site:#fafafa; --surface:#fff; --raised:#f3f4f6; --prose:#111827; --prose-2:#4b5563; --prose-3:#9ca3af; --outline:#e5e7eb; --strong:#9ca3af; --success:#047857; --danger:#dc2626; --warning:#c2410c; }
    @media (prefers-color-scheme:dark) { :root { color-scheme:dark; --site:#19181d; --surface:#25242a; --raised:#302f36; --prose:#f0f0f0; --prose-2:#c4c4c4; --prose-3:#9a9a9a; --outline:#52515a; --strong:#85838f; --success:#6ee7b7; --danger:#fca5a5; --warning:#fdba74; } }
    * { box-sizing:border-box; }
    html,body { min-height:100%; }
    body { margin:0; background:var(--site); color:var(--prose); font:14px/1.5 var(--font-sans); letter-spacing:0; }
    button,input,select { font:inherit; }
    .topbar { min-height:49px; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:7px 16px; border-bottom:1px solid var(--outline); background:var(--site); }
    .brand { display:inline-flex; align-items:center; gap:9px; color:var(--prose); font-size:17px; font-weight:800; text-decoration:none; }
    .brand img { width:24px; height:24px; border-radius:5px; }
    .brand-context,.mono,.label { font-family:var(--font-mono); }
    .brand-context { color:var(--prose-3); font-size:10px; text-transform:uppercase; }
    .header-state { display:flex; align-items:center; gap:8px; min-width:0; color:var(--prose-2); font:700 11px/1.2 var(--font-mono); text-transform:uppercase; }
    .dot { flex:0 0 auto; width:8px; height:8px; border-radius:50%; background:var(--prose-3); }
    .dot.waiting,.dot.error { background:var(--danger); }
    .dot.authenticated,.dot.idle,.dot.success { background:var(--success); }
    .tabs-wrap { border-bottom:1px solid var(--outline); background:var(--surface); overflow-x:auto; }
    .tabs { display:flex; width:max-content; min-width:100%; max-width:1080px; margin:0 auto; padding:0 18px; }
    .tab { min-width:96px; min-height:43px; padding:10px 14px; border:0; border-bottom:2px solid transparent; background:transparent; color:var(--prose-3); font:700 11px/1.2 var(--font-mono); text-transform:uppercase; cursor:pointer; }
    .tab:hover { color:var(--prose); background:var(--raised); }
    .tab.active { border-bottom-color:var(--prose); color:var(--prose); }
    main { width:100%; max-width:1040px; margin:0 auto; padding:36px 20px 56px; }
    .view[hidden] { display:none; }
    .view-title { margin:0; font-size:20px; line-height:1.3; text-transform:uppercase; }
    .view-kicker { margin:3px 0 24px; color:var(--prose-3); font:700 11px/1.4 var(--font-mono); text-transform:uppercase; }
    .status-hero { text-align:center; padding:18px 0 36px; }
    .status-frame { display:flex; align-items:center; justify-content:center; width:min(100%,360px); min-height:94px; margin:0 auto; padding:16px; border:3px solid var(--strong); border-radius:8px; background:var(--surface); }
    .status-copy { max-width:100%; color:var(--prose); font:700 26px/1.2 var(--font-mono); text-transform:uppercase; overflow-wrap:anywhere; }
    .meta { display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:9px; margin:14px 0 0; color:var(--prose-3); font:700 11px/1.3 var(--font-mono); text-transform:uppercase; }
    .tag { display:inline-block; padding:3px 8px; border:1px solid var(--outline); border-radius:4px; background:var(--raised); color:var(--prose-2); font:700 10px/1.3 var(--font-mono); text-transform:uppercase; }
    .tag.waiting,.tag.failed,.tag.error { color:var(--danger); }
    .tag.idle,.tag.success,.tag.authenticated { color:var(--success); }
    .overview-grid { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr); gap:24px; align-items:start; }
    .section { min-width:0; }
    .section + .section { margin-top:32px; }
    .section-heading { display:flex; align-items:end; justify-content:space-between; gap:14px; margin-bottom:10px; }
    .section-heading h2 { margin:0; font-size:16px; line-height:1.35; text-transform:uppercase; }
    .section-meta { color:var(--prose-3); font:700 10px/1.4 var(--font-mono); text-transform:uppercase; }
    .panel { border:1px solid var(--outline); border-radius:8px; background:var(--surface); overflow:hidden; }
    .result-summary { padding:22px; text-align:center; }
    .roll-number { display:inline-block; min-width:190px; padding:12px 20px; border:3px solid var(--strong); border-radius:8px; color:var(--prose-2); font:700 34px/1.3 var(--font-mono); }
    .stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); border-top:1px solid var(--outline); }
    .stat { min-width:0; padding:13px 12px; text-align:center; }
    .stat + .stat { border-left:1px solid var(--outline); }
    .stat-value { display:block; color:var(--prose); font:700 13px/1.35 var(--font-mono); overflow-wrap:anywhere; }
    .stat-label { display:block; margin-top:3px; color:var(--prose-3); font:700 9px/1.3 var(--font-mono); text-transform:uppercase; }
    .detail-row { display:flex; align-items:center; justify-content:space-between; gap:16px; min-height:52px; padding:10px 14px; }
    .detail-row + .detail-row { border-top:1px solid var(--outline); }
    .detail-label { flex:0 0 auto; color:var(--prose-3); font:700 10px/1.3 var(--font-mono); text-transform:uppercase; }
    .detail-value { min-width:0; color:var(--prose); font:700 12px/1.4 var(--font-mono); text-align:right; overflow-wrap:anywhere; }
    .auth-actions { padding:14px; }
    .field-label { display:block; margin:15px 0 6px; color:var(--prose-3); font:700 10px/1.3 var(--font-mono); text-transform:uppercase; }
    .input,.select { width:100%; min-height:42px; padding:9px 11px; border:1px solid var(--strong); border-radius:6px; outline:0; background:var(--site); color:var(--prose); font:12px/1.4 var(--font-mono); }
    .input:focus,.select:focus { border-color:var(--prose); box-shadow:0 0 0 1px var(--prose); }
    .button { display:inline-flex; align-items:center; justify-content:center; min-height:40px; padding:9px 14px; border:2px solid var(--prose); border-radius:6px; background:var(--prose); color:var(--surface); font:700 11px/1.3 var(--font-mono); text-align:center; text-decoration:none; text-transform:uppercase; cursor:pointer; }
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
    .log-panel { height:520px; border:1px solid var(--outline); border-radius:8px; background:var(--surface); overflow:auto; }
    .log-empty { padding:40px 18px; color:var(--prose-3); font:12px/1.5 var(--font-mono); text-align:center; }
    .log-row { display:grid; grid-template-columns:168px 58px minmax(0,1fr); gap:12px; padding:10px 12px; border-bottom:1px solid var(--outline); font:11px/1.45 var(--font-mono); }
    .log-time { color:var(--prose-3); }
    .log-level { font-weight:700; text-transform:uppercase; }
    .log-level.error { color:var(--danger); }
    .log-message { min-width:0; color:var(--prose); overflow-wrap:anywhere; }
    .log-fields { grid-column:3; margin:0; color:var(--prose-3); white-space:pre-wrap; overflow-wrap:anywhere; }
    .segmented { display:inline-flex; border:1px solid var(--outline); border-radius:6px; background:var(--surface); overflow:hidden; }
    .segment { min-height:38px; padding:8px 12px; border:0; background:transparent; color:var(--prose-3); font:700 10px/1.3 var(--font-mono); text-transform:uppercase; cursor:pointer; }
    .segment + .segment { border-left:1px solid var(--outline); }
    .segment.active { background:var(--prose); color:var(--surface); }
    .preview-frame { display:block; width:100%; height:820px; border:1px solid var(--outline); border-radius:8px; background:#fafafa; }
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
    @media (max-width:760px) { main { padding:28px 16px 44px; } .overview-grid { grid-template-columns:1fr; } .settings-group { grid-template-columns:1fr; gap:14px; } .log-row { grid-template-columns:1fr auto; gap:4px 10px; } .log-message,.log-fields { grid-column:1/-1; } .log-panel { height:460px; } .preview-frame { height:720px; } }
    @media (max-width:520px) { .topbar { padding:7px 10px; } .brand-context { display:none; } .header-state { max-width:50%; text-align:right; } .tabs { padding:0 8px; } .tab { min-width:84px; padding:10px; } main { padding:24px 12px 36px; } .status-hero { padding-top:4px; } .status-frame { min-height:82px; } .status-copy { font-size:21px; } .stats { grid-template-columns:repeat(2,minmax(0,1fr)); } .stat:nth-child(3) { border-left:0; } .stat:nth-child(n+3) { border-top:1px solid var(--outline); } .form-grid { grid-template-columns:1fr; } .form-field.full { grid-column:auto; } .settings-actions { align-items:stretch; flex-direction:column; } .settings-actions .button { width:100%; } .toolbar { align-items:stretch; flex-direction:column; } .toolbar-group { justify-content:space-between; } .preview-frame { height:660px; } }
  </style>
</head>
<body>
  <header class="topbar">
    <a id="brand-link" class="brand" href="${rngdleUrl}" target="_blank" rel="noopener noreferrer"><img src="${iconUrl}" alt=""><span>RNGdle</span><span class="brand-context">Control</span></a>
    <div class="header-state"><span id="header-dot" class="dot"></span><span id="header-status">Connecting</span></div>
  </header>
  <div class="tabs-wrap"><nav class="tabs" role="tablist" aria-label="Control views">
    <button class="tab active" role="tab" aria-selected="true" data-view="overview">Overview</button>
    <button class="tab" role="tab" aria-selected="false" data-view="logs">Logs</button>
    <button class="tab" role="tab" aria-selected="false" data-view="email">Email</button>
    <button class="tab" role="tab" aria-selected="false" data-view="settings">Settings</button>
  </nav></div>
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
              <div class="result-summary"><span id="roll-number" class="roll-number">------</span></div>
              <div class="stats">
                <div class="stat"><span id="earned-ep" class="stat-value">-</span><span class="stat-label">Earned EP</span></div>
                <div class="stat"><span id="total-ep" class="stat-value">-</span><span class="stat-label">Lifetime EP</span></div>
                <div class="stat"><span id="badge-count" class="stat-value">-</span><span class="stat-label">Badges</span></div>
                <div class="stat"><span id="mail-state" class="stat-value">-</span><span class="stat-label">Email</span></div>
              </div>
            </div>
          </section>
          <section class="section">
            <div class="section-heading"><h2>Authentication</h2><span class="section-meta">Persistent session</span></div>
            <div class="panel">
              <div class="detail-row"><span class="detail-label">RNGdle account</span><strong id="rngdle-account" class="detail-value">Loading</strong></div>
              <div class="auth-actions">
                <a id="rngdle-link" class="button block" href="${rngdleUrl}" target="_blank" rel="noopener noreferrer">Request sign-in link</a>
                <form id="auth-form">
                  <label class="field-label" for="auth-link">Email magic-link URL</label>
                  <input class="input" id="auth-link" type="url" inputmode="url" autocomplete="off" placeholder="https://www.rngdle.com/..." required>
                  <button class="button block secondary" id="auth-submit" type="submit" style="margin-top:10px">Open in persistent browser</button>
                </form>
                <div id="auth-message" class="feedback" role="status"></div>
              </div>
            </div>
          </section>
        </div>
        <aside>
          <section class="section">
            <div class="section-heading"><h2>Run state</h2><span id="run-date" class="section-meta">Today</span></div>
            <div class="panel">
              <div class="detail-row"><span class="detail-label">Status</span><strong id="run-status" class="detail-value">-</strong></div>
              <div class="detail-row"><span class="detail-label">Attempts</span><strong id="run-attempts" class="detail-value">-</strong></div>
              <div class="detail-row"><span class="detail-label">Next retry</span><strong id="next-retry" class="detail-value">-</strong></div>
              <div class="detail-row"><span class="detail-label">Recipients</span><strong id="mail-recipients" class="detail-value">-</strong></div>
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
      <h1 class="view-title">Logs</h1><p class="view-kicker">Current scheduler process</p>
      <div class="toolbar">
        <div class="toolbar-group"><select id="log-level" class="select" aria-label="Log level"><option value="all">All levels</option><option value="info">Info</option><option value="error">Errors</option></select><label class="check"><input id="log-auto" type="checkbox" checked>Auto refresh</label></div>
        <button id="log-refresh" class="button quiet" type="button">Refresh</button>
      </div>
      <div id="log-panel" class="log-panel" aria-live="polite"><div class="log-empty">Loading logs</div></div>
    </section>

    <section id="view-email" class="view" role="tabpanel" hidden>
      <div class="section-heading">
        <div><h1 class="view-title">Email preview</h1><p class="view-kicker" style="margin-bottom:0">Rendered message output</p></div>
        <div class="toolbar-group"><div class="segmented" role="group" aria-label="Email type"><button class="segment active" type="button" data-email-type="result">Result</button><button class="segment" type="button" data-email-type="authentication">Login required</button></div><a id="preview-open" class="button quiet" href="/preview/email?type=result" target="_blank">Open</a></div>
      </div>
      <iframe id="email-frame" class="preview-frame" title="Email preview" src="/preview/email?type=result"></iframe>
    </section>

    <section id="view-settings" class="view" role="tabpanel" hidden>
      <h1 class="view-title">Settings</h1><p class="view-kicker">Persisted runtime configuration</p>
      <form id="settings-form" class="settings-form">
        <section class="settings-group">
          <div class="settings-heading"><h2>Automation</h2><p>Schedule and browser</p></div>
          <div class="form-grid">
            <div class="form-field"><label class="field-label" for="timezone">Timezone</label><input class="input" id="timezone" required></div>
            <div class="form-field"><label class="field-label" for="schedule-time">Daily time</label><input class="input" id="schedule-time" type="time" required></div>
            <div class="form-field"><label class="field-label" for="retry-minutes">Retry minutes</label><input class="input" id="retry-minutes" type="number" min="1" max="1440" required></div>
            <div class="form-field"><label class="field-label" for="poll-seconds">Poll seconds</label><input class="input" id="poll-seconds" type="number" min="5" max="3600" required></div>
            <div class="form-field"><label class="field-label" for="browser-timeout">Browser timeout ms</label><input class="input" id="browser-timeout" type="number" min="5000" max="300000" required></div>
            <div class="form-field"><label class="field-label" for="control-url">Control public URL</label><input class="input" id="control-url" type="url" required></div>
          </div>
        </section>
        <section class="settings-group">
          <div class="settings-heading"><h2>Delivery</h2><p>Account and recipients</p></div>
          <div class="form-grid">
            <div class="form-field"><label class="field-label" for="rngdle-email">RNGdle email</label><input class="input" id="rngdle-email" type="email" required></div>
            <div class="form-field"><label class="field-label" for="smtp-username">Gmail account</label><input class="input" id="smtp-username" type="email" required></div>
            <div class="form-field"><label class="field-label" for="smtp-from">From address</label><input class="input" id="smtp-from" type="email" required></div>
            <div class="form-field"><label class="field-label" for="subject-prefix">Subject prefix</label><input class="input" id="subject-prefix" required></div>
            <div class="form-field full"><label class="field-label" for="mail-to">Recipients</label><input class="input" id="mail-to" required></div>
          </div>
        </section>
        <section class="settings-group">
          <div class="settings-heading"><h2>SMTP</h2><p>Gmail transport</p></div>
          <div class="form-grid">
            <div class="form-field"><label class="field-label" for="smtp-host">Host</label><input class="input" id="smtp-host" required></div>
            <div class="form-field"><label class="field-label" for="smtp-port">Port</label><input class="input" id="smtp-port" type="number" min="1" max="65535" required></div>
            <div class="form-field full"><label class="field-label" for="smtp-password">App password <span id="secret-state" class="secret-state"></span></label><input class="input" id="smtp-password" type="password" autocomplete="new-password" placeholder="Leave blank to keep current password"></div>
            <div class="form-field full"><div class="toolbar-group"><label class="check"><input id="smtp-secure" type="checkbox">Implicit TLS</label><label class="check"><input id="smtp-require-tls" type="checkbox">Require STARTTLS</label></div></div>
          </div>
        </section>
        <div class="settings-actions"><span id="settings-message" class="feedback" role="status"></span><button id="settings-save" class="button" type="submit">Save settings</button></div>
      </form>
    </section>
  </main>
  <script>
    const byId = (id) => document.getElementById(id);
    let activeView = 'overview';
    let settingsLoaded = false;

    async function request(url, options) {
      const response = await fetch(url, { cache:'no-store', ...options });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || ('HTTP ' + response.status));
      return data;
    }

    function text(id, value, fallback = '-') { byId(id).textContent = value === null || value === undefined || value === '' ? fallback : String(value); }
    function number(value) { return value === null || value === undefined ? '-' : Number(value).toLocaleString('en-US'); }
    function dateTime(value) { return value ? new Date(value).toLocaleString() : '-'; }

    function showView(name) {
      activeView = name;
      document.querySelectorAll('.view').forEach((view) => { view.hidden = view.id !== 'view-' + name; });
      document.querySelectorAll('.tab').forEach((tab) => { const selected = tab.dataset.view === name; tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', String(selected)); });
      if (name === 'logs') loadLogs();
      if (name === 'settings' && !settingsLoaded) loadSettings();
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
        text('mail-recipients', data.mail.to.join(', '));
        if (data.result) {
          text('result-date', data.result.date);
          text('roll-number', data.result.number);
          text('earned-ep', number(data.result.earnedEp));
          text('total-ep', number(data.result.totalEp));
          text('badge-count', data.result.badges);
        }
        if (data.latest) {
          text('run-date', data.latest.date);
          text('run-status', data.latest.status);
          text('run-attempts', data.latest.attempts);
          text('next-retry', dateTime(data.latest.nextRetryAt));
          text('mail-state', data.latest.emailSent ? 'Sent' : 'Pending');
          byId('error-section').hidden = !data.latest.lastError;
          text('last-error', data.latest.lastError);
        }
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
        if (!data.logs.length) { const empty=document.createElement('div'); empty.className='log-empty'; empty.textContent='No matching logs'; panel.append(empty); return; }
        data.logs.forEach((entry) => {
          const row=document.createElement('div'); row.className='log-row';
          const time=document.createElement('time'); time.className='log-time'; time.textContent=new Date(entry.timestamp).toLocaleString();
          const level=document.createElement('span'); level.className='log-level ' + entry.level; level.textContent=entry.level;
          const message=document.createElement('span'); message.className='log-message'; message.textContent=entry.message;
          row.append(time,level,message);
          if (entry.fields && Object.keys(entry.fields).length) { const fields=document.createElement('pre'); fields.className='log-fields'; fields.textContent=JSON.stringify(entry.fields,null,2); row.append(fields); }
          panel.append(row);
        });
        panel.scrollTop=panel.scrollHeight;
      } catch (error) { panel.textContent=error.message; }
    }

    function setInput(id, value) { byId(id).value = value ?? ''; }
    async function loadSettings() {
      try {
        const data=await request('/api/settings');
        setInput('timezone',data.timezone); setInput('schedule-time',data.scheduleTime); setInput('retry-minutes',data.retryMinutes); setInput('poll-seconds',data.pollSeconds); setInput('browser-timeout',data.browserTimeoutMs); setInput('control-url',data.controlPublicUrl);
        setInput('rngdle-email',data.rngdleEmail); setInput('smtp-username',data.smtpUsername); setInput('smtp-from',data.smtpFrom); setInput('subject-prefix',data.mailSubjectPrefix); setInput('mail-to',data.mailTo);
        setInput('smtp-host',data.smtpHost); setInput('smtp-port',data.smtpPort); byId('smtp-secure').checked=data.smtpSecure; byId('smtp-require-tls').checked=data.smtpRequireTls; byId('smtp-password').value=''; text('secret-state',data.hasSmtpPassword ? '(configured)' : '(missing)');
        settingsLoaded=true;
      } catch (error) { text('settings-message',error.message); byId('settings-message').className='feedback error'; }
    }

    document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click',()=>showView(tab.dataset.view)));
    byId('auth-form').addEventListener('submit',async(event)=>{ event.preventDefault(); const message=byId('auth-message'); message.className='feedback'; message.textContent=''; byId('auth-submit').disabled=true; try { const data=await request('/api/auth-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({link:byId('auth-link').value})}); message.textContent=data.message; byId('auth-link').value=''; } catch(error) { message.className='feedback error'; message.textContent=error.message; } await refreshOverview(); });
    byId('log-refresh').addEventListener('click',loadLogs); byId('log-level').addEventListener('change',loadLogs);
    document.querySelectorAll('[data-email-type]').forEach((button)=>button.addEventListener('click',()=>{ document.querySelectorAll('[data-email-type]').forEach((item)=>item.classList.toggle('active',item===button)); const url='/preview/email?type='+encodeURIComponent(button.dataset.emailType)+'&t='+Date.now(); byId('email-frame').src=url; byId('preview-open').href=url; }));
    byId('settings-form').addEventListener('submit',async(event)=>{ event.preventDefault(); const message=byId('settings-message'); const save=byId('settings-save'); message.className='feedback'; message.textContent=''; save.disabled=true; const payload={timezone:byId('timezone').value,scheduleTime:byId('schedule-time').value,retryMinutes:Number(byId('retry-minutes').value),pollSeconds:Number(byId('poll-seconds').value),browserTimeoutMs:Number(byId('browser-timeout').value),controlPublicUrl:byId('control-url').value,rngdleEmail:byId('rngdle-email').value,smtpUsername:byId('smtp-username').value,smtpFrom:byId('smtp-from').value,mailSubjectPrefix:byId('subject-prefix').value,mailTo:byId('mail-to').value,smtpHost:byId('smtp-host').value,smtpPort:Number(byId('smtp-port').value),smtpSecure:byId('smtp-secure').checked,smtpRequireTls:byId('smtp-require-tls').checked,smtpAppPassword:byId('smtp-password').value}; try { const data=await request('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); message.textContent=data.message; settingsLoaded=false; await loadSettings(); await refreshOverview(); } catch(error) { message.className='feedback error'; message.textContent=error.message; } finally { save.disabled=false; } });
    setInterval(()=>{ refreshOverview(); if(activeView==='logs'&&byId('log-auto').checked) loadLogs(); },3000);
    refreshOverview();
  </script>
</body>
</html>`;
}
