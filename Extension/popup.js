// --- GITHUB ARTIFACT FETCHING LOGIC ---

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

function render() {
  const root = document.getElementById('sia-quick-root');
  root.innerHTML = '';
  root.appendChild(renderPATInput());
  if (!getGithubPAT()) {
    root.appendChild(renderPATWarning());
    return;
  }
  let networkError = false;
  loadAllCourseData().then(courses => {
    const now = new Date();
    const pertemuanFiles = [];
    const activePengumpulan = [];
    courses.forEach(course => {
      if (!course || !course.course_info) return;
      const courseName = course.course_info.nama;
      Object.entries(course.pertemuan || {}).forEach(([pertemuanKey, pertemuan]) => {
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
            activePengumpulan.push(makePengumpulanLink(t.pengumpulan_title, course.course_info, pertemuanKey, false));
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

document.getElementById('show-more-btn').onclick = () => {
  window.open('show_more.html', '_blank');
};

render();