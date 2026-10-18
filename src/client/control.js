import PerfectScrollbar from 'perfect-scrollbar';

    const byId = (id) => document.getElementById(id);
    const createScrollbar = (element, options) => new PerfectScrollbar(element, options);
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
        text('poem-enabled', data.schedule.poemEnabled ? 'Enabled' : 'Disabled');
        byId('poem-section').hidden = !data.result?.poem;
        text('poem-text', data.result?.poem);
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
          text('poem-attempts', data.latest.poemAttempts);
          text('next-poem-retry', dateTime(data.latest.nextPoemRetryAt));
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
        setInput('timezone',data.timezone); setInput('schedule-time',data.scheduleTime); setInput('rngdle-retry-minutes',data.rngdleRetryMinutes); setInput('email-retry-minutes',data.emailRetryMinutes); setInput('poll-seconds',data.pollSeconds); setInput('http-timeout',data.httpTimeoutMs); setInput('control-url',data.controlPublicUrl);
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
    byId('settings-form').addEventListener('submit',async(event)=>{ event.preventDefault(); const message=byId('settings-message'); const save=byId('settings-save'); message.className='feedback'; message.textContent=''; save.disabled=true; const payload={timezone:byId('timezone').value,scheduleTime:byId('schedule-time').value,rngdleRetryMinutes:Number(byId('rngdle-retry-minutes').value),emailRetryMinutes:Number(byId('email-retry-minutes').value),pollSeconds:Number(byId('poll-seconds').value),httpTimeoutMs:Number(byId('http-timeout').value),controlPublicUrl:byId('control-url').value,rngdleEmail:byId('rngdle-email').value,smtpUsername:byId('smtp-username').value,smtpFrom:byId('smtp-from').value,mailFromName:byId('sender-name').value,mailSubjectPrefix:byId('subject-prefix').value,mailTo:byId('mail-to').value,smtpHost:byId('smtp-host').value,smtpPort:Number(byId('smtp-port').value),smtpSecure:byId('smtp-secure').checked,smtpRequireTls:byId('smtp-require-tls').checked,smtpAppPassword:byId('smtp-password').value}; try { const data=await request('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); message.textContent=data.message; settingsLoaded=false; await loadSettings(); await refreshOverview(); } catch(error) { message.className='feedback error'; message.textContent=error.message; } finally { save.disabled=false; } });
    byId('password-save').addEventListener('click',async()=>{ const message=byId('password-message'); const button=byId('password-save'); message.className='feedback'; message.textContent=''; button.disabled=true; try { await request('/api/auth/password',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:byId('control-password').value,confirmation:byId('control-password-confirm').value})}); message.textContent='Password changed. Redirecting to sign in...'; setTimeout(()=>{ window.location.href='/login'; },500); } catch(error) { message.className='feedback error'; message.textContent=error.message; button.disabled=false; } });
    byId('logout-button').addEventListener('click',async()=>{ try { await request('/api/auth/logout',{method:'POST'}); } finally { window.location.href='/login'; } });
    window.addEventListener('resize',()=>{ mainScrollbar.update(); logScrollbar.update(); });
    setInterval(()=>{ refreshOverview(); if(activeView==='logs'&&byId('log-auto').checked) loadLogs(); },3000);
    (async()=>{ try { const session=await request('/api/auth/session'); if (!session.authenticated) { window.location.href='/login'; return; } csrfToken=session.csrfToken; await refreshOverview(); } catch (_) {} })();
