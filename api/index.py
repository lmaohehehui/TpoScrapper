from flask import Flask, request, jsonify
from flask_cors import CORS
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, NoSuchElementException, WebDriverException
import logging
import time
import os
import uuid

app = Flask(__name__)
CORS(app) # Enable CORS for the Chrome Extension


def _configure_logging():
    """Configure stdout logging for local runs and containers.

    Gunicorn may set up handlers itself; this only configures logging if nothing
    is configured yet.
    """
    root = logging.getLogger()
    if root.handlers:
        return
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


_configure_logging()
logger = logging.getLogger("tpo")

# If running under gunicorn, route our app logs through gunicorn's handlers so
# they show up in `docker logs` consistently.
_gunicorn_error_logger = logging.getLogger("gunicorn.error")
if _gunicorn_error_logger and _gunicorn_error_logger.handlers:
    logger.handlers = _gunicorn_error_logger.handlers
    logger.setLevel(_gunicorn_error_logger.level or logging.INFO)
    logger.propagate = False
else:
    logger.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())

def run_tpo_scrape(username, password, request_id: str | None = None):
    request_id = request_id or "-"
    start_time = time.perf_counter()
    scrape_max_seconds = float(os.environ.get("SCRAPE_MAX_SECONDS", "600"))
    deadline = start_time + scrape_max_seconds

    # Simple timer-based waits (like local_test.py)
    step_sleep_seconds = float(os.environ.get("STEP_SLEEP_SECONDS", "2"))
    sleep_after_login_click = float(os.environ.get("SLEEP_AFTER_LOGIN_CLICK", "3"))
    sleep_after_apply_company = float(os.environ.get("SLEEP_AFTER_APPLY_COMPANY", "3"))
    element_poll_seconds = float(os.environ.get("ELEMENT_POLL_SECONDS", "0.5"))
    element_find_timeout = float(os.environ.get("ELEMENT_FIND_TIMEOUT", "20"))

    def log_step(message: str):
        elapsed = time.perf_counter() - start_time
        logger.info("rid=%s t=%.2fs %s", request_id, elapsed, message)

    def ensure_deadline(step: str) -> None:
        now = time.perf_counter()
        if now > deadline:
            raise TimeoutException(
                f"Scrape exceeded SCRAPE_MAX_SECONDS={scrape_max_seconds:.0f}s at step={step}"
            )

    def sleep_step(step: str, seconds: float) -> None:
        ensure_deadline(step)
        log_step(f"sleep {seconds:.1f}s step={step}")
        time.sleep(seconds)

    log_step("scrape_start")

    options = Options()
    # Chromium 109+ supports "new" headless mode; it tends to match non-headless
    # rendering more closely on some sites.
    headless_arg = os.environ.get("CHROME_HEADLESS_ARG", "--headless=new")
    if headless_arg:
        options.add_argument(headless_arg)
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--blink-settings=imagesEnabled=false')
    options.add_argument('--disable-extensions')
    options.add_argument('--disable-default-apps')
    options.add_argument('--disable-sync')
    options.add_argument('--disable-translate')
    options.add_argument('--disable-background-networking')
    options.add_argument('--disable-client-side-phishing-detection')
    options.add_argument('--disable-hang-monitor')
    options.add_argument('--disable-popup-blocking')
    options.add_argument('--disable-prompt-on-repost')
    options.add_argument('--no-first-run')
    options.add_argument('--no-default-browser-check')
    options.add_argument('--disable-logging')
    options.add_argument('--log-level=3')
    options.add_argument('--silent')
    options.add_argument('--disable-setuid-sandbox')
    options.add_argument('--window-size=1920,1080')
    options.add_argument('--disk-cache-size=1')
    options.add_argument('--media-cache-size=1')

    user_agent = os.environ.get("CHROME_USER_AGENT")
    if user_agent:
        options.add_argument(f"--user-agent={user_agent}")

    # Optional: reduce obvious automation flags (may help on some sites).
    options.add_argument('--disable-blink-features=AutomationControlled')

    # Use system installed Chromium
    options.binary_location = os.environ.get("CHROME_BIN", "/usr/bin/chromium")
    service = Service(executable_path=os.environ.get("CHROMEDRIVER_PATH", "/usr/bin/chromedriver"))

    log_step("launching_chrome")
    driver = webdriver.Chrome(service=service, options=options)
    driver.set_page_load_timeout(int(os.environ.get("SELENIUM_PAGELOAD_TIMEOUT", "60")))
    driver.set_script_timeout(int(os.environ.get("SELENIUM_SCRIPT_TIMEOUT", "60")))

    def log_page_state(step: str) -> None:
        try:
            current_url = driver.current_url
        except Exception:
            current_url = "<unknown>"
        try:
            title = driver.title
        except Exception:
            title = "<unknown>"
        log_step(f"page_state step={step} url={current_url} title={title}")

    def find_with_retry(step: str, candidates: list[tuple[str, str]]):
        end = time.perf_counter() + element_find_timeout
        last_exc: Exception | None = None

        def _try_in_current_context():
            nonlocal last_exc
            for by, selector in candidates:
                try:
                    return driver.find_element(by, selector)
                except NoSuchElementException as e:
                    last_exc = e
            return None

        while time.perf_counter() < end:
            ensure_deadline(step)
            el = _try_in_current_context()
            if el is not None:
                return el

            try:
                iframes = driver.find_elements(By.TAG_NAME, "iframe")
            except Exception:
                iframes = []

            if iframes:
                for i, frame in enumerate(iframes[:10], start=1):
                    ensure_deadline(f"{step}.iframe.{i}")
                    try:
                        driver.switch_to.frame(frame)
                        el = _try_in_current_context()
                        if el is not None:
                            return el
                    except Exception as e:
                        last_exc = e
                    finally:
                        try:
                            driver.switch_to.default_content()
                        except Exception:
                            pass

            time.sleep(element_poll_seconds)

        raise TimeoutException(f"Timed out locating element at step={step}") from last_exc

    try:
        log_step("navigate_login_page")
        ensure_deadline("navigate_login_page")
        driver.get("https://tpo.vierp.in/")
        sleep_step("after_login_page_load", step_sleep_seconds)
        log_page_state("after_login_page_load")

        # Selectors (kept as primary, but we also use fallbacks)
        u_xpath = "/html/body/div[2]/div[1]/div/div/div[1]/div[2]/div/div/div[1]/div[2]/div[1]/div/input"
        p_xpath = "/html/body/div[2]/div[1]/div/div/div[1]/div[2]/div/div/div[2]/div[2]/div[1]/div/input"
        btn_xpath = "/html/body/div[2]/div[1]/div/div/div[1]/div[2]/div/div/div[3]/button"

        log_step("fill_username")
        username_el = find_with_retry(
            "fill_username",
            [
                (By.XPATH, u_xpath),
                (By.XPATH, "//input[@type='email']"),
                (By.XPATH, "//input[contains(@placeholder,'Email') or contains(@placeholder,'email') or contains(@name,'email') or contains(@id,'email') or contains(@name,'username') or contains(@id,'username')]"),
            ],
        )
        username_el.clear()
        username_el.send_keys(username)

        log_step("fill_password")
        password_el = find_with_retry(
            "fill_password",
            [
                (By.XPATH, p_xpath),
                (By.XPATH, "//input[@type='password']"),
            ],
        )
        password_el.clear()
        password_el.send_keys(password)

        log_step("click_login")
        login_btn = find_with_retry(
            "click_login",
            [
                (By.XPATH, btn_xpath),
                (By.XPATH, "//button[@type='submit']"),
                (By.XPATH, "//button[contains(.,'Login') or contains(.,'Sign in') or contains(.,'SIGN IN') or contains(.,'LOG IN')]"),
            ],
        )
        login_btn.click()
        sleep_step("after_login_click", sleep_after_login_click)
        log_page_state("after_login_click")

        log_step("navigate_apply_company")
        ensure_deadline("navigate_apply_company")
        driver.get("https://tpo.vierp.in/apply_company")
        sleep_step("after_apply_company_load", sleep_after_apply_company)
        log_page_state("after_apply_company_load")

        log_step("check_apply_company_main")
        find_with_retry(
            "check_apply_company_main",
            [
                (By.XPATH, "/html/body/div[2]/div[1]/div/div/div/main"),
                (By.XPATH, "//main"),
            ],
        )

        # Guard: if login failed silently, the site redirects back to the root login page.
        if driver.current_url.rstrip("/") == "https://tpo.vierp.in":
            log_step("auth_failed_redirected_to_login")
            return {"status": "error", "message": "Login failed — redirected back to login page. Check credentials."}
        
        # Check for "No company"
        empty_msg_xpath = "/html/body/div[2]/div[1]/div/div/div/main/div/div/div/div/div[1]/div/div"
        try:
            log_step("check_no_company_message")
            ensure_deadline("check_no_company_message")
            msg_element = driver.find_element(By.XPATH, empty_msg_xpath)
            if "No Scheduled Company Found" in msg_element.text:
                log_step("no_company_listed")
                return {"status": "success", "data": "no company listed"}
        except:
            log_step("no_company_message_not_found")
            pass

        # Extract company list based on the apply_company page structure.
        # NOTE: This XPath points to the *container* that holds company items.
        company_container_xpath = "/html/body/div[2]/div[1]/div/div/div/main/div/div/div/div/div[1]/div"

        log_step("find_company_container")
        ensure_deadline("find_company_container")
        company_container = driver.find_element(By.XPATH, company_container_xpath)

        log_step("find_company_items")
        ensure_deadline("find_company_items")
        # Most UIs render each company as a direct child div of the container.
        company_items = company_container.find_elements(By.XPATH, "./div")
        log_step(f"company_items_found count={len(company_items)}")

        if not company_items:
            log_step("company_items_empty")
            return {"status": "success", "data": "no company listed"}

        company_list = []
        for index, company in enumerate(company_items, start=1):
            text_content = company.text.strip()
            if text_content:
                # Avoid printing sensitive content; log only counts/indices.
                log_step(f"company_extracted index={index}")
                company_list.append(text_content)

        if not company_list:
            log_step("company_list_empty_after_filter")
            return {"status": "success", "data": "no company listed"}

        log_step(f"scrape_success companies={len(company_list)}")
        return {"status": "success", "data": company_list}

    except TimeoutException:
        logger.exception("rid=%s selenium_timeout", request_id)
        try:
            log_page_state("timeout")
        except Exception:
            pass
        return {
            "status": "error",
            "message": "Timed out while loading or locating elements. Increase STEP_SLEEP_SECONDS / ELEMENT_FIND_TIMEOUT, or the site may be blocking headless Chrome.",
        }
    except WebDriverException:
        logger.exception("rid=%s webdriver_error", request_id)
        try:
            log_page_state("webdriver_error")
        except Exception:
            pass
        return {"status": "error", "message": "WebDriver/Chrome error."}
    except Exception as e:
        logger.exception("rid=%s scrape_error", request_id)
        try:
            log_page_state("scrape_error")
        except Exception:
            pass
        return {"status": "error", "message": str(e)}
    finally:
        log_step("driver_quit")
        try:
            driver.quit()
        except Exception:
            pass

@app.route('/scrape', methods=['POST'])
def scrape():
    logger.info("Received /scrape request")
    rid = uuid.uuid4().hex[:12]
    request_start = time.perf_counter()

    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        logger.warning("rid=%s missing_credentials", rid)
        return jsonify({"status": "error", "message": "Missing credentials"}), 400
    
    logger.info("rid=%s /scrape request_received", rid)
    result = run_tpo_scrape(username, password, request_id=rid)
    elapsed = time.perf_counter() - request_start
    logger.info("rid=%s /scrape request_complete t=%.2fs status=%s", rid, elapsed, result.get("status"))
    return jsonify(result)

if __name__ == "__main__":
    # Local fallback
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)