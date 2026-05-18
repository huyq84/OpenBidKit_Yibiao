const CLIENT_ID_KEY = 'analytics_client_id';

type AnalyticsEvent = 'app_open' | 'page_view';

let appOpenTracked = false;
let lastTrackedPage = '';

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
  return 'web';
}

function getVersion() {
  return Promise.resolve('0.1.0');
}

// 私有部署时替换为实际埋点服务地址
const ANALYTICS_ENDPOINT = '';
const PROJECT_NAME = 'sog-plan-client';

function sendAnalytics(event: AnalyticsEvent, page = '') {
  if (!ANALYTICS_ENDPOINT) return;
  void getVersion().then((version) => {
    fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
