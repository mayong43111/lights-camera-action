import { useEffect, useState } from 'react';
import { Alert, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { createIcons, icons } from 'lucide';
import { AssetDialogs } from './StudioMarkup';
import { Topbar } from './layout/StudioHeader';
import { StudioLayout } from './layout/StudioLayout';
import { initializeAuth } from './auth-client';
import { studioTheme } from './components/StudioControls';

export function App() {
  const [error, setError] = useState<string>();
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    window.lucide = { createIcons: () => createIcons({ icons }) };
    async function start() {
      try {
        await initializeAuth(controller.signal);
        controller.signal.throwIfAborted();
        const { createStudioController } = await import('./studio-controller');
        controller.signal.throwIfAborted();
        await createStudioController(controller.signal);
      } catch (reason) {
        if (!mounted || controller.signal.aborted) return;
        controller.abort();
        console.error(reason);
        setError(reason instanceof Error ? reason.message : '摄影棚加载失败');
      }
    }
    void start();
    return () => { mounted = false; queueMicrotask(() => controller.abort()); };
  }, []);
  return <ConfigProvider locale={zhCN} theme={studioTheme}>
    <div className="app-shell">
      <Topbar />
      {error && <Alert className="startup-error" type="error" showIcon message="摄影棚未就绪" description={error}
        action={<a href="/">重新加载</a>} />}
      <StudioLayout />
    </div>
    <AssetDialogs />
  </ConfigProvider>;
}