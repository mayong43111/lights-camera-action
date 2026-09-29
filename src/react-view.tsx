import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';

interface PortalEntry { id: number; container: HTMLElement; node: ReactNode }

export function createViewHost() {
  let entries: PortalEntry[] = [];
  let sequence = 0;
  const listeners = new Set<() => void>();
  function publish(next: PortalEntry[]) {
    entries = next;
    flushSync(() => listeners.forEach(listener => listener()));
  }
  function mount(container: HTMLElement, node: ReactNode) {
    const entry = { id: ++sequence, container, node };
    publish([...entries, entry]);
    let disposed = false;
    return { dispose() {
      if (disposed) return;
      disposed = true;
      publish(entries.filter(current => current !== entry));
    } };
  }
  return {
    mount,
    getSnapshot: () => entries,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    mountView<State>(container: HTMLElement, initial: State, render: (state: State) => ReactNode) {
      let snapshot = initial;
      let disposed = false;
      const subscribers = new Set<() => void>();
      const subscribe = (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener); }; };
      const getSnapshot = () => snapshot;
      function View() { return render(useSyncExternalStore(subscribe, getSnapshot)); }
      const view = mount(container, <View />);
      return {
        update(state: State) {
          if (disposed) return;
          snapshot = state;
          subscribers.forEach(listener => listener());
        },
        dispose() { disposed = true; view.dispose(); subscribers.clear(); },
      };
    },
  };
}

export type ViewHost = ReturnType<typeof createViewHost>;

export function StudioViews({ host }: { host: ViewHost }) {
  const entries = useSyncExternalStore(host.subscribe, host.getSnapshot);
  return entries.map(entry => createPortal(entry.node, entry.container, String(entry.id)));
}