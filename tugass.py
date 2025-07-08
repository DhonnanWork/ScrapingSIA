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

# --- COPIED FROM SCRAPER: NECESSARY FOR LOGIN ---
load_dotenv()

MAX_CAPTCHA_ATTEMPTS = 7
USERNAME = os.getenv("NIM")
PASSWORD = os.getenv("PASSWORD")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

LOGIN_URL = "https://sia.polytechnic.astra.ac.id/sso/Page_Login.aspx"
COURSES_LIST_PAGE_URL = "https://sia.polytechnic.astra.ac.id/Page_Pelaksanaan_Aktivitas_Pembelajaran.aspx"
SSO_BASE_URL = "https://sia.polytechnic.astra.ac.id/sso/"
SIA_BASE_URL = "https://sia.polytechnic.astra.ac.id/"

# Initialize Gemini
if GEMINI_API_KEY and GEMINI_API_KEY not in ["YOUR_GEMINI_API_KEY_HERE", ""]:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel('gemini-1.5-flash')
    except Exception as e:
        model = None
        print(f"Warning: Error initializing Gemini: {e}. CAPTCHA solving may fail.")
else:
    model = None
    print("Warning: Gemini API key not configured. CAPTCHA solving will be manual.")

def solve_captcha_with_gemini(page):
    if not model:
        print("Gemini model not initialized. Skipping CAPTCHA solving.")
        return "MANUAL_INPUT_REQUIRED"
    captcha_img_locator = page.locator("#MainContent_imgCaptcha")
    try:
        captcha_img_locator.wait_for(state="visible", timeout=10000)
        time.sleep(0.5)
        captcha_img_locator.screenshot(path="captcha_nav.png")
        with open("captcha_nav.png", "rb") as img_file:
            base64_image = base64.b64encode(img_file.read()).decode('utf-8')
        prompt = "Extract ONLY numeric digits from this CAPTCHA. Return JUST THE NUMBERS as a continuous string. If no numbers are clear, state 'unclear'."
        response = model.generate_content([prompt, {"mime_type": "image/png", "data": base64_image}])
        solution = response.text.strip()
        if solution.lower() == 'unclear' or not solution.isdigit():
            return None
        return solution
    except Exception as e:
        print(f"Error during CAPTCHA solving: {e}")
        return None
    finally:
        if os.path.exists("captcha_nav.png"):
            os.remove("captcha_nav.png")

def handle_captcha(page, attempt):
    print(f"CAPTCHA Attempt {attempt + 1}/{MAX_CAPTCHA_ATTEMPTS}")
    captcha_solution = solve_captcha_with_gemini(page)
    if captcha_solution == "MANUAL_INPUT_REQUIRED":
        captcha_solution = input("Gemini not configured. Please enter CAPTCHA manually: ")
    elif captcha_solution is None:
        print("Failed to get CAPTCHA solution from Gemini.")
        return False
    print(f"Using CAPTCHA Solution: {captcha_solution}")
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

def login_to_sia(page):
    """Handles the entire login process and returns True on success."""
    print(f"Navigating to login page: {LOGIN_URL}")
    page.goto(LOGIN_URL, timeout=60000)
    page.fill("#txtUsername", USERNAME)

    for attempt in range(MAX_CAPTCHA_ATTEMPTS):
        page.fill("#txtPassword", PASSWORD)
        if not handle_captcha(page, attempt):
            if attempt < MAX_CAPTCHA_ATTEMPTS - 1:
                print("Retrying CAPTCHA...")
                time.sleep(2)
                try:
                    page.locator("#MainContent_btnRefreshCaptcha").click()
                    time.sleep(1)
                except Exception:
                    print("Could not refresh CAPTCHA, continuing.")
                continue
            else:
                break

        try:
            page.wait_for_url(lambda url: "default.aspx" in url.lower(), timeout=15000)
            print("Login success detected by URL change.")
            return True
        except PlaywrightTimeoutError:
            error_message = page.locator("#MainContent_lblMessage[style*='color:Red']")
            try:
                error_message.wait_for(state="visible", timeout=500)
                is_visible = True
            except PlaywrightTimeoutError:
                is_visible = False
            if is_visible:
                print(f"Login error: {error_message.text_content().strip()}")
            else:
                print("Login failed. Incorrect CAPTCHA or other issue.")
            if attempt < MAX_CAPTCHA_ATTEMPTS - 1:
                print("Retrying login...")
            else:
                print("Max login attempts reached.")
                return False
    return False

# --- NEW FUNCTIONS FOR THE NAVIGATOR ---

