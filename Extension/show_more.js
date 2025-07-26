const CACHE_KEY = 'courses_data_cache';
const TUGAS_CHECK_KEY = 'tugas_checkmarks';

async function loadAllCourseData() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(CACHE_KEY, (result) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (result[CACHE_KEY] && result[CACHE_KEY].data) {
        resolve(result[CACHE_KEY].data);
      } else {
        reject(new Error('Data not cached. Please wait for the background fetch to complete.'));
      }
    });
  });
}

function getTugasKey(course, pertemuanKey, tugas) {
  return `${course.course_info.kode}__${pertemuanKey}__${tugas.pengumpulan_title || tugas.title}`;
}

function makeCheckmark(checked, onClick) {
  const span = document.createElement('span');
  span.className = 'tugas-checkmark';
  span.textContent = checked ? '✓' : '☐';
  span.title = checked ? 'Mark as incomplete' : 'Mark as complete';
  span.onclick = (e) => {
    e.stopPropagation();
    onClick(!checked);
  };
  return span;
}

function makePengumpulanRow(tugas, course, pertemuanKey, checkmarks, updateCheckmark) {
  const row = document.createElement('div');
  row.className = 'tugas-row';
  const label = document.createElement('span');
  label.textContent = tugas.pengumpulan_title || tugas.title;
  label.className = 'tugas-label';
  row.appendChild(label);
  row.appendChild(makeCheckmark(!!checkmarks[getTugasKey(course, pertemuanKey, tugas)], (checked) => {
    checkmarks[getTugasKey(course, pertemuanKey, tugas)] = checked;
    chrome.storage.local.set({ [TUGAS_CHECK_KEY]: checkmarks });
    updateCheckmark();
  }));
  return row;
}

function makePengumpulanLink(tugas, course, pertemuanKey, checkmarks, updateCheckmark) {
  const row = document.createElement('div');
  row.className = 'tugas-row';
  const a = document.createElement('a');
  a.textContent = `${tugas.pengumpulan_title || tugas.title} - ${course.course_info.nama}`;
  // Make it a direct link to the SIA login page that opens in a new tab.
  a.href = 'https://sia.polytechnic.astra.ac.id/sso/Page_Login.aspx';
  a.target = '_blank'; // Open in a new tab
  a.className = 'blue-link tugas-label';
  // No complex onclick handler needed anymore.
  row.appendChild(a);
  row.appendChild(makeCheckmark(!!checkmarks[getTugasKey(course, pertemuanKey, tugas)], (checked) => {
    checkmarks[getTugasKey(course, pertemuanKey, tugas)] = checked;
    chrome.storage.local.set({ [TUGAS_CHECK_KEY]: checkmarks });
    updateCheckmark();
  }));
  return row;
}

// --- DARK MODE ---
function setDarkMode(enabled) {
  document.body.classList.toggle('dark-mode', enabled);
  localStorage.setItem('sia_dark_mode', enabled ? '1' : '0');
}

function renderDarkModeToggle() {
  const toggle = document.createElement('button');
  toggle.textContent = '🌙 Dark Mode';
  toggle.style.marginBottom = '12px';
  toggle.style.marginRight = '12px';
  toggle.onclick = () => {
    const isDark = !document.body.classList.contains('dark-mode');
    setDarkMode(isDark);
    toggle.textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
  };
  // Set initial state
  const isDark = true; // default dark mode
  setDarkMode(isDark);
  toggle.textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
  document.body.insertBefore(toggle, document.body.firstChild);
}

