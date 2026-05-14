const ANALYTICS_ENDPOINT = 'https://analytics.agnet.top/track';
const PROJECT_NAME = 'yibiao-client';
const CLIENT_ID_KEY = 'analytics_client_id';

type AnalyticsEvent = 'app_open' | 'page_view';

let appOpenTracked = false;
let lastTrackedPage = '';
let versionPromise: Promise<string> | null = null;

function getOrCreateClientId() {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;

    const id = crypto.randomUUID?.() || `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch {
    return '';
  }
}

function getPlatform() {
  return window.yibiao?.platform || window.yibiaoClient?.platform || '';
}

function getVersion() {
  if (!versionPromise) {
    versionPromise = window.yibiao?.getVersion?.().catch(() => '') || Promise.resolve('');
  }

  return versionPromise;
}

function sendAnalytics(event: AnalyticsEvent, page = '') {
  void getVersion().then((version) => {
    fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectName: PROJECT_NAME,
        event,
        page,
        version,
        platform: getPlatform(),
        arch: '',
        client_id: getOrCreateClientId(),
      }),
    }).catch(() => undefined);
  }).catch(() => undefined);
}

export function trackAppOpen() {
  if (appOpenTracked) return;
  appOpenTracked = true;
  sendAnalytics('app_open');
}

export function trackPageView(page: string) {
  const normalizedPage = page.trim();
  if (!normalizedPage || normalizedPage === lastTrackedPage) return;

  lastTrackedPage = normalizedPage;
  sendAnalytics('page_view', normalizedPage);
}
