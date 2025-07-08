import os
import re
import time
import base64
import json
import traceback
from datetime import datetime
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

MAX_CAPTCHA_ATTEMPTS = 7
USERNAME = os.getenv("NIM")
PASSWORD = os.getenv("PASSWORD")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MAX_RESTARTS = 1
STATE_FILE = "scraper_state.json"

LOGIN_URL = "https://sia.polytechnic.astra.ac.id/sso/Page_Login.aspx"
COURSES_LIST_PAGE_URL = "https://sia.polytechnic.astra.ac.id/Page_Pelaksanaan_Aktivitas_Pembelajaran.aspx"
SSO_BASE_URL = "https://sia.polytechnic.astra.ac.id/sso/"
SIA_BASE_URL = "https://sia.polytechnic.astra.ac.id/"

# Initialize Gemini
if GEMINI_API_KEY and GEMINI_API_KEY not in ["YOUR_GEMINI_API_KEY_HERE", ""]:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel('gemini-1.5-flash')
        print("Gemini model initialized successfully.")
    except Exception as e:
        model = None
        print(f"Error initializing Gemini: {e}. CAPTCHA solving will be skipped or fail.")
else:
    model = None
    print("Warning: Gemini API key not configured. CAPTCHA solving will be skipped or fail.")

def solve_captcha_with_gemini(page):
    if not model:
        print("Gemini model not initialized. Skipping CAPTCHA solving.")
        return "MANUAL_INPUT_REQUIRED"

    captcha_img_locator = page.locator("#MainContent_imgCaptcha")
    try:
        captcha_img_locator.wait_for(state="visible", timeout=10000)
        page.wait_for_timeout(500)  # Allow image to render
        captcha_img_locator.screenshot(path="captcha.png")
    except Exception as e:
        print(f"Error locating or screenshotting CAPTCHA: {e}")
        page.screenshot(path="captcha_error_page.png")
        return None

    if not os.path.exists("captcha.png"):
        print("CAPTCHA image file not created.")
        return None

    with open("captcha.png", "rb") as img_file:
        base64_image = base64.b64encode(img_file.read()).decode('utf-8')

    prompt = """Extract ONLY numeric digits from this CAPTCHA. Return JUST THE NUMBERS as a continuous string. If no numbers are clear, state 'unclear'."""
    try:
        response = model.generate_content([prompt, {"mime_type": "image/png", "data": base64_image}])
        if hasattr(response, 'text') and response.text:
            solution = response.text.strip()
            if solution.lower() == 'unclear' or not solution.isdigit():
                print(f"Gemini solution was not purely numeric or unclear: '{solution}'")
                return None
            return solution
        else:
            print(f"Gemini API response did not contain text. Response: {response}")
            return None
    except Exception as e:
        print(f"Error calling Gemini API: {e}")
        return None

def handle_captcha(page, attempt):
    print(f"\nCAPTCHA Attempt {attempt + 1}/{MAX_CAPTCHA_ATTEMPTS}")
    captcha_solution = solve_captcha_with_gemini(page)

    if captcha_solution is None:
        print("Failed to get a valid CAPTCHA solution from Gemini.")
        return False

    if captcha_solution == "MANUAL_INPUT_REQUIRED":
        print("CAPTCHA solving skipped due to missing Gemini configuration.")
        page.click("#MainContent_btnLogin")
        return True

    print(f"Gemini Solution: {captcha_solution}")
    page.fill("#txtCaptcha", captcha_solution)
    page.click("#MainContent_btnLogin")
    return True

def sanitize_filename(name):
    if not isinstance(name, str):
        name = str(name)
    name = re.sub(r'[<>:"/\\|?*]', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    name = re.sub(r'[^\w\s.-]', '', name)
    name = re.sub(r'__+', '_', name)
    name = name.strip('.- ')
    if not name:
        return "sanitized_file"
    return name[:150]

def parse_indonesian_date(date_str):
    month_map = {
        'Januari': 'January', 'Februari': 'February', 'Maret': 'March',
        'April': 'April', 'Mei': 'May', 'Juni': 'June',
        'Juli': 'July', 'Agustus': 'August', 'September': 'September',
        'Oktober': 'October', 'November': 'November', 'Desember': 'December'
    }

    try:
        date_match = re.search(r'(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})', date_str)
        if date_match:
            day = date_match.group(1)
            id_month = date_match.group(2)
            year = date_match.group(3)
            
            if id_month in month_map:
                en_month = month_map[id_month]
                date_obj = datetime.strptime(f"{day} {en_month} {year}", "%d %B %Y")
                return date_obj
    except Exception as e:
        print(f"Date parsing error: {e}")
    return None

def load_tugas_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_tugas_state(state):
    try:
        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=4)
    except Exception as e:
        print(f"Error saving tugas state: {e}")

