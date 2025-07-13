function getNavTarget() {
  // SECURITY FIX: Use chrome.storage.local instead of localStorage
  return new Promise((resolve) => {
    chrome.storage.local.get(['sia_nav_target'], (result) => {
      resolve(result.sia_nav_target || {});
    });
  });
}

function normalize(str) {
  return (str || '').replace(/\s+/g, '').toLowerCase();
}

function waitFor(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (Date.now() - start > timeout) return reject('Timeout');
      setTimeout(check, 200);
    }
    check();
  });
}

async function stepLogin(nav) {
  // SECURITY FIX: Get credentials from chrome.storage.local instead of nav object
  return new Promise((resolve) => {
    chrome.storage.local.get(['sia_nim', 'sia_password', 'sia_gemini'], (result) => {
      if (document.querySelector('#txtUsername') && document.querySelector('#txtPassword')) {
        document.querySelector('#txtUsername').value = result.sia_nim || '';
        document.querySelector('#txtPassword').value = result.sia_password || '';
        if (result.sia_gemini && document.querySelector('#txtCaptcha')) {
          document.querySelector('#txtCaptcha').value = result.sia_gemini;
        }
        document.querySelector('#MainContent_btnLogin').click();
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
}

async function stepRoleSelection() {
  // Try click 'Login sebagai MAHASISWA'
  const link = Array.from(document.querySelectorAll('a')).find(a => /mahasiswa/i.test(a.textContent));
  if (link) {
    link.click();
    return true;
  }
  // Try redirect link
  const redirect = Array.from(document.querySelectorAll('a')).find(a => /sso\/Redirect\.aspx\?token=/.test(a.href));
  if (redirect) {
    window.location = redirect.href;
    return true;
  }
  return false;
}

async function stepDashboard() {
  // Go to 'Pelaksanaan Perkuliahan' > 'Aktivitas Pembelajaran'
  const pelaksanaan = Array.from(document.querySelectorAll('a')).find(a => /Pelaksanaan Perkuliahan/i.test(a.textContent));
  if (pelaksanaan) pelaksanaan.click();
  setTimeout(() => {
    const aktivitas = Array.from(document.querySelectorAll('a')).find(a => /Aktivitas Pembelajaran/i.test(a.textContent));
    if (aktivitas) aktivitas.click();
  }, 1000);
  return true;
}

async function stepCourseList(nav) {
  // Find course row by kode
  const rows = document.querySelectorAll('#MainContent_gridData tbody tr');
  for (const row of rows) {
    const tds = row.querySelectorAll('td');
    if (tds.length > 5 && normalize(tds[5].textContent).includes(normalize(nav.kode))) {
      const detailBtn = row.querySelector('a[id*="linkDetail"]');
      if (detailBtn) {
        detailBtn.click();
        return true;
      }
    }
  }
  return false;
}

async function stepCourseDetail(nav) {
  // Find pertemuan row
  const rows = document.querySelectorAll('#MainContent_gridDetail tbody tr');
  for (const row of rows) {
    const infoCell = row.querySelector('td');
    if (!infoCell) continue;
    if (normalize(infoCell.textContent).includes(normalize(nav.pertemuan))) {
      // Find pengumpulan tugas link
      const links = row.querySelectorAll('td:nth-child(2) a');
      for (const link of links) {
        if (normalize(link.textContent).includes(normalize(nav.pengumpulan))) {
          link.click();
          // SECURITY FIX: Use chrome.storage.local instead of localStorage
          chrome.storage.local.remove('sia_nav_target');
          return true;
        }
      }
    }
  }
  return false;
}

async function main() {
  const nav = await getNavTarget();
  if (!nav || !nav.kode || !nav.pertemuan || !nav.pengumpulan) return;
  const url = window.location.href;
  if (/Page_Login\.aspx/i.test(url)) {
    await stepLogin(nav);
  } else if (/sso\/default\.aspx/i.test(url) || /sso\/Page_Login\.aspx/i.test(url)) {
    await stepRoleSelection();
  } else if (/default\.aspx/i.test(url)) {
    await stepDashboard();
  } else if (/Page_Pelaksanaan_Aktivitas_Pembelajaran\.aspx/i.test(url)) {
    await stepCourseList(nav);
  } else if (/Page_Pelaksanaan_Aktivitas_Pembelajaran_Detail\.aspx/i.test(url)) {
    await stepCourseDetail(nav);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(main, 1200);
}); 