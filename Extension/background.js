const GIST_RAW_URL = 'https://gist.githubusercontent.com/DhonnanWork/16c307074f0e47ece82b500262347d75/raw/courses_data.json';
const CACHE_KEY = 'courses_data_cache';
const REFRESH_ALARM_NAME = 'daily-data-refresh';

async function fetchAndCacheData() {
  console.log('Attempting to fetch data from Gist...');
  try {
    const response = await fetch(GIST_RAW_URL, {
      cache: 'no-store' // Always get the latest version from the Gist
    });
    if (!response.ok) {
      throw new Error(`Gist request failed with status: ${response.status}`);
    }
    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error('Fetched data is not in the expected array format.');
    }

    chrome.storage.local.set({
      [CACHE_KEY]: {
        timestamp: new Date().toISOString(),
        data: data
      }
    }, () => {
      console.log('Data successfully fetched from Gist and cached.');
    });
  } catch (error) {
    console.error('Error fetching or caching data:', error);
    // Do not clear the cache, so the user can still see stale data if fetching fails.
  }
}

function getNextRefreshTime() {
  const now = new Date();
  const target = new Date();
  // WIB is UTC+7. 16:00 WIB is 09:00 UTC.
  target.setUTCHours(9, 0, 0, 0);

  // If it's already past 16:00 WIB today, schedule for tomorrow
  if (now.getTime() > target.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

// --- CHROME API EVENT LISTENERS ---

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated. Setting up initial data fetch and alarm.');
  fetchAndCacheData();
  chrome.alarms.create(REFRESH_ALARM_NAME, {
    when: getNextRefreshTime(),
    periodInMinutes: 24 * 60 // 24 hours
  });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === REFRESH_ALARM_NAME) {
    console.log('Daily refresh alarm triggered. Fetching new data.');
    fetchAndCacheData();
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log('Browser started. Checking cache status.');
  chrome.storage.local.get(CACHE_KEY, (result) => {
    if (!result[CACHE_KEY]) {
      console.log('Cache is empty on startup, fetching data.');
      fetchAndCacheData();
    }
  });
}); 