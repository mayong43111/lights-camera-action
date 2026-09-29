import { createContext, useContext, useRef, useSyncExternalStore } from 'react';
import type { StudioModel, StudioSnapshot } from './studio-model';

export const StudioContext = createContext<StudioModel | null>(null);

export function useStudio<Selection extends object>(select: (state: StudioSnapshot) => Selection) {
  const model = useContext(StudioContext);
  if (!model) throw new Error('Missing studio context');
  const selection = useRef<Selection | undefined>(undefined);
  function getSelection() {
    const next = select(model!.getSnapshot());
    const previous = selection.current;
    if (!previous || Object.keys(previous).length !== Object.keys(next).length ||
      !Object.entries(next).every(([key, value]) => Object.hasOwn(previous, key) && Object.is(Reflect.get(previous, key), value))) {
      selection.current = next;
    }
    return selection.current!;
  }
  const state = useSyncExternalStore(model.subscribe, getSelection);
  return { state, actions: model.actions };
}