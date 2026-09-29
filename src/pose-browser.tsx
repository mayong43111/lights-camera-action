import { useRef, useSyncExternalStore } from 'react';
import { Button, Input, Modal, Select, Tooltip } from 'antd';
import type { InputRef } from 'antd';
import { Check, Expand, Folder, Layers, Search, UserRound, X, icons } from 'lucide-react';
import type { ViewHost } from './react-view';
import type { PoseEntry, PoseLibrary } from './scene-types';

interface BrowserState {
  catalog: PoseLibrary;
  folder: string;
  query: string;
  selectedId: string | null;
  caption: string;
  expanded: boolean;
}

function createModel(catalog: PoseLibrary, onSelect: (pose: PoseEntry) => void) {
  let state: BrowserState = { catalog, folder: '', query: '', selectedId: null, caption: '自定义姿势', expanded: false };
  const listeners = new Set<() => void>();
  function update(patch: Partial<BrowserState>) {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setFolder(folder: string) { update({ folder }); },
    setQuery(query: string) { update({ query }); },
    setCaption(caption: string) { update({ caption }); },
    expand(expanded: boolean) { update({ expanded }); },
    choose(pose: PoseEntry) { onSelect(pose); update({ expanded: false }); },
    setSelection(selectedId: string | null) {
      update({ selectedId, caption: state.catalog.poses.find(pose => pose.id === selectedId)?.name ?? '自定义姿势' });
    },
    updateCatalog(catalog: PoseLibrary, { reveal }: { reveal?: string | null } = {}) {
      const entry = catalog.poses.find(pose => pose.id === reveal);
      update({ catalog, folder: entry?.folder ?? (catalog.poses.some(pose => pose.folder === state.folder) ? state.folder : ''),
        query: entry ? '' : state.query,
        caption: catalog.poses.find(pose => pose.id === state.selectedId)?.name ?? '自定义姿势' });
    },
  };
}

function PoseGlyph({ name }: { name?: string | null }) {
  const key = name?.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
  const Icon = key && Object.hasOwn(icons, key) ? icons[key as keyof typeof icons] : UserRound;
  return <Icon className="pose-glyph" size={17} aria-hidden="true" />;
}

export function PoseBrowser({ model }: { model: ReturnType<typeof createModel> }) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const search = useRef<InputRef>(null);
  const pickerOpen = useRef(false);
  const folders = new Map<string, number>([['', state.catalog.poses.length]]);
  state.catalog.poses.forEach(pose => folders.set(pose.folder, (folders.get(pose.folder) ?? 0) + 1));
  const matches = (pose: PoseEntry) => (!state.folder || pose.folder === state.folder)
    && `${pose.name} ${pose.folder}`.toLocaleLowerCase().includes(state.query.trim().toLocaleLowerCase());
  const count = state.catalog.poses.filter(matches).length;
  const library = <div className={`pose-library${state.expanded ? ' is-expanded' : ''}`} id="pose-library">
    <nav className="pose-folders" id="pose-folders" aria-label="姿势文件夹">
      {[...folders].map(([folder, total]) => <Button key={folder} type="text" className="pose-folder-button" data-folder={folder}
        aria-pressed={folder === state.folder} onClick={() => model.setFolder(folder)}
        icon={folder ? <Folder size={16} /> : <Layers size={16} />}><span>{folder || '全部姿势'}</span><small>{total}</small></Button>)}
    </nav>
    <div className="pose-toolbar">
      <Select id="pose-folder" aria-label="姿势文件夹" value={state.folder} onChange={model.setFolder}
        options={[...folders].map(([folder, total]) => ({ value: folder, label: `${folder || '全部姿势'} (${total})` }))} />
      {state.expanded ? <div className="pose-search-control"><Input id="pose-search" ref={search} type="search" prefix={<Search size={15} />}
        aria-label="搜索当前文件夹中的姿势" placeholder="搜索姿势" autoComplete="off" value={state.query} onChange={event => model.setQuery(event.target.value)} />
        <Tooltip title="清空搜索"><Button id="pose-search-clear" className="icon-button" hidden={!state.query} aria-label="清空搜索" icon={<X size={16} />}
          onClick={() => { model.setQuery(''); search.current?.focus(); }} /></Tooltip></div>
        : <Select id="pose-search" aria-label="搜索当前文件夹中的姿势" showSearch labelInValue
          placeholder="选择姿势" searchValue={state.query} filterOption={false}
          onOpenChange={open => { pickerOpen.current = open; }}
          onSearch={query => { if (query || pickerOpen.current) model.setQuery(query); }}
          value={state.selectedId ? { value: state.selectedId, label: state.caption } : undefined}
          notFoundContent="没有匹配的姿势" listHeight={224}
          options={state.catalog.poses.filter(matches).map(pose => ({ value: pose.id, label: pose.name }))}
          onSelect={({ value }) => {
            const pose = state.catalog.poses.find(pose => pose.id === value);
            if (pose) model.choose(pose);
          }} />}
    </div>
    {state.expanded && <div className="pose-results"><div className="pose-grid" id="pose-controls" role="group" aria-label="姿势列表">
      {state.catalog.poses.map(pose => <button type="button" key={pose.id} data-pose={pose.id} data-folder={pose.folder}
        className={`pose-button${state.selectedId === pose.id ? ' is-active' : ''}`} hidden={!matches(pose)} aria-pressed={state.selectedId === pose.id}
        onClick={() => model.choose(pose)}><PoseGlyph name={pose.icon} /><b>{pose.name}</b><Check className="pose-check" size={14} aria-hidden="true" /></button>)}
    </div><p className="pose-empty" id="pose-empty" hidden={count > 0}>没有匹配的姿势</p></div>}
    <output className="pose-count" id="pose-count" aria-live="polite">{state.folder || '全部姿势'} · {count} / {folders.get(state.folder) ?? 0}</output>
  </div>;
  return <>
    <div className="section-heading pose-heading"><span>POSE</span><h2>姿势预设</h2>
      <Tooltip title="展开姿势库"><Button id="pose-expand" className="icon-button" aria-label="展开姿势库" aria-haspopup="dialog"
        icon={<Expand size={16} />} onClick={() => { pickerOpen.current = false; model.expand(true); }} /></Tooltip></div>
    {!state.expanded && library}
    <span id="pose-state" className="pose-count">{state.caption}</span>
    <Modal title="姿势库" open={state.expanded} width={860} footer={null} className="pose-react-dialog" destroyOnHidden
      onCancel={() => model.expand(false)} afterOpenChange={open => { if (open) search.current?.focus(); }}>
      {state.expanded && library}
    </Modal>
  </>;
}

export function createPoseBrowser(catalog: PoseLibrary, onSelect: (pose: PoseEntry) => void, views: ViewHost, root: ParentNode = document) {
  const container = root.querySelector<HTMLElement>('#pose-library-home');
  if (!container) throw new Error('Missing pose library container');
  const model = createModel(catalog, onSelect);
  const view = views.mount(container, <PoseBrowser model={model} />);
  return { ...model, dispose: view.dispose };
}