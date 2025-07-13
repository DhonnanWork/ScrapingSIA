// --- GIST DATA FETCHING LOGIC ---

async function loadAllCourseData() {
  // SECURITY FIX: Use local API instead of mutable Gist
  const API_BASE_URL = 'http://localhost:5000'; // Change this to your production API URL
  const API_URL = `${API_BASE_URL}/api/courses`;

  try {
    console.log(`Fetching course data from secure API...`);
    const response = await fetch(API_URL, { 
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch data from API. Status: ${response.status}`);
    }

    // Parse JSON response directly
    const coursesData = await response.json();
    
    console.log(`Successfully loaded and parsed data from secure API.`);
    return coursesData;

  } catch (error) {
    console.error('❌ Error fetching or parsing data from API:', error);
    throw new Error('Failed to get or parse data. Please check the API connection and data format.');
  }
}

function getLastWeekMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  // Monday = 1, Sunday = 0
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) - 7;
  return new Date(d.setDate(diff));
}

function isInLastWeek(isoDate) {
  const now = new Date();
  const lastMonday = getLastWeekMonday(now);
  const thisMonday = new Date(lastMonday);
  thisMonday.setDate(lastMonday.getDate() + 7);
  const d = new Date(isoDate);
  return d >= lastMonday && d < thisMonday;
}

function isInLastMonthOrFuture(isoDate) {
  if (!isoDate) return false;
  const now = new Date();
  const d = new Date(isoDate);
  const oneMonthAgo = new Date(now);
  oneMonthAgo.setMonth(now.getMonth() - 1);
  return d >= oneMonthAgo || d > now;
}

function isFuture(isoDate) {
  if (!isoDate) return false;
  const now = new Date();
  const d = new Date(isoDate);
  return d > now;
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

function renderDropdown(title, items, autoExpand = false) {
  const container = document.createElement('div');
  container.className = 'dropdown';
  const btn = document.createElement('button');
  btn.className = 'dropdown-btn gray';
  btn.innerHTML = `<span class="dropdown-arrow">▼</span> ${title}`;
  const content = document.createElement('div');
  content.className = 'dropdown-content';
  items.forEach((item, idx) => {
    content.appendChild(item);
    if (idx < items.length - 1) {
      const hr = document.createElement('div');
      hr.className = 'row-separator';
      content.appendChild(hr);
    }
  });
  container.appendChild(btn);
  container.appendChild(content);
  let expanded = autoExpand;
  function updateArrow() {
    btn.querySelector('.dropdown-arrow').innerHTML = expanded ? '▲' : '▼';
  }
  btn.onclick = () => {
    expanded = !expanded;
    content.classList.toggle('show', expanded);
    updateArrow();
  };
  if (autoExpand) {
    content.classList.add('show');
    updateArrow();
  }
  return container;
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
  // SECURITY FIX: Use chrome.storage.local instead of localStorage for sensitive data
  const navTarget = {
    kode: courseInfo.kode,
    pertemuan: pertemuanKey,
    pengumpulan: pengumpulanTitle
  };
  
  // Store navigation target without credentials
  chrome.storage.local.set({ 'sia_nav_target': navTarget }, () => {
    window.open('https://sia.polytechnic.astra.ac.id/Page_Pelaksanaan_Aktivitas_Pembelajaran.aspx', '_blank');
  });
}

function makePengumpulanLink(pengumpulanTitle, courseInfo, pertemuanKey, disabled = false) {
  const a = document.createElement('a');
  a.textContent = `${pengumpulanTitle} - ${courseInfo.nama}`;
  a.href = '#';
  a.className = disabled ? 'disabled-link' : 'blue-link';
  if (disabled) {
    a.title = 'Open Show More page to use this feature';
    a.style.pointerEvents = 'none';
    a.style.color = '#222';
    a.style.textDecoration = 'none';
    a.style.cursor = 'not-allowed';
  } else {
    a.onclick = (e) => {
      e.preventDefault();
      storeNavigationTargetAndOpenLogin(courseInfo, pertemuanKey, pengumpulanTitle);
    };
  }
  return a;
}



function render() {
  const root = document.getElementById('sia-quick-root');
  root.innerHTML = 'Loading...';

  loadAllCourseData().then(data => {
    if (!Array.isArray(data)) {
      throw new Error("Data format error: The final data is not an array.");
    }
    const courses = data.filter(item => typeof item === 'object' && item !== null && item.course_info);
    
    const now = new Date();
    const pertemuanFiles = [];
    const activePengumpulan = [];
    
    courses.forEach(course => {
      if (!course || !course.course_info) return;
      const courseName = course.course_info.nama;
      Object.entries(course.pertemuan || {}).forEach(([pertemuanKey, pertemuan]) => {
        const date_iso = Array.isArray(pertemuan.date_iso) ? pertemuan.date_iso[0] : pertemuan.date_iso;
        if (!isInLastMonthOrFuture(date_iso)) return;

        const hasActiveTugas = (pertemuan.tugas || []).some(t => isDeadlineActive(t.deadline));
        const pertemuanIsFuture = isFuture(date_iso);

        if (hasActiveTugas || pertemuanIsFuture) {
          (pertemuan.files || []).forEach(f => {
            if (f.title && (/[\[BAHAN AJAR\]]/i.test(f.title) || /[\[Tugas\]]/i.test(f.title)) && !/Detail Aktivitas Pembelajaran/i.test(f.title) && !/[\[Batas Waktu Pengumpulan Tugas]/i.test(f.title)) {
              pertemuanFiles.push(makeBlueLink(`${f.title} - ${courseName}`, f.url));
            }
          });
          (pertemuan.tugas || []).forEach(t => {
            // TYPO FIX: Changed f.title to t.title in the next two lines
            if (t.title && (/[\[BAHAN AJAR\]]/i.test(t.title) || /[\[Tugas\]]/i.test(t.title)) && !/Detail Aktivitas Pembelajaran/i.test(t.title) && !/[\[Batas Waktu Pengumpulan Tugas]/i.test(t.title)) {
              pertemuanFiles.push(makeBlueLink(`${t.title} - ${courseName}`, t.url));
            }
          });
        }
        (pertemuan.tugas || []).forEach(t => {
          if ((t.active || isDeadlineActive(t.deadline)) && t.pengumpulan_title && !/Detail Aktivitas Pembelajaran/i.test(t.title)) {
            activePengumpulan.push(makePengumpulanLink(t.pengumpulan_title, course.course_info, pertemuanKey, false));
          }
        });
      });
    });

    root.innerHTML = '';
    root.appendChild(renderDropdown('Bahan Ajar & Tugas (Pertemuan dengan Pengumpulan Aktif/Future)', pertemuanFiles, true));
    root.appendChild(renderDropdown('Active Pengumpulan Tugas', activePengumpulan, true));

  }).catch(err => {
    root.innerHTML = `<div class='warning'>${err.message}</div>`;
  });
}

document.getElementById('show-more-btn').onclick = () => {
  window.open('show_more.html', '_blank');
};

render();