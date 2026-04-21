# TPO Alerter 🚀

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.11+-blue.svg)
![Platform](https://img.shields.io/badge/platform-Chrome-orange.svg)
![Automation](https://img.shields.io/badge/automation-Selenium-green.svg)

A professional Chrome extension and cloud-powered automation suite designed to monitor the TPO (Training & Placement Office) portal and notify users when new companies are listed.

## 🌟 Key Features

- **30‑Minute Auto Checks**: Background checks run every **30 minutes** (no continuous polling).
- **Always‑On Widget**: Injects a small status widget on every normal website (http/https) so you can see results even when the extension popup is closed.
- **System Notifications**: Sends native browser alerts when **new** companies are found (list changed + non‑empty).
- **Smart Cloud Scraping**: Offloads heavy browser automation to a Python backend (Flask + Selenium + Chromium).
- **Premium UI**: Modern popup UI for credentials + manual checks.

## 🏗️ Architecture

The project follows a **Client-Server** architecture:

- **Frontend (Chrome Extension)**:
  - Stores credentials locally (Chrome storage)
  - Triggers manual checks (popup button / widget “Check now”)
  - Runs scheduled checks via `chrome.alarms` every 30 minutes
  - Shows an injected widget on all http/https pages, plus native notifications
- **Backend (Python API)**: A Flask server running Selenium within a Chromium/Docker environment to parse the TPO portal.

## 📂 Project Structure

```text
├── extension/             # Chrome extension (MV3)
│   ├── manifest.json      # Permissions, background worker, content scripts
│   ├── background.js      # 30-min scheduler + notifications
│   ├── widget.js          # Injected widget (runs on all http/https pages)
│   ├── popup.html         # Popup UI
│   ├── popup.js           # Popup controller (manual check)
│   ├── content.js         # TPO-domain helper automation (optional)
│   └── icons/             # Brand assets
├── api/                   # Backend (Flask + Selenium)
│   ├── Dockerfile         # Container config
│   ├── requirements.txt   # Python dependencies
│   └── index.py           # Flask API with Selenium logic
└── local_test.py          # Local debug runner (optional)
```

## 🚀 Getting Started

### 1. Extension Installation

1. Download the latest `TPO_Alerter.zip` from the [Releases](https://github.com/kakarot2905/scrapNautomate/releases) page.
2. Extract the ZIP file.
3. Open Google Chrome and navigate to `chrome://extensions/`.
4. Enable **Developer mode** in the top-right corner.
5. Click **Load unpacked** and select the extracted folder.

After loading, the widget will appear on normal websites after you refresh/open a page.

### 2. Backend Deployment (Optional)

If you wish to host your own version:

1. Fork this repository.
2. Create a new **Web Service** on [Render.com](https://render.com).
3. Select **Docker** as the environment.
4. Set the `PORT` environment variable (Render handles this automatically).
5. Update the `API_URL` in `extension/popup.js` to point to your backend.

#### Run backend locally (Docker)

From the `api/` folder:

```bash
docker build -t scrapper .
docker run --rm -it -e PORT=5000 -p 5000:5000 scrapper
```

Or from the repo root:

```bash
docker build -t scrapper -f api/Dockerfile api
docker run --rm -it -e PORT=5000 -p 5000:5000 scrapper
```

The extension expects the backend at `http://localhost:5000` by default.

## 🛠️ Technology Stack

- **Frontend**: HTML5, Vanilla CSS (Glassmorphism), JavaScript.
- **Backend**: Python 3.11, Flask, Gunicorn.
- **Automation**: Selenium Webdriver, Chromium (Headless).
- **Deployment**: Docker, Render.

## 📝 Usage

1. Start the backend (Docker/Render/etc.) and ensure it stays running.
2. Open the extension popup from your Chrome toolbar.
3. Enter your **Username** and **Password**.
4. Click **Update Credentials**.
5. Choose how to check:
   - **Automatic (every 30 minutes)**: runs in the background while Chrome is running (first auto run occurs after ~30 minutes).
   - **Manual**: click **Check for Companies** in the popup, or click **Check now** on the injected widget.

Note: opening the popup does **not** trigger a request by itself.

You’ll receive a system notification only when the company list changes and is non‑empty.

### Widget

- The widget is injected on all normal websites (`http://` / `https://`).
- Use **×** to close it for the current tab (it will reappear on refresh/new tabs).

## 📜 License

This project is licensed under the MIT License.

---

Built with ❤️ for the Batch of 2027.
