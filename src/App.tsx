import { useEffect, useState } from 'react';
import { Alert, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { createIcons, icons } from 'lucide';
import { AssetDialogs } from './StudioMarkup';
import { Topbar } from './layout/StudioHeader';
import { StudioLayout } from './layout/StudioLayout';
import { initializeAuth } from './auth-client';
import { studioTheme } from './components/StudioControls';
import { createStudioModel } from './studio-model';
import { StudioContext } from './studio-context';
import { createViewHost, StudioViews } from './react-view';

export function App() {
  const [model] = useState(createStudioModel);
  const [views] = useState(createViewHost);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    window.lucide = { createIcons: () => createIcons({ icons }) };
    async function start() {
      try {
        const identity = await initializeAuth(controller.signal);
        controller.signal.throwIfAborted();
        model.setAccount(identity.enabled ? identity.user?.name ?? null : null);
        const { createStudioController } = await import('./studio-controller');
        controller.signal.throwIfAborted();
        await createStudioController(controller.signal, model, views);
      } catch (reason) {
        if (!mounted || controller.signal.aborted) return;
        controller.abort();
        console.error(reason);
        setError(reason instanceof Error ? reason.message : '摄影棚加载失败');
      }
    }
    void start();
    return () => { mounted = false; queueMicrotask(() => controller.abort()); };
  }, [model, views]);
  return <StudioContext.Provider value={model}><ConfigProvider locale={zhCN} theme={studioTheme}>
    <div className="app-shell">
      <Topbar />
      {error && <Alert className="startup-error" type="error" showIcon message="摄影棚未就绪" description={error}
        action={<a href="/">重新加载</a>} />}
      <StudioLayout />
    </div>
    <AssetDialogs />
    <StudioViews host={views} />
  </ConfigProvider></StudioContext.Provider>;
}