const CACHE_KEY = 'courses_data_cache';
const TUGAS_CHECK_KEY = 'tugas_checkmarks';

async function loadAllCourseData() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(CACHE_KEY, (result) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (result[CACHE_KEY] && result[CACHE_KEY].data) {
        console.log('Loaded data from cache for popup.');
        resolve(result[CACHE_KEY].data);
      } else {
        reject(new Error('Data not cached yet. Please wait a moment or check background script logs.'));
      }
    });
  });
}

function isFuture(isoDate) {
  return isoDate && new Date(isoDate) > new Date();
}

function parseDeadline(deadlineStr) {
  const match = deadlineStr && deadlineStr.match(/(\d{1,2}) ([A-Za-z]+) (\d{4}) \| (\d{2}):(\d{2})/);
  if (!match) return null;
  const [_, day, month, year, hour, minute] = match;
  const monthMap = { 'Januari': 0, 'Februari': 1, 'Maret': 2, 'April': 3, 'Mei': 4, 'Juni': 5, 'Juli': 6, 'Agustus': 7, 'September': 8, 'Oktober': 9, 'November': 10, 'Desember': 11 };
  const m = monthMap[month];
  return m !== undefined ? new Date(Number(year), m, Number(day), Number(hour), Number(minute)) : null;
}

function isDeadlineActive(deadlineStr) {
  const deadline = parseDeadline(deadlineStr);
  return deadline ? deadline > new Date() : false;
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
  label.textContent = `${tugas.pengumpulan_title || tugas.title} - ${course.course_info.nama}`;
  label.className = 'tugas-label';
  row.appendChild(label);
  row.appendChild(makeCheckmark(!!checkmarks[getTugasKey(course, pertemuanKey, tugas)], (checked) => {
    checkmarks[getTugasKey(course, pertemuanKey, tugas)] = checked;
    chrome.storage.local.set({ [TUGAS_CHECK_KEY]: checkmarks });
    updateCheckmark();
  }));
  return row;
}

function renderDropdown(title, items, autoExpand = false) {
  const container = document.createElement('div');
  container.className = 'dropdown';

  const btn = document.createElement('button');
  btn.className = 'dropdown-btn gray';

  const arrowSpan = document.createElement('span');
  arrowSpan.className = 'dropdown-arrow';
  btn.appendChild(arrowSpan);
  btn.appendChild(document.createTextNode(` ${title}`));

  const content = document.createElement('div');
  content.className = 'dropdown-content';

  if (items.length === 0) {
    const noItem = document.createElement('div');
    noItem.textContent = 'No items to display.';
    noItem.style.padding = '8px';
    content.appendChild(noItem);
  } else {
    items.forEach((item, idx) => {
      content.appendChild(item);
      if (idx < items.length - 1) {
        content.appendChild(document.createElement('div')).className = 'row-separator';
      }
    });
  }

  container.append(btn, content);

  let expanded = autoExpand;
  const updateState = () => {
    arrowSpan.textContent = expanded ? '▲' : '▼';
    content.classList.toggle('show', expanded);
  };

  btn.onclick = () => { expanded = !expanded; updateState(); };
  updateState();
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

function render() {
  const root = document.getElementById('sia-quick-root');
  root.textContent = 'Loading...';

  Promise.all([
    loadAllCourseData(),
    new Promise(res => chrome.storage.local.get(TUGAS_CHECK_KEY, r => res(r[TUGAS_CHECK_KEY] || {})))
  ]).then(([data, checkmarks]) => {
    const courses = (data || []).filter(item => item && item.course_info);
    const pertemuanFiles = [];
    const activePengumpulan = [];

    const updateCheckmark = () => {
      chrome.storage.local.get(TUGAS_CHECK_KEY, (result) => {
        render();
      });
    };

    courses.forEach(course => {
      const courseName = course.course_info.nama;
      Object.entries(course.pertemuan || {}).forEach(([pertemuanKey, pertemuan]) => {
        const hasActiveTugas = (pertemuan.tugas || []).some(t => isDeadlineActive(t.deadline));
        const pertemuanIsFuture = isFuture(Array.isArray(pertemuan.date_iso) ? pertemuan.date_iso : pertemuan.date_iso);

        if (hasActiveTugas || pertemuanIsFuture) {
          (pertemuan.files || []).forEach(f => {
            if (f.title && !/Detail Aktivitas Pembelajaran/i.test(f.title) && !/[\[Batas Waktu Pengumpulan Tugas]/i.test(f.title)) {
              pertemuanFiles.push(makeBlueLink(`${f.title} - ${courseName}`, f.url));
            }
          });
        }

        (pertemuan.tugas || []).forEach(t => {
          if ((t.active || isDeadlineActive(t.deadline)) && t.pengumpulan_title) {
            activePengumpulan.push(makePengumpulanLink(t, course, pertemuanKey, checkmarks, updateCheckmark));
          }
        });
      });
    });

    root.innerHTML = '';
    root.appendChild(renderDropdown('Bahan Ajar & Tugas (Pengumpulan Aktif/Future)', pertemuanFiles, true));
    root.appendChild(renderDropdown('Pengumpulan Tugas Aktif', activePengumpulan, true));
  }).catch(err => {
    root.innerHTML = '';
    const warningDiv = document.createElement('div');
    warningDiv.className = 'warning';
    warningDiv.textContent = err.message;
    root.appendChild(warningDiv);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('show-more-btn').onclick = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('show_more.html') });
  };
  render();
});