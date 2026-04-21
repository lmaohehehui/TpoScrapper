console.log('TPO Alerter Content Script Active');

// Helper for XPath
function getElementByXpath(path) {
  return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

function performScan() {
  const url = window.location.href;

  if (url === 'https://tpo.vierp.in/' || url.includes('/login')) {
    // We are on login, attempt auto-login
    chrome.storage.local.get(['creds'], (data) => {
      const creds = data.creds;
      if (creds && creds.username && creds.password) {
        const uField = getElementByXpath('/html/body/div[2]/div[1]/div/div/div[1]/div[2]/div/div/div[1]/div[2]/div[1]/div/input');
        const pField = getElementByXpath('/html/body/div[2]/div[1]/div/div/div[1]/div[2]/div/div/div[2]/div[2]/div[1]/div/input');
        const btn = getElementByXpath('/html/body/div[2]/div[1]/div/div/div[1]/div[2]/div/div/div[3]/button');

        if (uField && pField && btn) {
          uField.value = creds.username;
          pField.value = creds.password;
          uField.dispatchEvent(new Event('input', { bubbles: true }));
          pField.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(() => btn.click(), 500);
        }
      }
    });
  } else if (url.includes('apply_company')) {
    // We are on the target page, SCRAPE!
    const emptyMsgPath = "/html/body/div[2]/div[1]/div/div/div/main/div/div/div/div/div[1]/div/div";
    const msgElement = getElementByXpath(emptyMsgPath);

    if (msgElement && msgElement.textContent.includes("No Scheduled Company Found As Per Your Batch/Year Of Passing 2027")) {
      chrome.runtime.sendMessage({ action: 'scanResult', data: 'no company listed' });
    } else {
      // Extract actual company names
      const companies = [];
      // Common selectors for the list
      const rows = document.querySelectorAll('table tr, .company-name, .card-title');
      rows.forEach(r => {
        const txt = r.innerText.trim();
        if (txt.length > 5 && !txt.includes('Applied')) {
          companies.push(txt.split('\n')[0]); // Take first line as company name
        }
      });

      chrome.runtime.sendMessage({ action: 'scanResult', data: companies.length > 0 ? companies : 'no company listed' });
    }
  } else {
    // On dashboard or other, redirect to apply_company
    window.location.href = 'https://tpo.vierp.in/apply_company';
  }
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'startScan') {
    performScan();
  }
});

// Intentionally no auto-run here.
// Background checks run via chrome.alarms + API fetch and should NOT trigger
// page automation/navigation while the user is browsing.