// --- TUGAS RENDERING ---
function renderCourseDropdown(course, checkmarks, updateCheckmark, tugasKeysInGlobal) {
  const container = document.createElement('div');
  container.className = 'dropdown';
  const btn = document.createElement('button');
  btn.className = 'dropdown-btn gray';
  const arrowSpan = document.createElement('span');
  arrowSpan.className = 'dropdown-arrow';
  arrowSpan.textContent = '\u25bc';
  btn.append(arrowSpan, ` ${course.course_info.kode} - ${course.course_info.nama}`);

  const content = document.createElement('div');
  content.className = 'dropdown-content';
  const pertemuanArr = Object.entries(course.pertemuan || {}).sort((a, b) => String(b[0]).localeCompare(String(a[0])));

  pertemuanArr.forEach(([pertemuanKey, pertemuan], idx) => {
    const row = document.createElement('div');
    row.className = 'pertemuan-row';
    const title = document.createElement('div');
    title.className = 'pertemuan-title';
    title.textContent = pertemuanKey.replace(/_/g, ' ');
    row.appendChild(title);
    (pertemuan.files || []).forEach(f => {
      const link = document.createElement('a');
      link.textContent = f.title;
      link.href = f.url;
      link.target = '_blank';
      link.className = 'blue-link';
      row.appendChild(link);
    });
    // Only render tugas here if not in global tugas section
    (pertemuan.tugas || []).forEach(t => {
      if (!tugasKeysInGlobal.has(getTugasKey(course, pertemuanKey, t))) {
        row.appendChild(makePengumpulanRow(t, course, pertemuanKey, checkmarks, updateCheckmark));
      }
    });
    content.appendChild(row);
    if (idx < pertemuanArr.length - 1) content.appendChild(document.createElement('div')).className = 'row-separator';
  });

  container.append(btn, content);
  let expanded = false;
  const updateState = () => { arrowSpan.textContent = expanded ? '\u25b2' : '\u25bc'; content.classList.toggle('show', expanded); };
  btn.onclick = () => { expanded = !expanded; updateState(); };
  return container;
}

function renderTugasDropdown(allCourses, checkmarks, updateCheckmark) {
  // Collect all active pengumpulan tugas
  const allPengumpulan = [];
  const tugasKeys = new Set();
  allCourses.forEach(course => {
    if (!course || !course.course_info) return;
    Object.entries(course.pertemuan || {}).forEach(([pertemuanKey, pertemuan]) => {
      (pertemuan.tugas || []).forEach(t => {
        const key = getTugasKey(course, pertemuanKey, t);
        tugasKeys.add(key);
        allPengumpulan.push({ tugas: t, course, pertemuanKey, key });
      });
    });
  });
  if (allPengumpulan.length === 0) return { dropdown: null, tugasKeys };
  const container = document.createElement('div');
  container.className = 'dropdown';
  const btn = document.createElement('button');
  btn.className = 'dropdown-btn gray';
  const arrowSpan = document.createElement('span');
  arrowSpan.className = 'dropdown-arrow';
  arrowSpan.textContent = '\u25bc';
  btn.append(arrowSpan, ' Pengumpulan Tugas Aktif');
  const content = document.createElement('div');
  content.className = 'dropdown-content';
  allPengumpulan.forEach((item, idx) => {
    content.appendChild(makePengumpulanLink(item.tugas, item.course, item.pertemuanKey, checkmarks, updateCheckmark));
    if (idx < allPengumpulan.length - 1) content.appendChild(document.createElement('div')).className = 'row-separator';
  });
  container.append(btn, content);
  let expanded = true;
  const updateState = () => { arrowSpan.textContent = expanded ? '\u25b2' : '\u25bc'; content.classList.toggle('show', expanded); };
  btn.onclick = () => { expanded = !expanded; updateState(); };
  updateState();
  return { dropdown: container, tugasKeys };
}

function render(courses, checkmarks) {
  const root = document.getElementById('show-more-root');
  root.innerHTML = '';
  const updateCheckmark = () => {
    chrome.storage.local.get(TUGAS_CHECK_KEY, (result) => {
      render(courses, result[TUGAS_CHECK_KEY] || {});
    });
  };
  // Add dark mode toggle and enable dark mode by default
  if (!document.getElementById('dark-mode-toggle')) renderDarkModeToggle();
  // Add tugas section at the top and collect keys
  const { dropdown: tugasDropdown, tugasKeys } = renderTugasDropdown(courses, checkmarks, updateCheckmark);
  if (tugasDropdown) root.appendChild(tugasDropdown);
  // Then render all course dropdowns, skipping tugas already in global section
  courses.forEach(course => root.appendChild(renderCourseDropdown(course, checkmarks, updateCheckmark, tugasKeys || new Set())));
}

function renderError(err) {
  const root = document.getElementById('show-more-root');
  root.innerHTML = '';
  const warningDiv = document.createElement('div');
  warningDiv.className = 'warning';
  warningDiv.textContent = err.message;
  root.appendChild(warningDiv);
}

function init() {
  Promise.all([
    loadAllCourseData(),
    new Promise(res => chrome.storage.local.get(TUGAS_CHECK_KEY, r => res(r[TUGAS_CHECK_KEY] || {})))
  ]).then(([courses, checkmarks]) => {
    render(courses, checkmarks);
  }).catch(renderError);
}

document.addEventListener('DOMContentLoaded', init); 

