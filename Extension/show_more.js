// --- GIST DATA FETCHING LOGIC ---

async function loadAllCourseData() {
  // IMPORTANT: This is the "Raw" URL of your Gist.
  const GIST_RAW_URL = 'https://gist.githubusercontent.com/DhonnanWork/16c307074f0e47ece82b500262347d75/raw/93abe45e25be6d45664e3e1d153cab693189ff05/courses_data.json';

  try {
    console.log(`Fetching course data from Gist...`);
    // { cache: 'no-store' } tells the browser to always fetch the latest version of the file,
    // bypassing its local cache. This ensures users see up-to-date information.
    const response = await fetch(GIST_RAW_URL, { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`Failed to fetch data from Gist. Status: ${response.status}`);
    }

    const courses = await response.json();
    console.log(`Successfully loaded data from Gist.`);
    return courses;

  } catch (error) {
    console.error('❌ Error fetching data from Gist:', error);
    // Provide a user-friendly error message for the extension UI.
    throw new Error('Failed to get data. Please check your internet connection.');
  }
}

function isInLastMonth(isoDate) {
  if (!isoDate) return false;
  const now = new Date();
  const d = new Date(isoDate);
  const oneMonthAgo = new Date(now);
  oneMonthAgo.setMonth(now.getMonth() - 1);
  return d >= oneMonthAgo && d <= now;
}

function parseDeadline(deadlineStr) {
  // Example: [Batas Waktu Pengumpulan Tugas : Jumat, 4 Juli 2025 | 23:55 WIB]
  const match = deadlineStr && deadlineStr.match(/(\d{1,2}) ([A-Za-z]+) (\d{4}) \| (\d{2}):(\d{2})/);
  if (match) {
    const [_, day, month, year, hour, minute] = match;
    const monthMap = {
      'Januari': 0, 'Februari': 1, 'Maret': 2, 'April': 3, 'Mei': 4, 'Juni': 5,
      'Juli': 6, 'Agustus': 7, 'September': 8, 'Oktober': 9, 'November': 10, 'Desember': 11
    };
    const m = monthMap[month];
    if (m !== undefined) {
      return new Date(Number(year), m, Number(day), Number(hour), Number(minute));
    }
  }
  return null;
}

function isDeadlineActive(deadlineStr) {
  const deadline = parseDeadline(deadlineStr);
  if (!deadline) return false;
  return deadline > new Date();
}

function makeBlueLink(text, url) {
  const a = document.createElement('a');
  a.textContent = text;
  a.href = url;
  a.target = '_blank';
  a.className = 'blue-link';
  return a;
}

function storeNavigationTargetAndOpenLogin(courseInfo, pertemuanKey, pengumpulanTitle) {
  // Get credentials from localStorage (set by user in Show More page)
  const nim = localStorage.getItem('sia_nim') || '';
  const password = localStorage.getItem('sia_password') || '';
  const gemini = localStorage.getItem('sia_gemini') || '';
  const navTarget = {
    kode: courseInfo.kode,
    pertemuan: pertemuanKey,
    pengumpulan: pengumpulanTitle,
    nim,
    password,
    gemini
  };
  localStorage.setItem('sia_nav_target', JSON.stringify(navTarget));
  window.open('https://sia.polytechnic.astra.ac.id/Page_Pelaksanaan_Aktivitas_Pembelajaran.aspx', '_blank');
}

function makePengumpulanLink(pengumpulanTitle, courseInfo, pertemuanKey) {
  const a = document.createElement('a');
  a.textContent = `${pengumpulanTitle} - ${safeCourseName(courseInfo)}`;
  a.href = 'https://sia.polytechnic.astra.ac.id/sso/Page_Login.aspx';
  a.target = '_blank';
  a.className = 'blue-link';
  return a;
}