def run_scraper():
    # Load tugas state
    tugas_state = load_tugas_state()
    print(f"Loaded tugas state with {len(tugas_state)} entries")
    
    with sync_playwright() as p:
        base_data_dir = os.path.join(os.getcwd(), "scraped_data")
        if not os.path.exists(base_data_dir):
            os.makedirs(base_data_dir)
        print(f"Created data directory: {base_data_dir}")

        # Add browser context for download handling
        browser = p.firefox.launch(headless=False)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0",
            accept_downloads=True  # Enable downloads to handle them properly
        )
        page = context.new_page()

        # List to store downloaded files for cleanup
        downloaded_files = []

        try:
            print(f"Navigating to login page: {LOGIN_URL}")
            page.goto(LOGIN_URL, timeout=60000)
            page.fill("#txtUsername", USERNAME if USERNAME is not None else "")

            login_success = False
            for attempt in range(MAX_CAPTCHA_ATTEMPTS):
                page.fill("#txtPassword", PASSWORD if PASSWORD is not None else "")

                if not handle_captcha(page, attempt):
                    if attempt < MAX_CAPTCHA_ATTEMPTS - 1:
                        print("Retrying CAPTCHA...")
                        time.sleep(2)
                        if page.url.startswith(LOGIN_URL) and page.locator("#txtCaptcha").is_visible(timeout=1000):
                            try:
                                refresh_button = page.locator("#MainContent_btnRefreshCaptcha")
                                if refresh_button.is_visible(timeout=1000):
                                    print("Refreshing CAPTCHA image...")
                                    refresh_button.click()
                                    time.sleep(1)
                            except Exception:
                                print("No CAPTCHA refresh button found.")
                            continue
                        else:
                            if (page.url.startswith(SIA_BASE_URL) and "default.aspx" in page.url.lower()) or \
                               (page.url.startswith(SSO_BASE_URL) and "default.aspx" in page.url.lower()):
                                login_success = True
                                break
                            else:
                                print("Not on CAPTCHA page after Gemini failure. Stopping retries.")
                                break
                    else:
                        print("Max CAPTCHA attempts reached.")
                        break

                try:
                    print("Waiting for page reaction...")
                    page.wait_for_url(
                        lambda url: not url.startswith(LOGIN_URL) or "default.aspx" in url.lower(),
                        timeout=15000
                    )
                    if (page.url.startswith(SIA_BASE_URL) and "default.aspx" in page.url.lower()) or \
                       (page.url.startswith(SSO_BASE_URL) and "default.aspx" in page.url.lower()):
                        login_success = True
                        print(f"Login success. URL: {page.url}")
                        break
                    else:
                        error_message_locator = page.locator("#MainContent_lblMessage[style*='color:Red']")
                        if error_message_locator.is_visible(timeout=1000):
                            error_text = error_message_locator.text_content(timeout=1000)
                            if error_text:
                                error_text = error_text.lower()
                            print(f"Login error: {error_text}")
                        elif page.locator("#txtCaptcha").is_visible(timeout=1000):
                             print("CAPTCHA verification failed.")
                        else:
                            print(f"Login status unclear. URL: {page.url}")

                except PlaywrightTimeoutError:
                    print("Timeout waiting for URL change.")
                    error_message_locator = page.locator("#MainContent_lblMessage[style*='color:Red']")
                    if error_message_locator.is_visible(timeout=1000):
                        error_text = error_message_locator.text_content(timeout=1000)
                        if error_text:
                            error_text = error_text.lower()
                        print(f"Login error: {error_text}")
                    elif page.locator("#txtCaptcha").is_visible(timeout=1000):
                         print("CAPTCHA verification failed.")
                    else:
                        print(f"Login status unclear after timeout. URL: {page.url}")
                        if (page.url.startswith(SIA_BASE_URL) and "default.aspx" in page.url.lower()) or \
                           (page.url.startswith(SSO_BASE_URL) and "default.aspx" in page.url.lower()):
                            login_success = True
                            break

                if attempt < MAX_CAPTCHA_ATTEMPTS - 1 and not login_success:
                    print("Retrying login...")
                    if page.url.startswith(LOGIN_URL) and page.locator("#txtCaptcha").is_visible(timeout=1000):
                        try:
                            refresh_button = page.locator("#MainContent_btnRefreshCaptcha")
                            if refresh_button.is_visible(timeout=1000):
                                refresh_button.click()
                                time.sleep(1)
                        except Exception:
                            pass
                    elif not page.url.startswith(LOGIN_URL):
                        page.goto(LOGIN_URL, timeout=30000)
                        page.fill("#txtUsername", USERNAME if USERNAME is not None else "")
                    time.sleep(2)
                elif login_success:
                    break
                else:
                    print("Max login attempts reached.")
                    break

            if not login_success:
                if not ((page.url.startswith(SIA_BASE_URL) and "default.aspx" in page.url.lower()) or \
                        (page.url.startswith(SSO_BASE_URL) and "default.aspx" in page.url.lower())):
                    page.screenshot(path="login_failure_final_page.png")
                    print(f"Login failed. URL: {page.url}")
                    browser.close()
                    return

            print("\nLogin successful!")
            print(f"Current URL: {page.url}")

            print("Looking for 'Sistem Informasi Akademik' link...")
            sia_link = page.locator("a:has-text('Sistem Informasi Akademik')")
            sia_link.wait_for(state="visible", timeout=15000)
            print("Clicking link...")
            sia_link.click()

            print("Looking for 'Login sebagai MAHASISWA' link...")
            mahasiswa_login_link = page.locator("a:has-text('Login sebagai MAHASISWA')")
            mahasiswa_login_link.wait_for(state="visible", timeout=15000)
            print("Clicking link...")
            with page.expect_navigation(timeout=30000, wait_until="networkidle"):
                mahasiswa_login_link.click()

            print(f"Navigated to student dashboard. URL: {page.url}")

            print("Navigating to 'Pelaksanaan Perkuliahan' section...")
            pelaksanaan_perkuliahan_header = page.locator("a:has-text('Pelaksanaan Perkuliahan')")
            aktivitas_pembelajaran_link = page.locator("a:has-text('– Aktivitas Pembelajaran')")

            if not aktivitas_pembelajaran_link.is_visible(timeout=5000):
                print("Expanding section...")
                pelaksanaan_perkuliahan_header.click()
                page.wait_for_timeout(1000)

            print("Clicking '– Aktivitas Pembelajaran'...")
            aktivitas_pembelajaran_link.wait_for(state="visible", timeout=10000)
            with page.expect_navigation(wait_until="networkidle", timeout=30000):
                 aktivitas_pembelajaran_link.click()

            print(f"On courses list page. URL: {page.url}")

            # Extract course information
            print("\nExtracting course information...")
            course_rows = page.locator("#MainContent_gridData tbody tr")
            num_courses = course_rows.count()
            print(f"Found {num_courses} courses")

            course_info_list = []
            for i in range(num_courses):
                row = course_rows.nth(i)
                try:
                    kode_mk = row.locator("td").nth(5).text_content()
                    kode_mk = kode_mk.strip() if kode_mk else ""
                    nama_mk = row.locator("td").nth(6).text_content()
                    nama_mk = nama_mk.strip() if nama_mk else ""
                    dosen = row.locator("td").nth(1).text_content()
                    dosen = dosen.replace('\n', ', ').strip() if dosen else ""
                    kelas = row.locator("td").nth(2).text_content()
                    kelas = kelas.strip() if kelas else ""
                    tahun_ajaran = row.locator("td").nth(3).text_content()
                    tahun_ajaran = tahun_ajaran.strip() if tahun_ajaran else ""
                    
                    course_info = {
                        "kode": kode_mk,
                        "nama": nama_mk,
                        "dosen": dosen,
                        "kelas": kelas,
                        "tahun_ajaran": tahun_ajaran
                    }
                    course_info_list.append(course_info)
                    print(f"  Course {i+1}: {kode_mk} - {nama_mk}")
                except Exception as e:
                    print(f"Error extracting course info for row {i}: {e}")
                    course_info_list.append({})

            # Save courses list
            courses_json_path = os.path.join(base_data_dir, "courses_list.json")
            with open(courses_json_path, 'w', encoding='utf-8') as f:
                json.dump(course_info_list, f, ensure_ascii=False, indent=4)
            print(f"Saved courses list to: {courses_json_path}")

            # Process each course
            for i in range(num_courses):
                current_course_link = page.locator(f"#MainContent_gridData_linkDetail_{i}")
                course_info = course_info_list[i]
                course_name_full = f"{course_info.get('kode', '')}-{course_info.get('nama', '')}" if course_info else f"Course_Index_{i}"

                course_name_sanitized = sanitize_filename(course_name_full)
                print(f"\nProcessing Course {i+1}/{num_courses}: {course_name_full}")

                course_data = {
                    "course_info": course_info,
                    "pertemuan": {}
                }

                def ensure_on_course_detail_page(page, course_index):
                    # Check if on course detail page by thead
                    thead_text = ""
                    try:
                        thead = page.locator("table thead tr").first
                        thead_text = (thead.text_content() or "").replace("\n", " ").strip().upper()
                    except Exception:
                        pass
                    if "PERTEMUAN" in thead_text and "AKTIVITAS PEMBELAJARAN" in thead_text:
                        return True
                    # If on courses list page, re-navigate to course detail
                    if "NO" in thead_text and "KODE" in thead_text and "MATA KULIAH" in thead_text:
                        print("  Not on course detail page, re-navigating to course...")
                        course_link = page.locator(f"#MainContent_gridData_linkDetail_{course_index}")
                        with page.expect_navigation(wait_until="networkidle", timeout=45000):
                            course_link.click()
                        return True
                    # If on any other page, reload courses list and re-navigate
                    print("  Not on expected page, reloading courses list and re-navigating...")
                    page.goto(COURSES_LIST_PAGE_URL, timeout=60000, wait_until="networkidle")
                    course_link = page.locator(f"#MainContent_gridData_linkDetail_{course_index}")
                    with page.expect_navigation(wait_until="networkidle", timeout=45000):
                        course_link.click()
                    return True

                print(f"  Opening course details...")
                with page.expect_navigation(wait_until="networkidle", timeout=45000):
                    current_course_link.click()
                print(f"  On course activities page. URL: {page.url}")

                # Ensure on course detail page before scraping pertemuan
                ensure_on_course_detail_page(page, i)

                print("  Scraping pertemuan data...")
                pertemuan_rows_locator = page.locator("#MainContent_gridDetail tbody tr")
                num_pertemuan = pertemuan_rows_locator.count()
                print(f"  Found {num_pertemuan} pertemuan")

                for j in range(num_pertemuan):
                    try:
                        # Always ensure on course detail page before each pertemuan
                        ensure_on_course_detail_page(page, i)
                        row = pertemuan_rows_locator.nth(j)
                        pertemuan_key = f"Pertemuan_{j+1}"
                        try:
                            pertemuan_info_cell = row.locator("td").nth(0)
                            if pertemuan_info_cell.is_visible():
                                pertemuan_info_text = pertemuan_info_cell.text_content()
                                pertemuan_info_text = pertemuan_info_text.strip() if pertemuan_info_text else ""
                                lines = [line.strip() for line in pertemuan_info_text.split('\n') if line.strip()]
                                if lines:
                                    pertemuan_key = lines[0].split('(')[0].strip()
                                    # Search all lines for a date pattern (e.g., 'Jumat, 25 April 2025')
                                    pertemuan_date_raw = None
                                    pertemuan_date_iso = None
                                    for line in lines:
                                        date_match = re.search(r'\d{1,2} [A-Za-z]+ \d{4}', line)
                                        if date_match:
                                            pertemuan_date_raw = line
                                            try:
                                                date_obj = parse_indonesian_date(date_match.group(0))
                                                if date_obj:
                                                    pertemuan_date_iso = date_obj.isoformat()
                                            except Exception as e:
                                                print(f"    Error parsing pertemuan date: {e}")
                                            break
                        except Exception as e:
                            print(f"    Error getting pertemuan info: {e}")

                        sanitized_pertemuan_key = sanitize_filename(pertemuan_key)
                        print(f"    Processing: {sanitized_pertemuan_key}")

                        pertemuan_data = {"files": [], "tugas": []}
                        # Add date info to pertemuan_data
                        pertemuan_data["date_raw"] = [pertemuan_date_raw] if 'pertemuan_date_raw' in locals() and pertemuan_date_raw is not None else []
                        pertemuan_data["date_iso"] = [pertemuan_date_iso] if 'pertemuan_date_iso' in locals() and pertemuan_date_iso is not None else []

                        # Scrape files and tugas with robust error handling
                        pertemuan_links = row.locator("td:nth-child(2) a")
                        files_scraped = set()
                        pengumpulan_links = []
                        for k in range(pertemuan_links.count()):
                            link = pertemuan_links.nth(k)
                            text = (link.text_content() or "").upper()
                            # Scrape [TUGAS] and [BAHAN AJAR] links as file metadata (do not click)
                            if "[TUGAS]" in text or "[BAHAN AJAR]" in text:
                                try:
                                    href = link.get_attribute('href')
                                    download_filename = link.get_attribute('download') or "unknown_filename"
                                    title = link.text_content()
                                    title = title.strip() if title else ""
                                    full_url = f"{SIA_BASE_URL}{href}" if href and not href.startswith("http") else href
                                    file_key = (download_filename, title, full_url)
                                    if file_key not in files_scraped:
                                        pertemuan_data["files"].append({
                                            "filename_suggested": download_filename,
                                            "title": title,
                                            "url": full_url
                                        })
                                        files_scraped.add(file_key)
                                except Exception as e:
                                    print(f"      Error scraping file link: {e}")
                            # Only click Pengumpulan Tugas links
                            elif "PENGUMPULAN TUGAS" in text:
                                pengumpulan_links.append(link)
                        # Try all pengumpulan tugas links robustly
                        if pengumpulan_links:
                            print(f"      Found {len(pengumpulan_links)} 'Pengumpulan Tugas' links. Scraping tugas...")
                            for idx, tugas_link in enumerate(pengumpulan_links):
                                pengumpulan_title = (tugas_link.text_content() or "").strip()
                                
                                # Generate unique key for tugas state
                                tugas_key = f"{course_name_sanitized}_{sanitized_pertemuan_key}_{sanitize_filename(pengumpulan_title)}"
                                
                                # Check if tugas is known to be inactive
                                if tugas_key in tugas_state and not tugas_state[tugas_key]:
                                    print(f"        Skipping tugas (inactive from previous run): {pengumpulan_title}")
                                    continue
                                    
                                for attempt in range(3):
                                    try:
                                        pages_before = set([p for p in tugas_link.page.context.pages])
                                        tugas_link.click()
                                        page.wait_for_timeout(2000 + attempt * 1000)
                                        pages_after = set([p for p in tugas_link.page.context.pages])
                                        new_tabs = list(pages_after - pages_before)
                                        if new_tabs:
                                            print("        New tab opened by click. Closing it.")
                                            for tab in new_tabs:
                                                try:
                                                    tab.close()
                                                except Exception:
                                                    pass
                                            continue
                                        thead_text = ""
                                        try:
                                            thead = page.locator("table thead tr").first
                                            thead_text = (thead.text_content() or "").replace("\n", " ").strip().upper()
                                        except Exception:
                                            pass
                                        if not page.url.startswith(COURSES_LIST_PAGE_URL):
                                            print("        Redirected away from course page. Reloading and retrying...")
                                            page.goto(COURSES_LIST_PAGE_URL, timeout=60000, wait_until="networkidle")
                                            ensure_on_course_detail_page(page, i)
                                            pertemuan_rows_locator = page.locator("#MainContent_gridDetail tbody tr")
                                            row = pertemuan_rows_locator.nth(j)
                                            pertemuan_links = row.locator("td:nth-child(2) a")
                                            tugas_link = pertemuan_links.nth(idx)
                                            continue
                                        if "NIM" in thead_text and "NAMA" in thead_text and "WAKTU UNGGAH" in thead_text:
                                            print(f"        On pengumpulan tugas (upload) page. Scraping details... (attempt {attempt+1})")
                                            tugas_cards = page.locator(".card")
                                            for card_idx in range(tugas_cards.count()):
                                                card = tugas_cards.nth(card_idx)
                                                try:
                                                    header = card.locator(".card-header").text_content() or ""
                                                    header = header.strip()
                                                    deadline_text = ""
                                                    deadline_span = card.locator("span[style*='color: red']")
                                                    if deadline_span.count() > 0:
                                                        deadline_text = deadline_span.first.text_content() or ""
                                                        deadline_text = deadline_text.strip()
                                                    is_active = False
                                                    if deadline_text:
                                                        deadline_date = parse_indonesian_date(deadline_text)
                                                        if deadline_date and deadline_date > datetime.now():
                                                            is_active = True
                                                    # Update tugas state
                                                    tugas_state[tugas_key] = is_active
                                                    
                                                    pertemuan_data["tugas"].append({
                                                        "pengumpulan_title": pengumpulan_title,
                                                        "title": header,
                                                        "deadline": deadline_text,
                                                        "active": is_active
                                                    })
                                                except Exception as e:
                                                    print(f"          Error scraping tugas card: {e}")
                                            kembali_btn = page.locator("#MainContent_btnCancelTugas")
                                            if kembali_btn.is_visible(timeout=5000):
                                                print("        Returning to pertemuan list by pressing 'Kembali'...")
                                                with page.expect_navigation(wait_until="networkidle", timeout=30000):
                                                    kembali_btn.click()
                                            else:
                                                print("        'Kembali' button not found. Navigating back.")
                                                page.go_back()
                                            break
                                        else:
                                            print(f"        Tugas page/modal not detected after click (attempt {attempt+1}). Retrying...")
                                    except Exception as e:
                                        print(f"        Error clicking tugas link: {e}. Retrying...")
                        
                        # Save pertemuan data
                        course_data["pertemuan"][sanitized_pertemuan_key] = pertemuan_data

                    except Exception as e:
                        print(f"Error at course {i}, pertemuan {j}: {e}")
                        traceback.print_exc()
                        # Continue to next pertemuan instead of crashing
                        continue

                # Save course data
                json_filename = f"{course_name_sanitized}.json"
                json_filepath = os.path.join(base_data_dir, json_filename)
                print(f"  Saving course data to {json_filepath}")
                try:
                    with open(json_filepath, 'w', encoding='utf-8') as f:
                        json.dump(course_data, f, ensure_ascii=False, indent=4)
                except Exception as e:
                    print(f"  ERROR saving JSON: {e}")

                # Save tugas state after each course
                save_tugas_state(tugas_state)
                print(f"  Saved tugas state with {len(tugas_state)} entries")

                # Navigate back
                back_button = page.locator("#MainContent_btnCancelDetail")
                if back_button.is_visible(timeout=5000):
                    print("  Returning to courses list...")
                    with page.expect_navigation(wait_until="networkidle", timeout=30000):
                        back_button.click()
                else:
                    print("  'Kembali' button not found. Re-navigating.")
                    page.goto(COURSES_LIST_PAGE_URL, timeout=60000, wait_until="networkidle")

            print("\nFinished processing all courses!")

        except Exception as e:
            print(f"\nCritical error in scraper: {str(e)}")
            traceback.print_exc()
            try:
                page.screenshot(path="critical_error_page.png")
            except Exception as se:
                print(f"Could not take screenshot: {se}")
            # Re-raise to trigger restart
            raise

        finally:
            # Clean up downloaded files
            for file_path in downloaded_files:
                if os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                        print(f"Deleted downloaded file: {file_path}")
                    except Exception as e:
                        print(f"Error deleting downloaded file: {e}")
            
            if os.path.exists("captcha.png"):
                try:
                    os.remove("captcha.png")
                except OSError as e:
                    print(f"Error removing captcha.png: {e}")
            print("\nClosing browser...")
            try:
                context.close()
                browser.close()
            except:
                pass
            print("Browser closed. Process completed.")

