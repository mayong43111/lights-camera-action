import { useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { studioTheme } from './components/StudioControls';

export function mountView<State>(container: HTMLElement, initial: State, render: (state: State) => ReactNode) {
  let snapshot = initial;
  let disposed = false;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const getSnapshot = () => snapshot;
  function View() {
    const state = useSyncExternalStore(subscribe, getSnapshot);
    return <ConfigProvider locale={zhCN} theme={studioTheme}>{render(state)}</ConfigProvider>;
  }
  const root = createRoot(container);
  flushSync(() => root.render(<View />));
  return {
    update(state: State) {
      if (disposed) return;
      snapshot = state;
      flushSync(() => listeners.forEach(listener => listener()));
    },
    dispose() { disposed = true; root.unmount(); listeners.clear(); },
  };
}