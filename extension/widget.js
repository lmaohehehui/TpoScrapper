// Lightweight on-page widget shown on every http/https page.
// It reflects the latest stored company scan results and can trigger a check
// without requiring the extension popup to be open.

(function () {
    const HOST_ID = 'tpo-alerter-widget-host';

    function canInject() {
        // Content scripts won't run on chrome:// pages anyway, but keep it defensive.
        try {
            return document && document.documentElement;
        } catch {
            return false;
        }
    }

    function injectWidget() {
        if (!canInject()) return;
        if (document.getElementById(HOST_ID)) return;

        const host = document.createElement('div');
        host.id = HOST_ID;
        host.style.position = 'fixed';
        host.style.bottom = '16px';
        host.style.right = '16px';
        host.style.zIndex = '2147483647';
        host.style.width = '300px';
        host.style.maxWidth = 'calc(100vw - 32px)';

        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .card {
          font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          font-size: 12px;
          color: #111;
          background: #fff;
          border: 1px solid rgba(0,0,0,0.12);
          border-radius: 10px;
          padding: 10px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.18);
        }
        .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .left { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .title { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .muted { color: rgba(0,0,0,0.65); }
        .dot { width: 10px; height: 10px; border-radius: 999px; background: #9ca3af; flex: 0 0 auto; }
        .dot.checking { background: #f59e0b; }
        .dot.found { background: #10b981; }
        .dot.none { background: #6b7280; }
        .dot.error { background: #ef4444; }
        .btn {
          appearance: none;
          border: 1px solid rgba(0,0,0,0.18);
          background: #f3f4f6;
          color: #111;
          padding: 6px 10px;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          flex: 0 0 auto;
        }
        .close {
          appearance: none;
          border: 0;
          background: transparent;
          color: rgba(0,0,0,0.65);
          cursor: pointer;
          font-size: 16px;
          line-height: 16px;
          padding: 4px 6px;
          border-radius: 8px;
          flex: 0 0 auto;
        }
        .close:hover { background: rgba(0,0,0,0.06); color: rgba(0,0,0,0.85); }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .banner {
          display: none;
          margin-top: 8px;
          padding: 8px;
          border-radius: 8px;
          background: rgba(16, 185, 129, 0.12);
          border: 1px solid rgba(16, 185, 129, 0.35);
          color: #065f46;
          font-weight: 700;
        }
        .banner.show { display: block; }
        .list { margin-top: 8px; max-height: 160px; overflow: auto; padding-right: 4px; }
        .item { padding: 6px 8px; border: 1px solid rgba(0,0,0,0.10); border-radius: 8px; margin-top: 6px; }
        .footer { margin-top: 8px; display: flex; align-items: center; justify-content: space-between; }
        .link {
          appearance: none;
          border: 0;
          background: transparent;
          padding: 0;
          color: rgba(0,0,0,0.65);
          cursor: pointer;
          text-decoration: underline;
          font-size: 12px;
        }
      </style>
      <div class="card">
        <div class="row">
          <div class="left">
            <div id="dot" class="dot"></div>
            <div class="title">TPO Company Alerter</div>
          </div>
          <div class="row" style="gap: 6px;">
            <button id="checkNow" class="btn" type="button">Check now</button>
            <button id="close" class="close" type="button" aria-label="Close">×</button>
          </div>
        </div>
        <div id="banner" class="banner">New companies found</div>
        <div id="line1" class="muted" style="margin-top: 6px;">Status: idle</div>
        <div id="line2" class="muted" style="margin-top: 2px;">Last check: —</div>
        <div id="list" class="list"></div>
          <div class="footer">
            <div id="count" class="muted"></div>
          </div>
      </div>
    `;

        document.documentElement.appendChild(host);

        const btn = shadow.getElementById('checkNow');
        const close = shadow.getElementById('close');
        btn.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: 'runCheckNow' }, () => {
                // state updates via storage listener
            });
        });

        close.addEventListener('click', () => {
            try {
                host.remove();
            } catch {
                // ignore
            }
        });
    }

    function formatTime(ts) {
        if (!ts) return '—';
        try {
            return new Date(ts).toLocaleString();
        } catch {
            return '—';
        }
    }

    let lastSeenHash = null;
    let lastRendered = {};

    function render(state) {
        const host = document.getElementById(HOST_ID);
        if (!host || !host.shadowRoot) return;

        const shadow = host.shadowRoot;
        const dot = shadow.getElementById('dot');
        const line1 = shadow.getElementById('line1');
        const line2 = shadow.getElementById('line2');
        const list = shadow.getElementById('list');
        const btn = shadow.getElementById('checkNow');
        const banner = shadow.getElementById('banner');
        const count = shadow.getElementById('count');

        const lastStatus = state.lastStatus || lastRendered.lastStatus || 'idle';
        const autoStatus = state.lastAutoCheckStatus || lastRendered.lastAutoCheckStatus;
        const err = state.lastAutoCheckError || lastRendered.lastAutoCheckError;
        const data = state.lastCompanyData !== undefined ? state.lastCompanyData : lastRendered.lastCompanyData;
        const hash = state.lastCompanyHash || lastRendered.lastCompanyHash;

        // Save snapshot for partial updates coming from storage.onChanged
        lastRendered = {
            ...lastRendered,
            ...state,
            lastStatus,
            lastAutoCheckStatus: autoStatus,
            lastAutoCheckError: err,
            lastCompanyData: data,
            lastCompanyHash: hash,
        };

        dot.className = 'dot';
        if (lastStatus === 'checking') dot.classList.add('checking');
        else if (lastStatus === 'found') dot.classList.add('found');
        else if (autoStatus === 'error') dot.classList.add('error');
        else dot.classList.add('none');

        if (autoStatus === 'error') {
            line1.textContent = `Status: error${err ? ` (${err})` : ''}`;
        } else {
            line1.textContent = `Status: ${lastStatus}`;
        }

        line2.textContent = `Last check: ${formatTime(state.lastAutoCheckAt || lastRendered.lastAutoCheckAt || state.lastAlarmFiredAt || lastRendered.lastAlarmFiredAt)}`;

        list.innerHTML = '';
        let shownCount = 0;
        if (Array.isArray(data) && data.length > 0) {
            const items = data.slice(0, 10);
            items.forEach((name) => {
                const div = document.createElement('div');
                div.className = 'item';
                div.textContent = String(name);
                list.appendChild(div);
            });
            shownCount = data.length;
            if (data.length > 10) {
                const more = document.createElement('div');
                more.className = 'muted';
                more.style.marginTop = '6px';
                more.textContent = `…and ${data.length - 10} more`;
                list.appendChild(more);
            }
        } else if (data === 'no company listed') {
            const div = document.createElement('div');
            div.className = 'muted';
            div.style.marginTop = '6px';
            div.textContent = 'No companies listed.';
            list.appendChild(div);
            shownCount = 0;
        }

        count.textContent = shownCount > 0 ? `${shownCount} companies` : '';
        btn.disabled = lastStatus === 'checking';

        // Banner when a NEW non-empty list appears.
        if (hash && hash !== lastSeenHash && Array.isArray(data) && data.length > 0) {
            banner.classList.add('show');
            setTimeout(() => banner.classList.remove('show'), 7000);
        }
        if (hash) lastSeenHash = hash;
    }

    function init() {
        chrome.storage.local.get(
            [
                'lastStatus',
                'lastCompanyData',
                'lastCompanyHash',
                'lastAutoCheckAt',
                'lastAutoCheckStatus',
                'lastAutoCheckError',
                'lastAlarmFiredAt',
            ],
            (data) => {
                injectWidget();
                render(data);
            }
        );

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return;
            const next = {};
            for (const [k, v] of Object.entries(changes)) next[k] = v.newValue;
            render(next);
        });
    }

    init();
})();
