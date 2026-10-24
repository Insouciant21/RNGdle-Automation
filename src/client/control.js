import PerfectScrollbar from 'perfect-scrollbar';

    const byId = (id) => document.getElementById(id);
    const createScrollbar = (element, options) => new PerfectScrollbar(element, options);
    let mainScrollbar = null;
    let logScrollbar = null;
    let mailRecipients = [];
    let csrfToken = null;
    let pollTimer = null;

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

    // Views are separate routes now: every helper tolerates the elements of
    // the other pages being absent from the current document.
    function text(id, value, fallback = '-') { const element = byId(id); if (element) element.textContent = value === null || value === undefined || value === '' ? fallback : String(value); }
    function setClass(id, className) { const element = byId(id); if (element) element.className = className; }
    function setHidden(id, hidden) { const element = byId(id); if (element) element.hidden = hidden; }
    function setHref(id, value) { const element = byId(id); if (element && value) element.href = value; }
    function number(value) { return value === null || value === undefined ? '-' : Number(value).toLocaleString('en-US'); }
    function dateTime(value) { return value ? new Date(value).toLocaleString() : '-'; }
    const rarityLabels = { trash:'Trash', common:'Common', uncommon:'Uncommon', rare:'Rare', epic:'Epic', anomaly:'Anomaly', mythic:'Mythic', unknown:'Rarity unavailable' };
    const rarityIcons = { trash:'🟫', common:'⬜', uncommon:'🟩', rare:'🟦', epic:'🟪', anomaly:'🟧', mythic:'🟥', unknown:'?' };
    const badgeRarityFromScore = (score) => { const value=Number(score); if (!Number.isFinite(value)||value<0) return 'unknown'; if(value<1000)return 'common'; if(value<10000)return 'uncommon'; if(value<100000)return 'rare'; if(value<1000000)return 'epic'; if(value<10000000)return 'anomaly'; return 'mythic'; };
    function renderBadges(result) {
      const list=byId('badge-list'); if (!list) return;
      const badges=Array.isArray(result.badges)?result.badges:[];
      text('badge-count-label', badges.length+' badge'+(badges.length===1?'':'s'));
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

    async function refreshOverview() {
      try {
        const data = await request('/api/overview');
        const state = data.status.state;
        text('status', data.status.label);
        text('header-status', data.status.label);
        setClass('header-dot', 'dot ' + state);
        text('state-tag', state);
        setClass('state-tag', 'tag ' + state);
        text('schedule-meta', data.schedule.time + ' ' + data.schedule.timezone);
        text('poem-enabled', data.schedule.poemEnabled ? 'Enabled' : 'Disabled');
        setHidden('poem-section', !data.result?.poem);
        text('poem-text', data.result?.poem);
        text('rngdle-account', data.rngdle.email);
        setHref('rngdle-link', data.rngdle.baseUrl);
        setHref('brand-link', data.rngdle.baseUrl);
        const submit = byId('auth-submit'); if (submit) submit.disabled = state !== 'waiting';
        mailRecipients = data.mail.to;
        text('mail-recipients', mailRecipients.join(', '));
        if (data.result) {
          text('result-date', data.result.date);
          text('roll-number', data.result.number);
          text('earned-ep', number(data.result.earnedEp));
          text('total-ep', number(data.result.totalEp));
          text('badge-count', Array.isArray(data.result.badges) ? data.result.badges.length : data.result.badges);
          const rarity=data.result.rarity && rarityLabels[data.result.rarity] ? data.result.rarity : 'unknown';
          setClass('roll-number','roll-number rarity-'+rarity);
          setClass('roll-rarity','roll-rarity rarity-'+rarity);
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
          setHidden('error-section', !data.latest.lastError);
          text('last-error', data.latest.lastError);
        }
        mainScrollbar?.update();
      } catch (error) {
        text('status', 'Unavailable'); text('header-status', 'Offline');
        setClass('header-dot', 'dot error');
      }
    }

    async function loadLogs() {
      const panel = byId('log-panel');
      if (!panel) return;
      try {
        const data = await request('/api/logs?limit=200&level=' + encodeURIComponent(byId('log-level').value));
        panel.replaceChildren();
        if (!data.logs.length) { const empty=document.createElement('div'); empty.className='log-empty'; empty.textContent='No matching logs'; panel.append(empty); logScrollbar?.update(); return; }
        data.logs.forEach((entry) => {
          const row=document.createElement('div'); row.className='log-row';
          const time=document.createElement('time'); time.className='log-time'; time.textContent=new Date(entry.timestamp).toLocaleString();
          const level=document.createElement('span'); level.className='log-level ' + entry.level; level.textContent=entry.level;
          const message=document.createElement('span'); message.className='log-message'; message.textContent=entry.message;
          row.append(time,level,message);
          if (entry.fields && Object.keys(entry.fields).length) { const fields=document.createElement('pre'); fields.className='log-fields'; fields.textContent=JSON.stringify(entry.fields,null,2); row.append(fields); }
          panel.append(row);
        });
        logScrollbar?.update(); panel.scrollTop=panel.scrollHeight; logScrollbar?.update();
      } catch (error) { panel.textContent=error.message; }
    }

    function setup() {
      if (pollTimer) clearInterval(pollTimer);
      mainScrollbar = byId('main-scroll') ? createScrollbar(byId('main-scroll'), { suppressScrollX:true, wheelPropagation:false }) : null;
      logScrollbar = byId('log-panel') ? createScrollbar(byId('log-panel'), { suppressScrollX:true, wheelPropagation:false }) : null;
      byId('auth-form')?.addEventListener('submit',async(event)=>{ event.preventDefault(); const message=byId('auth-message'); message.className='feedback'; message.textContent=''; byId('auth-submit').disabled=true; try { const data=await request('/api/auth-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({link:byId('auth-link').value})}); message.textContent=data.message; byId('auth-link').value=''; } catch(error) { message.className='feedback error'; message.textContent=error.message; } await refreshOverview(); });
      byId('log-refresh')?.addEventListener('click',loadLogs); byId('log-level')?.addEventListener('change',loadLogs);
      byId('email-send')?.addEventListener('click',async()=>{ const recipients=mailRecipients.length ? mailRecipients.join(', ') : 'the configured recipients'; if(!window.confirm('Send the result email to '+recipients+'?')) return; const button=byId('email-send'); const message=byId('email-message'); button.disabled=true; button.textContent='Sending'; message.className='feedback email-feedback'; message.textContent=''; try { const data=await request('/api/email/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'result'})}); message.textContent=data.message; } catch(error) { message.className='feedback email-feedback error'; message.textContent=error.message; } finally { button.disabled=false; button.textContent='Send email'; } });
      byId('logout-button')?.addEventListener('click',async()=>{ try { await request('/api/auth/logout',{method:'POST'}); } finally { window.location.href='/login'; } });
      loadLogs();
      refreshOverview();
      (async()=>{ try { const session=await request('/api/auth/session'); if (!session.authenticated) { window.location.href='/login'; return; } csrfToken=session.csrfToken; } catch (_) {} })();
      pollTimer = setInterval(()=>{ refreshOverview(); if (byId('log-auto')?.checked) loadLogs(); },3000);
    }

    window.addEventListener('resize',()=>{ mainScrollbar?.update(); logScrollbar?.update(); });
    // Fires on the initial load and after every ClientRouter navigation.
    document.addEventListener('astro:page-load', setup);
