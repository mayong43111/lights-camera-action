import { createLifetime } from './lifetime';
import type { ProjectState } from './scene-types';

type PersistenceStatus = 'loading' | 'load-error' | 'unsaved' | 'restored' | 'pending' | 'saving' | 'saved' | 'save-error';

interface ProjectSessionState {
  ready: boolean;
  restoring: boolean;
  dirty: boolean;
  saving: number;
  status: PersistenceStatus;
}

interface ProjectSessionOptions {
  capture(): ProjectState;
  apply(state: ProjectState): Promise<boolean>;
  save(state: ProjectState): Promise<void>;
  isBusy(): boolean;
  onError(error: unknown): void;
}

export function createProjectSession(options: ProjectSessionOptions) {
  const lifetime = createLifetime();
  const listeners = new Set<() => void>();
  const history: string[] = [];
  let snapshot: ProjectSessionState = { ready: false, restoring: false, dirty: false, saving: 0, status: 'loading' };
  let observed = '';
  let version = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  lifetime.defer(() => listeners.clear());

  function update(patch: Partial<ProjectSessionState>) {
    if (lifetime.signal.aborted) return;
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener());
  }

  function schedule(delay = 750) {
    lifetime.clearTimer(timer);
    timer = lifetime.timeout(() => { void save(); }, delay);
  }

  function changed() {
    if (lifetime.signal.aborted || !snapshot.ready || snapshot.restoring) return;
    const current = JSON.stringify(options.capture());
    if (current === observed) return;
    observed = current;
    version++;
    update({ dirty: true, status: 'pending' });
    schedule();
  }

  function remember() {
    if (lifetime.signal.aborted || !snapshot.ready || snapshot.restoring || options.isBusy()) return;
    const current = JSON.stringify(options.capture());
    if (history.at(-1) !== current) history.push(current);
    if (history.length > 30) history.shift();
  }

  async function save() {
    lifetime.clearTimer(timer);
    timer = undefined;
    if (lifetime.signal.aborted || !snapshot.ready) return;
    if (options.isBusy() || snapshot.restoring) {
      schedule(500);
      return;
    }
    const state = options.capture();
    const current = JSON.stringify(state);
    if (current !== observed) { observed = current; version++; }
    const savedVersion = version;
    update({ saving: snapshot.saving + 1, status: 'saving' });
    try {
      await options.save(state);
      if (savedVersion === version) update({ dirty: false, status: 'saved' });
    } catch (error) {
      if (!lifetime.signal.aborted) {
        update({ dirty: true, status: 'save-error' });
        options.onError(error);
      }
    } finally {
      update({ saving: snapshot.saving - 1 });
    }
  }

  async function restore(state: ProjectState) {
    if (lifetime.signal.aborted || snapshot.restoring || options.isBusy()) return false;
    lifetime.clearTimer(timer);
    timer = undefined;
    update({ restoring: true });
    let applied = false;
    try {
      applied = await options.apply(structuredClone(state));
      return applied;
    } finally {
      update({ restoring: false });
      if (applied) {
        changed();
        if (snapshot.dirty) schedule();
      }
    }
  }

  return {
    changed, remember, save, restore, dispose: lifetime.dispose,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    activate(restored: boolean) {
      observed = JSON.stringify(options.capture());
      update({ ready: true, status: restored ? 'restored' : 'unsaved' });
    },
    failLoading() { update({ status: 'load-error' }); },
    async undo() {
      if (lifetime.signal.aborted || snapshot.restoring || options.isBusy()) return false;
      const current = JSON.stringify(options.capture());
      while (history.at(-1) === current) history.pop();
      const previous = history.at(-1);
      if (!previous || !await restore(JSON.parse(previous) as ProjectState)) return false;
      history.pop();
      return true;
    },
  };
}