// --- GITHUB ARTIFACT FETCHING LOGIC ---

// Configuration for your repository
const GITHUB_REPO = 'DhonnanWork/ScrapingSIA';
const WORKFLOW_FILE_NAME = 'main.yml';
const ARTIFACT_NAME = 'scraped-output';

function getGithubPAT() {
  return localStorage.getItem('github_pat') || '';
}

function setGithubPAT(token) {
  localStorage.setItem('github_pat', token);
}

function githubFetch(url, options = {}) {
  const pat = getGithubPAT();
  const headers = options.headers || {};
  if (pat) {
    headers['Authorization'] = `token ${pat}`;
  }
  return fetch(url, { ...options, headers });
}

/**
 * Finds the ID of the most recent successful run for a specific workflow.
 * @returns {Promise<number>} The ID of the workflow run.
 */
async function getLatestWorkflowRunId() {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE_NAME}/runs?status=success&per_page=1`;
  const response = await githubFetch(url);
  if (!response.ok) {
    throw new Error('Could not fetch workflow runs from GitHub API.');
  }
  const data = await response.json();
  if (!data.workflow_runs || data.workflow_runs.length === 0) {
    throw new Error('No successful workflow runs were found.');
  }
  return data.workflow_runs[0].id;
}

/**
 * Gets the download URL for a specific artifact from a workflow run.
 * @param {number} runId The ID of the workflow run.
 * @returns {Promise<string>} The URL to download the artifact zip.
 */
async function getArtifactDownloadUrl(runId) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/actions/runs/${runId}/artifacts`;
  const response = await githubFetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch artifacts for run ID ${runId}.`);
  }
  const data = await response.json();
  const artifact = data.artifacts.find(art => art.name === ARTIFACT_NAME);
  if (!artifact) {
    throw new Error(`Artifact named '${ARTIFACT_NAME}' not found in the latest successful run.`);
  }
  return artifact.archive_download_url;
}

// Cache utility functions
function getCacheExpiryTime(timestamp) {
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
    if (!result) return undefined;
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
    const cacheKey = 'github_courses_data';
    await chrome.storage.local.remove(cacheKey);
    console.log('Cache cleared successfully');
  } catch (error) {
    console.warn('Failed to clear cache:', error);
  }
}

async function getCacheStatus() {
  try {
    const cacheKey = 'github_courses_data';
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

async function loadAllCourseData() {
  const cacheKey = 'github_courses_data';
  if (!getGithubPAT()) {
    throw new Error('GitHub Personal Access Token (PAT) is required. Please enter it below.');
  }
  try {
    const cachedData = await getCachedData(cacheKey);
    if (cachedData && isCacheValid(cachedData)) {
      return cachedData.data;
    }
    const runId = await getLatestWorkflowRunId();
    const downloadUrl = await getArtifactDownloadUrl(runId);
    const artifactResponse = await githubFetch(downloadUrl);
    if (!artifactResponse.ok) {
      throw new Error('Failed to download the artifact zip file.');
    }
    const zipBlob = await artifactResponse.blob();
    const zip = await JSZip.loadAsync(zipBlob);
    const courseDataPromises = [];
    zip.forEach((relativePath, file) => {
      if (file.name.endsWith('.json') && file.name.includes('scraped_data/')) {
        const jsonPromise = file.async('string').then(content => JSON.parse(content));
        courseDataPromises.push(jsonPromise);
      }
    });
    if (courseDataPromises.length === 0) {
      throw new Error('No .json files found inside the artifact.');
    }
    const courses = await Promise.all(courseDataPromises);
    await setCachedData(cacheKey, courses);
    return courses;
  } catch (error) {
    throw new Error('Failed to get data from GitHub. ' + error.message);
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
  root.appendChild(renderPATInput());
  if (!getGithubPAT()) {
    root.appendChild(renderPATWarning());
    return;
  }
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
      
      // Update cache status after successful data load
      updateCacheStatus();
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

function setupInputSavers() {
  // Remove NIM, PASSWORD, GEMINI inputs (already removed from HTML)
}

window.addEventListener('DOMContentLoaded', () => {
  renderDarkModeToggle();
  setupCacheControls();
  setupInputSavers();
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

// UI for PAT input
function renderPATInput() {
  const patContainer = document.createElement('div');
  patContainer.className = 'pat-input-container';
  patContainer.style.margin = '16px 0';
  const label = document.createElement('label');
  label.textContent = 'GitHub Personal Access Token (PAT):';
  label.style.display = 'block';
  label.style.marginBottom = '4px';
  patContainer.appendChild(label);
  const patLink = document.createElement('a');
  patLink.textContent = "Don't know your Github PAT?";
  patLink.href = 'https://github.com/settings/personal-access-tokens';
  patLink.target = '_blank';
  patLink.className = 'blue-link';
  patLink.style.fontSize = '0.9em';
  patLink.style.marginBottom = '8px';
  patLink.style.display = 'block';
  patContainer.appendChild(patLink);
  const inputWrapper = document.createElement('div');
  inputWrapper.style.display = 'flex';
  inputWrapper.style.alignItems = 'center';
  const patInput = document.createElement('input');
  patInput.type = 'password';
  patInput.id = 'github-pat-input';
  patInput.style.flex = '1';
  patInput.style.fontSize = '1em';
  patInput.style.padding = '4px 8px';
  patInput.style.marginRight = '8px';
  patInput.autocomplete = 'off';
  patInput.value = getGithubPAT();
  inputWrapper.appendChild(patInput);
  const eyeBtn = document.createElement('button');
  eyeBtn.type = 'button';
  eyeBtn.innerHTML = '👁️';
  eyeBtn.style.fontSize = '1.2em';
  eyeBtn.style.background = 'none';
  eyeBtn.style.border = 'none';
  eyeBtn.style.cursor = 'pointer';
  eyeBtn.style.outline = 'none';
  eyeBtn.onclick = () => {
    patInput.type = patInput.type === 'password' ? 'text' : 'password';
    eyeBtn.innerHTML = patInput.type === 'password' ? '👁️' : '🙈';
  };
  inputWrapper.appendChild(eyeBtn);
  patContainer.appendChild(inputWrapper);
  // Status indicator
  const statusDiv = document.createElement('div');
  statusDiv.style.marginTop = '6px';
  statusDiv.style.height = '22px';
  patContainer.appendChild(statusDiv);
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save Token';
  saveBtn.style.marginTop = '8px';
  saveBtn.onclick = async () => {
    statusDiv.innerHTML = '<span style="color: #ffc107; font-size: 1.2em;">⏳ Saving...</span>';
    try {
      await new Promise(r => setTimeout(r, 600)); // Simulate async save
      setGithubPAT(patInput.value);
      patInput.value = getGithubPAT();
      patInput.type = 'password';
      eyeBtn.innerHTML = '👁️';
      statusDiv.innerHTML = '<span style="color: #28a745; font-size: 1.2em;">✔️ Saved!</span>';
      setTimeout(() => { statusDiv.innerHTML = ''; }, 2000);
      render();
    } catch (e) {
      statusDiv.innerHTML = '<span style="color: #dc3545; font-size: 1.2em;">❌ Failed to save</span>';
      setTimeout(() => { statusDiv.innerHTML = ''; }, 2000);
    }
  };
  patContainer.appendChild(saveBtn);
  return patContainer;
}

function renderPATWarning() {
  const warn = document.createElement('div');
  warn.className = 'warning';
  warn.style.color = '#b00';
  warn.style.background = '#fff3f3';
  warn.style.padding = '8px';
  warn.style.margin = '12px 0';
  warn.style.border = '1px solid #b00';
  warn.style.borderRadius = '4px';
  warn.textContent = 'GitHub Personal Access Token (PAT) is required to fetch data. Please enter it below.';
  return warn;
}