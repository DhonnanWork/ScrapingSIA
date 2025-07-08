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
        page.wait_for_timeout(500)
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
            day, id_month, year = date_match.groups()
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
    tugas_state = load_tugas_state()
    print(f"Loaded tugas state with {len(tugas_state)} entries")
    
    with sync_playwright() as p:
        base_data_dir = os.path.join(os.getcwd(), "scraped_data")
        if not os.path.exists(base_data_dir):
            os.makedirs(base_data_dir)
        print(f"Created data directory: {base_data_dir}")

        browser = p.firefox.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0",
        )
        page = context.new_page()

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
                        # CORRECTED: is_visible() has no timeout
                        if page.url.startswith(LOGIN_URL) and page.locator("#txtCaptcha").is_visible():
                            try:
                                refresh_button = page.locator("#MainContent_btnRefreshCaptcha")
                                # CORRECTED: is_visible() has no timeout
                                if refresh_button.is_visible():
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
                    if any(s in page.url.lower() for s in ["default.aspx", "page_kuesioner_kuesioner.aspx"]):
                        login_success = True
                        print(f"Login success. URL: {page.url}")
                        break
                    else:
                        error_message_locator = page.locator("#MainContent_lblMessage[style*='color:Red']")
                        # CORRECTED: is_visible() has no timeout
                        if error_message_locator.is_visible():
                            error_text = error_message_locator.text_content(timeout=1000)
                            print(f"Login error: {error_text.strip().lower() if error_text else ''}")
                        # CORRECTED: is_visible() has no timeout
                        elif page.locator("#txtCaptcha").is_visible():
                             print("CAPTCHA verification failed.")
                        else:
                            print(f"Login status unclear. URL: {page.url}")

                except PlaywrightTimeoutError:
                    print("Timeout waiting for URL change.")
                    error_message_locator = page.locator("#MainContent_lblMessage[style*='color:Red']")
                    # CORRECTED: is_visible() has no timeout
                    if error_message_locator.is_visible():
                        error_text = error_message_locator.text_content(timeout=1000)
                        print(f"Login error: {error_text.strip().lower() if error_text else ''}")
                    # CORRECTED: is_visible() has no timeout
                    elif page.locator("#txtCaptcha").is_visible():
                         print("CAPTCHA verification failed.")
                    else:
                        print(f"Login status unclear after timeout. URL: {page.url}")
                        if any(s in page.url.lower() for s in ["default.aspx", "page_kuesioner_kuesioner.aspx"]):
                            login_success = True
                            break

                if attempt < MAX_CAPTCHA_ATTEMPTS - 1 and not login_success:
                    print("Retrying login...")
                    # CORRECTED: is_visible() has no timeout
                    if page.url.startswith(LOGIN_URL) and page.locator("#txtCaptcha").is_visible():
                        try:
                            refresh_button = page.locator("#MainContent_btnRefreshCaptcha")
                            if refresh_button.is_visible():
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
                page.screenshot(path="login_failure_final_page.png")
                print(f"Login failed. URL: {page.url}")
                browser.close()
                return

            print("\nLogin successful!")
            
            # --- NEW, MORE ROBUST NAVIGATION ---
            print(f"Directly navigating to courses list page: {COURSES_LIST_PAGE_URL}")
            page.goto(COURSES_LIST_PAGE_URL, timeout=60000, wait_until="networkidle")
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
                    kode_mk = (row.locator("td").nth(5).text_content() or "").strip()
                    nama_mk = (row.locator("td").nth(6).text_content() or "").strip()
                    dosen = (row.locator("td").nth(1).text_content() or "").replace('\n', ', ').strip()
                    kelas = (row.locator("td").nth(2).text_content() or "").strip()
                    tahun_ajaran = (row.locator("td").nth(3).text_content() or "").strip()
                    
                    course_info_list.append({
                        "kode": kode_mk, "nama": nama_mk, "dosen": dosen,
                        "kelas": kelas, "tahun_ajaran": tahun_ajaran
                    })
                    print(f"  Course {i+1}: {kode_mk} - {nama_mk}")
                except Exception as e:
                    print(f"Error extracting course info for row {i}: {e}")
                    course_info_list.append({})

            courses_json_path = os.path.join(base_data_dir, "courses_list.json")
            with open(courses_json_path, 'w', encoding='utf-8') as f:
                json.dump(course_info_list, f, ensure_ascii=False, indent=4)
            print(f"Saved courses list to: {courses_json_path}")

            # Process each course
            for i in range(num_courses):
                course_info = course_info_list[i]
                course_name_full = f"{course_info.get('kode', '')}-{course_info.get('nama', '')}" if course_info else f"Course_Index_{i}"
                course_name_sanitized = sanitize_filename(course_name_full)
                print(f"\nProcessing Course {i+1}/{num_courses}: {course_name_full}")

                course_data = {"course_info": course_info, "pertemuan": {}}

                print(f"  Opening course details...")
                page.locator(f"#MainContent_gridData_linkDetail_{i}").click()
                page.wait_for_load_state("networkidle", timeout=45000)
                print(f"  On course activities page. URL: {page.url}")
                
                print("  Scraping pertemuan data...")
                pertemuan_rows_locator = page.locator("#MainContent_gridDetail tbody tr")
                num_pertemuan = pertemuan_rows_locator.count()
                print(f"  Found {num_pertemuan} pertemuan")

                for j in range(num_pertemuan):
                    try:
                        row = page.locator("#MainContent_gridDetail tbody tr").nth(j)
                        pertemuan_key = f"Pertemuan_{j+1}"
                        pertemuan_date_raw = None
                        pertemuan_date_iso = None

                        try:
                            pertemuan_info_cell = row.locator("td").nth(0)
                            # CORRECTED: is_visible() has no timeout
                            if pertemuan_info_cell.is_visible():
                                pertemuan_info_text = (pertemuan_info_cell.text_content() or "").strip()
                                lines = [line.strip() for line in pertemuan_info_text.split('\n') if line.strip()]
                                if lines:
                                    pertemuan_key = lines[0].split('(')[0].strip()
                                    for line in lines:
                                        date_match = re.search(r'\d{1,2} [A-Za-z]+ \d{4}', line)
                                        if date_match:
                                            pertemuan_date_raw = line
                                            date_obj = parse_indonesian_date(date_match.group(0))
                                            if date_obj:
                                                pertemuan_date_iso = date_obj.isoformat()
                                            break
                        except Exception as e:
                            print(f"    Error getting pertemuan info: {e}")

                        sanitized_pertemuan_key = sanitize_filename(pertemuan_key)
                        print(f"    Processing: {sanitized_pertemuan_key}")

                        pertemuan_data = {
                            "files": [], "tugas": [],
                            "date_raw": [pertemuan_date_raw] if pertemuan_date_raw else [],
                            "date_iso": [pertemuan_date_iso] if pertemuan_date_iso else []
                        }

                        pertemuan_links = row.locator("td:nth-child(2) a")
                        files_scraped = set()
                        pengumpulan_links_info = []
                        for k in range(pertemuan_links.count()):
                            link = pertemuan_links.nth(k)
                            text = (link.text_content() or "").upper()
                            if "[TUGAS]" in text or "[BAHAN AJAR]" in text:
                                try:
                                    href = link.get_attribute('href')
                                    download_filename = link.get_attribute('download') or "unknown_filename"
                                    title = (link.text_content() or "").strip()
                                    full_url = f"{SIA_BASE_URL}{href}" if href and not href.startswith("http") else href
                                    file_key = (download_filename, title, full_url)
                                    if file_key not in files_scraped:
                                        pertemuan_data["files"].append({
                                            "filename_suggested": download_filename,
                                            "title": title, "url": full_url
                                        })
                                        files_scraped.add(file_key)
                                except Exception as e:
                                    print(f"      Error scraping file link: {e}")
                            elif "PENGUMPULAN TUGAS" in text:
                                pengumpulan_links_info.append({"index": k, "link": link})
                        
                        if pengumpulan_links_info:
                            print(f"      Found {len(pengumpulan_links_info)} 'Pengumpulan Tugas' links. Scraping tugas...")
                            for link_info in pengumpulan_links_info:
                                # Re-locate link before clicking to avoid stale element error
                                current_row = page.locator("#MainContent_gridDetail tbody tr").nth(j)
                                tugas_link = current_row.locator("td:nth-child(2) a").nth(link_info["index"])
                                pengumpulan_title = (tugas_link.text_content() or "").strip()
                                
                                tugas_link.click()
                                page.wait_for_load_state("networkidle", timeout=30000)

                                tugas_cards = page.locator(".card")
                                for card_idx in range(tugas_cards.count()):
                                    card = tugas_cards.nth(card_idx)
                                    header = (card.locator(".card-header").text_content() or "").strip()
                                    deadline_text = ""
                                    deadline_span = card.locator("span[style*='color: red']")
                                    if deadline_span.count() > 0:
                                        deadline_text = (deadline_span.first.text_content() or "").strip()
                                    is_active = False
                                    if deadline_text:
                                        deadline_date = parse_indonesian_date(deadline_text)
                                        if deadline_date and deadline_date > datetime.now():
                                            is_active = True
                                    
                                    pertemuan_data["tugas"].append({
                                        "pengumpulan_title": pengumpulan_title, "title": header,
                                        "deadline": deadline_text, "active": is_active
                                    })
                                
                                kembali_btn = page.locator("#MainContent_btnCancelTugas")
                                # CORRECTED: is_visible() has no timeout
                                if kembali_btn.is_visible():
                                    print("        Returning to pertemuan list by pressing 'Kembali'...")
                                    kembali_btn.click()
                                    page.wait_for_load_state("networkidle", timeout=30000)
                                else:
                                    print("        'Kembali' button not found. Navigating back.")
                                    page.go_back(wait_until="networkidle")
                        
                        course_data["pertemuan"][sanitized_pertemuan_key] = pertemuan_data

                    except Exception as e:
                        print(f"Error at course {i}, pertemuan {j}: {e}")
                        traceback.print_exc()
                        page.goto(COURSES_LIST_PAGE_URL, timeout=60000, wait_until="networkidle")
                        page.locator(f"#MainContent_gridData_linkDetail_{i}").click()
                        page.wait_for_load_state("networkidle", timeout=45000)
                        continue

                json_filename = f"{course_name_sanitized}.json"
                json_filepath = os.path.join(base_data_dir, json_filename)
                print(f"  Saving course data to {json_filepath}")
                with open(json_filepath, 'w', encoding='utf-8') as f:
                    json.dump(course_data, f, ensure_ascii=False, indent=4)
                
                save_tugas_state(tugas_state)
                
                print("  Returning to courses list...")
                page.goto(COURSES_LIST_PAGE_URL, timeout=60000, wait_until="networkidle")

            print("\nFinished processing all courses!")

        except Exception as e:
            print(f"\nCritical error in scraper: {str(e)}")
            traceback.print_exc()
            try:
                page.screenshot(path="critical_error_page.png")
            except Exception as se:
                print(f"Could not take screenshot: {se}")
            raise

        finally:
            if os.path.exists("captcha.png"):
                try: os.remove("captcha.png")
                except OSError as e: print(f"Error removing captcha.png: {e}")
            print("\nClosing browser...")
            try:
                context.close()
                browser.close()
            except: pass
            print("Browser closed. Process completed.")

if __name__ == "__main__":
    if not USERNAME or not PASSWORD:
        print("ERROR: USERNAME or PASSWORD not set in environment.")
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
                time.sleep(3)
            else:
                print(f"\n{'='*50}")
                print("MAX RESTARTS REACHED. SCRAPER FAILED PERMANENTLY.")
                print(f"{'='*50}")
                with open("scraper_crash.log", "a", encoding="utf-8") as log_file:
                    log_file.write(f"{'='*50}\n")
                    log_file.write(f"Scraper crash at {datetime.now()}:\n")
                    log_file.write(f"Attempts: {restarts}\n")
                    log_file.write(f"Error: {str(e)}\n")
                    traceback.print_exc(file=log_file)
                    log_file.write(f"\n{'='*50}\n\n")
                print("Error details saved to scraper_crash.log")
                exit(1)