const DEFAULT_API_URL = 'http://127.0.0.1:5000';
const COURSE_FILES = [
  "2425191A-Pemrograman 2.json",
  "2425191A-Sistem Operasi.json",
  "2425191A-Struktur Data.json",
  "2425191A-Basis Data 1.json",
  "2425191A-Rekayasa Perangkat Lunak.json",
  "2425191A-Kewarganegaraan.json",
  "2425191A-Matematika 2.json"
];

// Cache utility functions
function getCacheExpiryTime(timestamp) {
  // Get the top of the next hour after the timestamp
  const date = new Date(timestamp);
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return date.getTime();
}

function isCacheValid(cachedData) {
  if (!cachedData || !cachedData.timestamp) return false;
  const currentTime = Date.now();
  const expiryTime = getCacheExpiryTime(cachedData.timestamp);
  return currentTime < expiryTime;
}

async function getCachedData(key) {
  try {
    const result = await chrome.storage.local.get(key);
    return result[key];
  } catch (error) {
    console.warn('Failed to retrieve cached data:', error);
    return null;
  }
}

async function setCachedData(key, data) {
  try {
    const cacheObject = {
      data: data,
      timestamp: Date.now()
    };
    await chrome.storage.local.set({ [key]: cacheObject });
  } catch (error) {
    console.warn('Failed to cache data:', error);
  }
}

async function clearCache() {
  try {
    const apiUrl = getApiUrl();
    const cacheKey = `courses_data_${apiUrl}`;
    await chrome.storage.local.remove(cacheKey);
    console.log('Cache cleared successfully');
  } catch (error) {
    console.warn('Failed to clear cache:', error);
  }
}

async function getCacheStatus() {
  try {
    const apiUrl = getApiUrl();
    const cacheKey = `courses_data_${apiUrl}`;
    const cachedData = await getCachedData(cacheKey);
    
    if (!cachedData) {
      return { exists: false, valid: false, message: 'No cached data' };
    }
    
    const valid = isCacheValid(cachedData);
    const expiryTime = getCacheExpiryTime(cachedData.timestamp);
    const timeUntilExpiry = expiryTime - Date.now();
    const minutesUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60));
    
    return {
      exists: true,
      valid: valid,
      timestamp: cachedData.timestamp,
      expiryTime: expiryTime,
      minutesUntilExpiry: minutesUntilExpiry,
      message: valid ? `Cache valid for ${minutesUntilExpiry} more minutes` : 'Cache expired'
    };
  } catch (error) {
    console.warn('Failed to get cache status:', error);
    return { exists: false, valid: false, message: 'Error checking cache' };
  }
}

function getApiUrl() {
  return localStorage.getItem('sia_api_url') || DEFAULT_API_URL;
}

function setApiUrl(url) {
  localStorage.setItem('sia_api_url', url);
}

