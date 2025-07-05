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
  btn.innerHTML = `<span class="dropdown-arrow">&#9660;</span> ${title}`;
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
    btn.querySelector('.dropdown-arrow').innerHTML = expanded ? '&#9650;' : '&#9660;';
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
  let networkError = false;
  loadAllCourseData().then(courses => {
    const now = new Date();
    const pertemuanFiles = [];
    const activePengumpulan = [];
    courses.forEach(course => {
      const courseName = course.course_info.nama;
      Object.entries(course.pertemuan).forEach(([pertemuanKey, pertemuan]) => {
        if (!isInLastMonthOrFuture(pertemuan.date_iso)) return;
        // Check if any tugas in this pertemuan is active
        const hasActiveTugas = (pertemuan.tugas || []).some(t => isDeadlineActive(t.deadline));
        const pertemuanIsFuture = isFuture(pertemuan.date_iso);
        if (hasActiveTugas || pertemuanIsFuture) {
          // Show all [BAHAN AJAR] and [Tugas] from this pertemuan
          (pertemuan.files || []).forEach(f => {
            if (f.title &&
                (/\[BAHAN AJAR\]/i.test(f.title) || /\[Tugas\]/i.test(f.title)) &&
                !/Detail Aktivitas Pembelajaran/i.test(f.title) &&
                !/\[Batas Waktu Pengumpulan Tugas/i.test(f.title)) {
              pertemuanFiles.push(makeBlueLink(`${f.title} - ${courseName}`, f.url));
            }
          });
          (pertemuan.tugas || []).forEach(t => {
            if (t.title &&
                (/\[BAHAN AJAR\]/i.test(t.title) || /\[Tugas\]/i.test(t.title)) &&
                !/Detail Aktivitas Pembelajaran/i.test(t.title) &&
                !/\[Batas Waktu Pengumpulan Tugas/i.test(t.title)) {
              pertemuanFiles.push(makeBlueLink(`${t.title} - ${courseName}`, t.url));
            }
          });
        }
        // For active pengumpulan tugas in last month or future
        (pertemuan.tugas || []).forEach(t => {
          if ((t.active || isDeadlineActive(t.deadline)) && t.pengumpulan_title && !/Detail Aktivitas Pembelajaran/i.test(t.title)) {
            activePengumpulan.push(makePengumpulanLink(t.pengumpulan_title, course.course_info, pertemuanKey, true));
          }
        });
      });
    });
    root.innerHTML = '';
    root.appendChild(renderDropdown('Bahan Ajar & Tugas (Pertemuan dengan Pengumpulan Aktif/Future)', pertemuanFiles, true));
    root.appendChild(renderDropdown('Active Pengumpulan Tugas', activePengumpulan, true));
  }).catch(err => {
    networkError = true;
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

document.body.insertBefore(renderApiInput(), document.body.firstChild);
document.getElementById('show-more-btn').onclick = () => {
  window.open('show_more.html', '_blank');
};

render(); 