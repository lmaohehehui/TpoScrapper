document.addEventListener('DOMContentLoaded', () => {
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const saveBtn = document.getElementById('saveBtn');
  const checkBtn = document.getElementById('checkBtn');
  const statusMsg = document.getElementById('statusMsg');
  const statusIndicator = document.getElementById('statusIndicator');
  const companyList = document.getElementById('companyList');

  // Hardcoded API Endpoint
  // Keep this in sync with your docker run port mapping.
  const API_URL = 'http://localhost:5000';

  // Load existing credentials + last known result (manual or auto).
  // IMPORTANT: opening the popup should NOT trigger any network requests.
  chrome.storage.local.get(['creds', 'lastStatus', 'lastCompanyData', 'lastCompanyMessage'], (data) => {
    if (data.creds) {
      usernameInput.value = data.creds.username || '';
      passwordInput.value = data.creds.password || '';
    }
    setIndicator(data.lastStatus || 'idle');

    if (data.lastCompanyData) {
      renderResult(data.lastCompanyData);
    } else if (data.lastCompanyMessage) {
      statusMsg.textContent = data.lastCompanyMessage;
    }
  });

  saveBtn.addEventListener('click', () => {
    const creds = {
      username: usernameInput.value,
      password: passwordInput.value
    };
    // Store API URL along with creds so the background worker can use it.
    chrome.storage.local.set({ creds, apiUrl: API_URL }, () => {
      statusMsg.textContent = 'Credentials updated.';
      setTimeout(() => statusMsg.textContent = 'Ready to scan', 2000);
    });
  });

  checkBtn.addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['creds']);
    const creds = data.creds;

    if (!creds || !creds.username || !creds.password) {
      statusMsg.textContent = 'Error: Enter credentials first.';
      return;
    }

    // Persist API URL so background checks hit the same endpoint.
    chrome.storage.local.set({ apiUrl: API_URL });

    setStatus('checking');
    statusMsg.textContent = 'Connecting to TPO Server...';

    try {
      const response = await fetch(`${API_URL}/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: creds.username,
          password: creds.password
        })
      });

      const result = await response.json();

      // Persist for popup reloads and for background notification diffing.
      chrome.storage.local.set({
        lastCompanyData: result.data,
        lastCompanyMessage: result.message || null,
      });

      if (result.status === 'success') {
        renderResult(result.data);
        maybeNotify(result.data);
      } else {
        statusMsg.textContent = 'Error: ' + (result.message || 'API failed');
        setStatus('none');
      }
    } catch (error) {
      console.error(error);
      statusMsg.textContent = 'Could not connect to server.';
      setStatus('none');
    }
  });

  function renderResult(data) {
    companyList.innerHTML = '';

    if (data === 'no company listed') {
      setStatus('none');
      statusMsg.textContent = 'No companies found for 2027.';
    } else if (Array.isArray(data) && data.length > 0) {
      setStatus('found');
      statusMsg.textContent = `${data.length} Companies Available!`;
      data.forEach(item => {
        const div = document.createElement('div');
        div.className = 'company-item';
        div.textContent = item;
        companyList.appendChild(div);
      });
    } else {
      setStatus('none');
      statusMsg.textContent = 'No listing found.';
    }
  }

  function maybeNotify(data) {
    if (Array.isArray(data) && data.length > 0) {
      chrome.runtime.sendMessage({
        action: 'notify',
        title: 'New Companies!',
        message: `Found ${data.length} companies listed.`,
      });
    }
  }

  function setIndicator(status) {
    statusIndicator.className = 'indicator ' + status;
  }

  function setStatus(status) {
    setIndicator(status);
    chrome.storage.local.set({ lastStatus: status });
  }
});