async function loadAllCourseData() {
  const apiUrl = getApiUrl();
  const cacheKey = `courses_data_${apiUrl}`;
  
  try {
    // Step 1: Try to retrieve cached data
    console.log(`Checking cache for key: ${cacheKey}`);
    const cachedData = await getCachedData(cacheKey);
    
    // Step 2: Check if cache exists and is valid
    if (cachedData && isCacheValid(cachedData)) {
      console.log('✅ Using cached course data');
      console.log(`Cache timestamp: ${new Date(cachedData.timestamp).toLocaleString()}`);
      console.log(`Cache expires at: ${new Date(getCacheExpiryTime(cachedData.timestamp)).toLocaleString()}`);
      return cachedData.data;
    }
    
    if (cachedData) {
      console.log('⚠️ Cache exists but is expired');
      console.log(`Cache timestamp: ${new Date(cachedData.timestamp).toLocaleString()}`);
      console.log(`Cache expired at: ${new Date(getCacheExpiryTime(cachedData.timestamp)).toLocaleString()}`);
    } else {
      console.log('ℹ️ No cached data found');
    }
    
    // Step 3: Cache is stale or doesn't exist, fetch fresh data
    console.log('🔄 Fetching fresh course data from API');
    const results = await Promise.all(COURSE_FILES.map(f =>
      fetch(`${apiUrl}/api/course/${encodeURIComponent(f)}`)
        .then(r => {
          if (!r.ok) throw new Error('API error');
          return r.json();
        })
    ));
    
    // Step 4: Cache the fresh data
    console.log('💾 Caching fresh data');
    await setCachedData(cacheKey, results);
    console.log('✅ Data cached successfully');
    
    return results;
  } catch (e) {
    console.error('❌ Error in loadAllCourseData:', e);
    throw new Error('Failed to connect to SIA Flask API. Please make sure the server is running.');
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
  btn.innerHTML = `<span class="dropdown-arrow">&#9660;</span> ${safeCourseKode(course)} - ${safeCourseName(course)}`;
  const content = document.createElement('div');
  content.className = 'dropdown-content';
  // Sort pertemuan by date_iso descending
  const pertemuanArr = Object.entries(course.pertemuan || {}).sort((a, b) => {
    const dA = a[1].date_iso || '';
    const dB = b[1].date_iso || '';
    return dB.localeCompare(dA);
  });
  pertemuanArr.forEach(([pertemuanKey, pertemuan], idx) => {
    if (!isInLastMonth(pertemuan.date_iso)) return;
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
    btn.querySelector('.dropdown-arrow').innerHTML = expanded ? '&#9650;' : '&#9660;';
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
  btn.innerHTML = `<span class="dropdown-arrow">&#9660;</span> Pengumpulan Tugas Aktif`;
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
    btn.querySelector('.dropdown-arrow').innerHTML = expanded ? '&#9650;' : '&#9660;';
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
  root.innerHTML = 'Loading...';
  loadAllCourseData().then(courses => {
    try {
      root.innerHTML = '';
      // File-File Pelajaran Dropdown
      const fileDropdown = document.createElement('div');
      fileDropdown.className = 'dropdown';
      const fileBtn = document.createElement('button');
      fileBtn.className = 'dropdown-btn gray';
      fileBtn.innerHTML = `<span class="dropdown-arrow">&#9660;</span> File - File Pelajaran`;
      const fileContent = document.createElement('div');
      fileContent.className = 'dropdown-content show';
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
        fileBtn.querySelector('.dropdown-arrow').innerHTML = expanded ? '&#9650;' : '&#9660;';
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
      
      // Update cache status after successful data load
      updateCacheStatus();
    } catch (err) {
      root.innerHTML = `<div class='warning'>An error occurred while rendering: ${err && err.message ? err.message : err}</div>`;
    }
  }).catch(err => {
    root.innerHTML = `<div class='warning'>${err.message}</div>`;
  });
}

function renderApiInput() {
  const container = document.createElement('div');
  container.className = 'api-url-input';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'API Base URL';
  input.value = getApiUrl();
  input.onchange = async (e) => {
    const oldUrl = getApiUrl();
    setApiUrl(e.target.value);
    
    // Clear cache if API URL changed
    if (oldUrl !== e.target.value) {
      await clearCache();
    }
    
    render();
  };
  container.appendChild(input);
  return container;
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

// Cache status functionality
async function updateCacheStatus() {
  const cacheInfo = document.getElementById('cache-info');
  const clearCacheBtn = document.getElementById('clear-cache-btn');
  
  try {
    const status = await getCacheStatus();
    
    if (status.exists) {
      const cacheTime = new Date(status.timestamp).toLocaleTimeString();
      const expiryTime = new Date(status.expiryTime).toLocaleTimeString();
      
      if (status.valid) {
        cacheInfo.innerHTML = `
          <strong>✅ Cache Status:</strong> ${status.message}<br>
          <small>Cached at: ${cacheTime} | Expires at: ${expiryTime}</small>
        `;
        cacheInfo.style.color = '#28a745';
      } else {
        cacheInfo.innerHTML = `
          <strong>⚠️ Cache Status:</strong> ${status.message}<br>
          <small>Cached at: ${cacheTime} | Expired at: ${expiryTime}</small>
        `;
        cacheInfo.style.color = '#ffc107';
      }
      clearCacheBtn.style.display = 'inline-block';
    } else {
      cacheInfo.innerHTML = '<strong>ℹ️ Cache Status:</strong> No cached data available';
      cacheInfo.style.color = '#6c757d';
      clearCacheBtn.style.display = 'none';
    }
  } catch (error) {
    cacheInfo.innerHTML = '<strong>❌ Cache Status:</strong> Error checking cache';
    cacheInfo.style.color = '#dc3545';
    clearCacheBtn.style.display = 'none';
  }
}

function setupCacheControls() {
  const clearCacheBtn = document.getElementById('clear-cache-btn');
  
  clearCacheBtn.onclick = async () => {
    try {
      await clearCache();
      clearCacheBtn.textContent = 'Cache Cleared!';
      clearCacheBtn.style.background = '#28a745';
      setTimeout(() => {
        clearCacheBtn.textContent = 'Clear Cache';
        clearCacheBtn.style.background = '#dc3545';
        updateCacheStatus();
      }, 2000);
    } catch (error) {
      console.error('Failed to clear cache:', error);
      clearCacheBtn.textContent = 'Error!';
      clearCacheBtn.style.background = '#dc3545';
      setTimeout(() => {
        clearCacheBtn.textContent = 'Clear Cache';
      }, 2000);
    }
  };
}

window.addEventListener('DOMContentLoaded', () => {
  renderDarkModeToggle();
  setupCacheControls();
  updateCacheStatus();
  render();
});

// Defensive checks in rendering logic
function safeCourseName(course) {
  return (course && course.course_info && course.course_info.nama) ? course.course_info.nama : 'Unknown Course';
}
function safeCourseKode(course) {
  return (course && course.course_info && course.course_info.kode) ? course.course_info.kode : '';
} 