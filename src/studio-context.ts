import { createContext, useContext, useSyncExternalStore } from 'react';
import type { StudioModel } from './studio-model';

export const StudioContext = createContext<StudioModel | null>(null);

export function useStudio() {
  const model = useContext(StudioContext);
  if (!model) throw new Error('Missing studio context');
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  return { state, actions: model.actions };
}