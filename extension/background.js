const ALARM_NAME = 'companyCheck';
const DEFAULT_PERIOD_MINUTES = 30;
const DEFAULT_API_URL = 'http://localhost:5000';

let inFlight = false;

function getAlarm(name) {
  return new Promise((resolve) => chrome.alarms.get(name, resolve));
}

async function ensureAlarmExists() {
  const existing = await getAlarm(ALARM_NAME);

  // Only create/recreate if missing or misconfigured.
  if (!existing || existing.periodInMinutes !== DEFAULT_PERIOD_MINUTES) {
    chrome.alarms.create(ALARM_NAME, {
      // First automatic run happens after 30 minutes (not immediately).
      delayInMinutes: DEFAULT_PERIOD_MINUTES,
      periodInMinutes: DEFAULT_PERIOD_MINUTES,
    });
    console.log(`[tpo] alarm ensured name=${ALARM_NAME} every=${DEFAULT_PERIOD_MINUTES}m`);
  }
}

function notify(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 2,
  });
}

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}

function hashCompanyData(data) {
  if (data === 'no company listed' || data == null) return 'none';
  if (!Array.isArray(data)) return 'unknown';
  // Simple stable hash input; avoids pulling in crypto.
  return data.map((s) => String(s).trim()).filter(Boolean).join('\n');
}

async function runCompanyCheck(reason) {
  if (inFlight) return;
  inFlight = true;

  console.log(`[tpo] runCompanyCheck start reason=${reason}`);

  try {
    const { creds, apiUrl, lastCompanyHash, lastAutoCheckAt } = await storageGet([
      'creds',
      'apiUrl',
      'lastCompanyHash',
      'lastAutoCheckAt',
    ]);

    // Enforce the 30-minute gap for scheduled (alarm) checks.
    // Manual checks (popup/widget) are allowed anytime.
    if (reason === 'alarm' && typeof lastAutoCheckAt === 'number') {
      const minGapMs = DEFAULT_PERIOD_MINUTES * 60 * 1000;
      const elapsedMs = Date.now() - lastAutoCheckAt;
      if (elapsedMs >= 0 && elapsedMs < minGapMs) {
        await storageSet({
          lastAutoCheckReason: reason,
          lastAutoCheckStatus: 'skipped',
          lastAutoCheckError: `Throttled: next auto-check in ${Math.ceil((minGapMs - elapsedMs) / 60000)} min`,
        });
        return;
      }
    }

    if (!creds || !creds.username || !creds.password) {
      // Nothing to do until user saves credentials.
      await storageSet({
        lastAutoCheckAt: Date.now(),
        lastAutoCheckReason: reason,
        lastAutoCheckStatus: 'skipped',
        lastAutoCheckError: 'Missing credentials',
      });
      return;
    }

    const baseUrl = (apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
    await storageSet({
      lastStatus: 'checking',
      lastAutoCheckAt: Date.now(),
      lastAutoCheckReason: reason,
      lastAutoCheckStatus: 'running',
      lastAutoCheckError: null,
    });

    const resp = await fetch(`${baseUrl}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: creds.username,
        password: creds.password,
      }),
    });

    const result = await resp.json();
    console.log(`[tpo] runCompanyCheck result status=${result.status}`);
    const nextHash = hashCompanyData(result.data);

    await storageSet({
      lastAutoCheckAt: Date.now(),
      lastAutoCheckReason: reason,
      lastAutoCheckStatus: result.status,
      lastCompanyData: result.data,
      lastCompanyMessage: result.message || null,
      lastCompanyHash: nextHash,
      lastStatus:
        result.status === 'success'
          ? (Array.isArray(result.data) && result.data.length > 0 ? 'found' : 'none')
          : 'none',
    });

    // Notify only when we have a *new* non-empty list.
    if (
      result.status === 'success' &&
      Array.isArray(result.data) &&
      result.data.length > 0 &&
      nextHash !== (lastCompanyHash || 'none')
    ) {
      console.log(`[tpo] notify new_companies count=${result.data.length}`);
      notify('New Companies!', `Found ${result.data.length} companies listed.`);
    }
  } catch (e) {
    console.error('[tpo] runCompanyCheck error', e);
    await storageSet({
      lastStatus: 'none',
      lastAutoCheckAt: Date.now(),
      lastAutoCheckReason: reason,
      lastAutoCheckStatus: 'error',
      lastAutoCheckError: String(e && e.message ? e.message : e),
    });
  } finally {
    console.log(`[tpo] runCompanyCheck done reason=${reason}`);
    inFlight = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  // Auto-check should run only on the 30-minute schedule.
  void ensureAlarmExists();
});

chrome.runtime.onStartup.addListener(() => {
  // Auto-check should run only on the 30-minute schedule.
  void ensureAlarmExists();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm && alarm.name === ALARM_NAME) {
    await storageSet({ lastAlarmFiredAt: Date.now(), lastAlarmName: alarm.name });
    await runCompanyCheck('alarm');
  }
});

// Keep manual notifications from popup working.
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'notify') {
    notify(request.title, request.message);
    sendResponse({ ok: true });
    return; // sync
  }

  if (request.action === 'runCheckNow') {
    // Keep the service worker alive until the async work finishes.
    runCompanyCheck('manual')
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true;
  }

  sendResponse({ ok: false, error: 'Unknown action' });
});

// Ensure the alarm exists after extension reloads (service worker start).
void ensureAlarmExists();