if __name__ == "__main__":
    if not USERNAME or not PASSWORD:
        print("ERROR: USERNAME or PASSWORD not set in environment.")
        print("Create a .env file with these variables.")
        exit(1)
    if not GEMINI_API_KEY:
        print("WARNING: GEMINI_API_KEY not set. CAPTCHA solving will be skipped.")

    restarts = 0
    while restarts <= MAX_RESTARTS:
        try:
            print(f"\n{'='*50}")
            print(f"Starting scraper run (attempt {restarts+1}/{MAX_RESTARTS+1})")
            print(f"{'='*50}")
            run_scraper()
            print("Scraper completed successfully!")
            break
        except Exception as e:
            restarts += 1
            if restarts <= MAX_RESTARTS:
                print(f"\n{'='*50}")
                print(f"Scraper encountered error, restarting...")
                print(f"{'='*50}")
                time.sleep(3)  # Brief pause before restart
            else:
                print(f"\n{'='*50}")
                print("MAX RESTARTS REACHED. SCRAPER FAILED PERMANENTLY.")
                print(f"{'='*50}")
                # Log error to file
                with open("scraper_crash.log", "a", encoding="utf-8") as log_file:
                    log_file.write(f"{'='*50}\n")
                    log_file.write(f"Scraper crash at {datetime.now()}:\n")
                    log_file.write(f"Attempts: {restarts}\n")
                    log_file.write(f"Error: {str(e)}\n")
                    log_file.write("Traceback:\n")
                    traceback.print_exc(file=log_file)
                    log_file.write(f"{'='*50}\n\n")
                print("Error details saved to scraper_crash.log")
                exit(1)