function renderCourseDropdown(course) {
  const container = document.createElement('div');
  container.className = 'dropdown';
  const btn = document.createElement('button');
  btn.className = 'dropdown-btn gray';
  btn.innerHTML = `<span class="dropdown-arrow">▼</span> ${safeCourseKode(course)} - ${safeCourseName(course)}`;
  const content = document.createElement('div');
  content.className = 'dropdown-content';
  // Sort pertemuan by date_iso descending
  const pertemuanArr = Object.entries(course.pertemuan || {}).sort((a, b) => {
    const dA = (a[1].date_iso || '').toString();
    const dB = (b[1].date_iso || '').toString();
    return dB.localeCompare(dA);
  });
  pertemuanArr.forEach(([pertemuanKey, pertemuan], idx) => {
    // REMOVE the isInLastMonth filter so all pertemuan are shown
    // if (!isInLastMonth(pertemuan.date_iso)) return;
    const row = document.createElement('div');
    row.className = 'pertemuan-row';
    // Title
    const title = document.createElement('div');
    title.textContent = pertemuanKey.replace(/Pertemuan(\d+)/, 'Pertemuan $1');
    title.className = 'pertemuan-title';
    row.appendChild(title);
    // Files
    (pertemuan.files || []).forEach(f => {
      if (f.title &&
          (/\[BAHAN AJAR\]/i.test(f.title) || /\[Tugas\]/i.test(f.title)) &&
          !/Detail Aktivitas Pembelajaran/i.test(f.title) &&
          !/\[Batas Waktu Pengumpulan Tugas/i.test(f.title)) {
        row.appendChild(makeBlueLink(`${f.title} - ${safeCourseName(course)}`, f.url));
        const hr = document.createElement('div');
        hr.className = 'row-separator';
        row.appendChild(hr);
      }
    });
    // Tugas
    (pertemuan.tugas || []).forEach(t => {
      if (t.title &&
          (/\[BAHAN AJAR\]/i.test(t.title) || /\[Tugas\]/i.test(t.title)) &&
          !/Detail Aktivitas Pembelajaran/i.test(t.title) &&
          !/\[Batas Waktu Pengumpulan Tugas/i.test(t.title)) {
        row.appendChild(makeBlueLink(`${t.title} - ${safeCourseName(course)}`, t.url));
        const hr = document.createElement('div');
        hr.className = 'row-separator';
        row.appendChild(hr);
      }
    });
    content.appendChild(row);
    if (idx < pertemuanArr.length - 1) {
      const hr = document.createElement('div');
      hr.className = 'row-separator';
      content.appendChild(hr);
    }
  });
  container.appendChild(btn);
  container.appendChild(content);
  let expanded = false;
  function updateArrow() {
    btn.querySelector('.dropdown-arrow').innerHTML = expanded ? '▲' : '▼';
  }
  btn.onclick = () => {
    expanded = !expanded;
    content.classList.toggle('show', expanded);
    updateArrow();
  };
  updateArrow();
  return container;
}

function renderPengumpulanDropdown(allCourses) {
  // Collect all active pengumpulan tugas, match popup logic: pertemuan in last month or future, tugas active
  const allPengumpulan = [];
  allCourses.forEach(course => {
    if (!course || !course.course_info) return;
    Object.entries(course.pertemuan || {}).forEach(([pertemuanKey, pertemuan]) => {
      if (!isInLastMonth(pertemuan.date_iso) && !isFuture(pertemuan.date_iso)) return;
      (pertemuan.tugas || []).forEach(t => {
        if ((t.active || isDeadlineActive(t.deadline)) && t.pengumpulan_title && !/Detail Aktivitas Pembelajaran/i.test(t.title)) {
          allPengumpulan.push({
            ...t,
            pertemuanKey,
            date_iso: pertemuan.date_iso || '',
            courseName: safeCourseName(course),
            courseInfo: course.course_info // pass the correct course info
          });
        }
      });
    });
  });
  allPengumpulan.sort((a, b) => (a.date_iso || '').localeCompare(b.date_iso || ''));
  const container = document.createElement('div');
  container.className = 'dropdown';
  const btn = document.createElement('button');
  btn.className = 'dropdown-btn gray';
  btn.innerHTML = `<span class="dropdown-arrow">▼</span> Pengumpulan Tugas Aktif`;
  const content = document.createElement('div');
  content.className = 'dropdown-content';
  allPengumpulan.forEach((t, idx) => {
    const row = document.createElement('div');
    row.className = 'pertemuan-row';
    const title = document.createElement('div');
    title.textContent = `${t.pertemuanKey.replace(/Pertemuan(\d+)/, 'Pertemuan $1')} - ${t.pengumpulan_title} - ${safeCourseName({course_info: t.courseInfo})}`;
    title.className = 'pertemuan-title';
    row.appendChild(title);
    row.appendChild(makePengumpulanLink(t.pengumpulan_title, {course_info: t.courseInfo}, t.pertemuanKey));
    content.appendChild(row);
    if (idx < allPengumpulan.length - 1) {
      const hr = document.createElement('div');
      hr.className = 'row-separator';
      content.appendChild(hr);
    }
  });
  container.appendChild(btn);
  container.appendChild(content);
  let expanded = true;
  function updateArrow() {
    btn.querySelector('.dropdown-arrow').innerHTML = expanded ? '▲' : '▼';
  }
  btn.onclick = () => {
    expanded = !expanded;
    content.classList.toggle('show', expanded);
    updateArrow();
  };
  content.classList.add('show');
  updateArrow();
  return container;
}

function isFuture(isoDate) {
  if (!isoDate) return false;
  const now = new Date();
  const d = new Date(isoDate);
  return d > now;
}

function render() {
  const root = document.getElementById('show-more-root');
  root.innerHTML = '';
  root.innerHTML += '<div style="margin-bottom:8px;"></div>';
  root.appendChild(document.createElement('hr'));
  root.innerHTML += '<div style="margin-bottom:8px;"></div>';
  root.appendChild(document.createElement('div'));
  // File-File Pelajaran Dropdown
  const fileDropdown = document.createElement('div');
  fileDropdown.className = 'dropdown';
  const fileBtn = document.createElement('button');
  fileBtn.className = 'dropdown-btn gray';
  fileBtn.innerHTML = `<span class="dropdown-arrow">▼</span> File - File Pelajaran`;
  const fileContent = document.createElement('div');
  fileContent.className = 'dropdown-content show';
  loadAllCourseData().then(courses => {
    try {
      courses.forEach(course => {
        if (!course || !course.course_info) return; // skip if data is missing
        fileContent.appendChild(renderCourseDropdown(course));
        const hr = document.createElement('div');
        hr.className = 'row-separator';
        fileContent.appendChild(hr);
      });
      fileDropdown.appendChild(fileBtn);
      fileDropdown.appendChild(fileContent);
      let expanded = true;
      function updateArrow() {
        fileBtn.querySelector('.dropdown-arrow').innerHTML = expanded ? '▲' : '▼';
      }
      fileBtn.onclick = () => {
        expanded = !expanded;
        fileContent.classList.toggle('show', expanded);
        updateArrow();
      };
      updateArrow();
      root.appendChild(fileDropdown);
      // Pengumpulan Tugas Dropdown
      root.appendChild(renderPengumpulanDropdown(courses));
    } catch (err) {
      root.innerHTML = `<div class='warning'>An error occurred while rendering: ${err && err.message ? err.message : err}</div>`;
    }
  }).catch(err => {
    root.innerHTML = `<div class='warning'>${err.message}</div>`;
  });
}

// Add dark mode toggle
function applyDarkMode(isDark) {
  document.body.classList.toggle('dark-mode', isDark);
  localStorage.setItem('sia_dark_mode', isDark ? '1' : '0');
}

function renderDarkModeToggle() {
  const toggle = document.createElement('button');
  toggle.textContent = '🌙 Dark Mode';
  toggle.style.marginBottom = '12px';
  toggle.style.marginRight = '12px';
  toggle.onclick = () => {
    const isDark = !document.body.classList.contains('dark-mode');
    applyDarkMode(isDark);
    toggle.textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
  };
  // Set initial state
  const isDark = localStorage.getItem('sia_dark_mode') === '1';
  applyDarkMode(isDark);
  toggle.textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
  document.body.insertBefore(toggle, document.body.firstChild);
}



function setupInputSavers() {
  // Remove NIM, PASSWORD, GEMINI inputs (already removed from HTML)
}

window.addEventListener('DOMContentLoaded', () => {
  renderDarkModeToggle();
  setupInputSavers();
  render();
});

// Defensive checks in rendering logic
function safeCourseName(course) {
  return (course && course.course_info && course.course_info.nama) ? course.course_info.nama : 'Unknown Course';
}
function safeCourseKode(course) {
  return (course && course.course_info && course.course_info.kode) ? course.course_info.kode : '';
} 