def find_active_assignments():
    """Reads scraped data and returns a list of active assignments."""
    base_data_dir = "scraped_data"
    courses_list_path = os.path.join(base_data_dir, "courses_list.json")
    
    if not os.path.exists(courses_list_path):
        print(f"ERROR: '{courses_list_path}' not found.")
        print("Please run the main scraper script first to generate data.")
        return []

    with open(courses_list_path, 'r', encoding='utf-8') as f:
        courses_list = json.load(f)

    active_assignments = []
    print("Searching for active assignments in scraped data...")

    for course_index, course_info in enumerate(courses_list):
        course_name_full = f"{course_info.get('kode', '')}-{course_info.get('nama', '')}"
        sanitized_course_name = sanitize_filename(course_name_full)
        course_json_path = os.path.join(base_data_dir, f"{sanitized_course_name}.json")

        if not os.path.exists(course_json_path):
            continue

        with open(course_json_path, 'r', encoding='utf-8') as f:
            course_data = json.load(f)

        pertemuan_dict = course_data.get("pertemuan", {})
        for pertemuan_index, (pertemuan_key, pertemuan_details) in enumerate(pertemuan_dict.items()):
            for tugas in pertemuan_details.get("tugas", []):
                if tugas.get("active") and "link_index" in tugas:
                    context = {
                        "course_index": course_index,
                        "pertemuan_index": pertemuan_index,
                        "tugas_link_index": tugas["link_index"],
                        "course_name": course_info.get('nama'),
                        "pertemuan_key": pertemuan_key,
                        "tugas_title": tugas.get("title")
                    }
                    active_assignments.append(context)
    
    return active_assignments

def navigate_to_assignment(context):
    """Launches Playwright and navigates to the selected assignment."""
    with sync_playwright() as p:
        browser = p.firefox.launch(headless=False) # Headless must be False to see the page
        page = browser.new_page()

        try:
            # Step 1: Login
            if not login_to_sia(page):
                print("Could not log in. Aborting navigation.")
                browser.close()
                return

            print("Login successful. Navigating to student dashboard...")
            # Step 2: Navigate from SSO to SIA Mahasiswa Dashboard
            page.locator("a:has-text('Sistem Informasi Akademik')").click()
            with page.expect_navigation(wait_until="networkidle"):
                page.locator("a:has-text('Login sebagai MAHASISWA')").click()
            print(f"On student dashboard. URL: {page.url}")

            # Step 3: Go to the main courses list page
            print(f"Navigating to course list: {COURSES_LIST_PAGE_URL}")
            page.goto(COURSES_LIST_PAGE_URL, wait_until="networkidle", timeout=60000)
            
            # Step 4: Click on the correct course
            course_index = context['course_index']
            print(f"Clicking on course #{course_index + 1}: {context['course_name']}")
            course_link_selector = f"#MainContent_gridData_linkDetail_{course_index}"
            page.locator(course_link_selector).wait_for(state="visible", timeout=15000)
            with page.expect_navigation(wait_until="networkidle"):
                page.locator(course_link_selector).click()
            
            print("On course detail page. Finding assignment link...")
            
            # Step 5: Find the specific "Pengumpulan Tugas" link and click it
            pertemuan_index = context['pertemuan_index']
            tugas_link_index = context['tugas_link_index']

            # Locate the correct pertemuan row first
            pertemuan_row = page.locator("#MainContent_gridDetail tbody tr").nth(pertemuan_index)
            
            # Find all "Pengumpulan Tugas" links within that row's cell
            pengumpulan_links_in_cell = pertemuan_row.locator("td:nth-child(2) a:has-text('Pengumpulan Tugas')")
            
            # Click the specific link based on the saved index
            target_link = pengumpulan_links_in_cell.nth(tugas_link_index)
            
            print(f"Clicking assignment: '{target_link.text_content().strip()}'")
            with page.expect_navigation(wait_until="networkidle"):
                target_link.click()

            print("\n✅ Navigation complete! The browser is now on the assignment page.")
            print("   Press Enter in this console to close the browser.")
            input() # Pause script until user presses Enter

        except Exception as e:
            print(f"\nAn error occurred during navigation: {e}")
            traceback.print_exc()
            page.screenshot(path="navigator_error.png")
            print("A screenshot 'navigator_error.png' has been saved.")
            print("Press Enter to close the browser.")
            input()
        finally:
            print("Closing browser...")
            browser.close()


def main():
    """Main function to find, list, and navigate to active assignments."""
    if not all([USERNAME, PASSWORD]):
        print("ERROR: NIM (USERNAME) or PASSWORD not set in your .env file.")
        return

    assignments = find_active_assignments()

    if not assignments:
        print("No active assignments found in the scraped data.")
        return

    print("\n--- Active Assignments Found ---")
    for i, context in enumerate(assignments):
        print(f"{i + 1}. {context['course_name']} - {context['pertemuan_key']}")
        print(f"   └─ Tugas: {context['tugas_title']}")
    print("---------------------------------")

    while True:
        try:
            choice = input("Enter the number of the assignment to open (or 'q' to quit): ")
            if choice.lower() == 'q':
                return
            choice_num = int(choice)
            if 1 <= choice_num <= len(assignments):
                selected_context = assignments[choice_num - 1]
                break
            else:
                print(f"Invalid number. Please enter a number between 1 and {len(assignments)}.")
        except ValueError:
            print("Invalid input. Please enter a number.")

    print(f"\nPreparing to navigate to: {selected_context['tugas_title']}")
    navigate_to_assignment(selected_context)


if __name__ == "__main__":
    main()