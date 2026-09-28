interface Identity {
  enabled: boolean;
  user?: { id: string; name: string } | null;
}

export async function initializeAuth(signal?: AbortSignal): Promise<void> {
  const previousFetch = window.fetch;
  const originalFetch = previousFetch.bind(window);
  const response = await originalFetch('/api/auth/session', { cache: 'no-store', signal });
  if (!response.ok) throw new Error('无法连接认证服务。');
  const identity: Identity = await response.json();
  signal?.throwIfAborted();
  if (!identity.enabled) return;
  let ended = false;
  let disposed = false;
  function expire() {
    if (ended || disposed) return;
    ended = true;
    const shell = document.querySelector<HTMLElement>('.app-shell');
    if (shell) shell.hidden = true;
    location.replace('/login');
  }
  const user = identity.user;
  if (!user) { expire(); throw new Error('请先登录。'); }
  const userId = user.id;
  const link = document.querySelector<HTMLAnchorElement>('#account-link');
  if (link) {
    link.hidden = false;
    link.title = user.name + ' · 账户与退出登录';
  }
  window.studioIdentity = user.id;
  const authenticatedFetch: typeof fetch = async (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return originalFetch(input, options);
    if (ended) throw new Error('会话已结束。');
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    headers.set('X-Studio-User', user.id);
    const result = await originalFetch(input, { ...options, headers });
    if (result.status === 401 || result.status === 409 && result.headers.get('X-Studio-Session-Changed')) {
      expire();
      throw new Error('会话已结束。');
    }
    return result;
  };
  window.fetch = authenticatedFetch;
  async function check() {
    try {
      const status = await window.fetch('/api/auth/session', { cache: 'no-store' });
      const data: Identity = await status.json();
      if (data.user?.id !== userId) expire();
    } catch {}
  }
  const visibility = () => { if (!document.hidden) void check(); };
  const pageshow = (event: PageTransitionEvent) => { if (event.persisted) void check(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pageshow', pageshow);
  const timer = setInterval(check, 60000);
  signal?.addEventListener('abort', () => {
    disposed = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pageshow', pageshow);
    if (window.fetch === authenticatedFetch) window.fetch = previousFetch;
    if (window.studioIdentity === userId) delete window.studioIdentity;
  }, { once: true });
}