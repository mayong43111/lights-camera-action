import { Button, Input } from 'antd';
import { Download, ImagePlus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { imageDataUrl } from './library-client';
import type { Asset, AssetKind, LibraryClient } from './library-client';
import { requiredElement } from './dom';
import { mountView } from './react-view';

const names = { photo: '拍摄相册', result: '生成历史', person: '人物素材', garment: '服装素材' };
export type LibraryAsset = Pick<Asset, 'id' | 'kind' | 'name' | 'created'>
  & Partial<Pick<Asset, 'mime' | 'width' | 'height' | 'metadata'>> & { pending?: boolean; image?: string };
type UseImage = (asset: LibraryAsset, image: string) => unknown;
interface LibraryOptions {
  client: LibraryClient;
  onUse: UseImage;
  onDelete(id: string): unknown;
  announce(message: string): void;
  root?: ParentNode;
}

export function createLibrary({ client, onUse, onDelete, root = document }: LibraryOptions) {
  const dialog = requiredElement<HTMLDialogElement>('#library-dialog', root);
  const pending: LibraryAsset[] = [];
  let kind: AssetKind = 'photo';
  let items: Asset[] = [];
  let total = 0;
  let selected: LibraryAsset | null = null;
  let selectedImage: string | null = null;
  let generation = 0;
  let selectionVersion = 0;
  let busy = false;
  let loading = false;
  let disposed = false;
  let saves = 0;
  let query = '';
  let status = '';
  let picker: UseImage | null = null;
  const thumbnails = new Map<string, string>();
  const allItems = (): LibraryAsset[] => [...pending.filter(asset => asset.kind === kind), ...items];
  const snapshot = () => ({ kind, total, selected, selectedImage, busy, loading, query, status, picker: !!picker,
    more: items.length < total, items: allItems(), thumbnails: new Map(thumbnails) });
  const view = mountView(dialog, snapshot(), state => {
    const visible = state.items.filter(asset => asset.name.toLocaleLowerCase().includes(state.query.trim().toLocaleLowerCase()));
    const disabled = state.busy || !state.selectedImage;
    return <>
      <header className="retouch-header"><h2 id="library-title">相册与素材</h2><div className="retouch-actions">
        <Button className="icon-button" id="library-upload" title="导入图片" aria-label="导入图片" icon={<ImagePlus size={16} />} disabled={state.busy} onClick={() => input.click()} />
        <Button className="icon-button" id="library-refresh" title="刷新相册" aria-label="刷新相册" icon={<RefreshCw size={16} />} disabled={state.busy || state.loading} onClick={() => void load()} />
        <Button className="icon-button" id="library-close" title="关闭相册" aria-label="关闭相册" icon={<X size={16} />} onClick={() => dialog.close()} />
      </div></header>
      <div className="library-toolbar"><div className="retouch-tabs" role="tablist" aria-label="图片分类">
        {(Object.keys(names) as AssetKind[]).map(value => <Button key={value} role="tab" data-library-kind={value}
          aria-selected={state.kind === value} disabled={state.busy} onClick={() => setKind(value)}>{names[value]}</Button>)}
      </div><Input id="library-search" type="search" placeholder="搜索已加载图片" aria-label="搜索已加载图片" value={state.query}
        onChange={event => { query = event.target.value; render(); }} /></div>
      <div className="library-workspace"><section className="library-list" aria-label="图片列表">
        <div id="library-grid" className="library-grid">{visible.map(asset => <button key={asset.id} type="button" className="library-item"
          data-asset-id={asset.id} aria-pressed={asset.id === state.selected?.id} onClick={() => void select(asset)}>
          <img alt={asset.name} loading="lazy" src={asset.image || state.thumbnails.get(asset.id)} /><span>{asset.name}</span>
          <small>{asset.pending ? '未保存 · 可重试' : new Date(asset.created).toLocaleDateString()}</small>
        </button>)}</div>
        <p id="library-empty" hidden={visible.length > 0}>{state.query ? '没有匹配的图片' : '暂无图片'}</p>
        <Button id="library-more" className="button button-light" hidden={!state.more} disabled={state.busy || state.loading} onClick={() => void load(true)}>加载更多</Button>
      </section><aside id="library-detail" className="library-detail" aria-label="图片详情" hidden={!state.selected}>
        <img id="library-preview" alt="所选图片预览" src={state.selectedImage ?? undefined} /><h3 id="library-name">{state.selected?.name}</h3>
        <p id="library-info">{state.selected && `${state.selected.pending ? '尚未保存 · ' : ''}${new Date(state.selected.created).toLocaleString()}${state.selected.width ? ` · ${state.selected.width} × ${state.selected.height}` : ''}`}</p>
        <p id="library-prompt">{typeof state.selected?.metadata?.prompt === 'string' ? state.selected.metadata.prompt : ''}</p>
        <div className="library-actions">
          <Button id="library-download" className="icon-button" title="下载原图" aria-label="下载原图" icon={<Download size={16} />} disabled={disabled} onClick={download} />
          <Button id="library-use" className="button button-light" disabled={disabled} onClick={() => void action(async (asset, image) => {
            if (asset.pending && (picker || ['person', 'garment'].includes(asset.kind))) throw new Error('请先重试保存此素材。');
            await (picker || onUse)(asset, image);
            dialog.close();
          })}>{state.picker ? '选用此图片' : state.selected?.kind === 'person' ? '使用人物图' : state.selected?.kind === 'garment' ? '使用服装图' : '用于修图'}</Button>
          <Button id="library-retry" className="icon-button" title="重试保存" aria-label="重试保存" icon={<Save size={16} />} hidden={!state.selected?.pending}
            disabled={state.busy} onClick={() => void action(async asset => {
              if (!asset.pending || !asset.image) return;
              const saved = await client.add(asset.kind, asset.image, asset.name);
              pending.splice(pending.indexOf(asset), 1);
              await load();
              await select(saved);
              status = '已保存';
            })} />
          <Button id="library-delete" className="icon-button" title="删除图片" aria-label="删除图片" icon={<Trash2 size={16} />} disabled={disabled}
            onClick={() => void action(async asset => {
              if (!confirm(`永久删除“${asset.name}”？此操作不可撤销。`)) return;
              if (asset.pending) pending.splice(pending.indexOf(asset), 1);
              else await client.remove(asset.id);
              if (disposed) return;
              await onDelete(asset.id);
              setKind(kind);
            })} />
        </div>
      </aside></div>
      <p id="library-status" role="status" aria-live="polite">{state.status}</p>
      <input id="library-input" type="file" accept="image/png,image/jpeg" hidden onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) void upload(file);
      }} />
    </>;
  });
  const input = requiredElement<HTMLInputElement>('#library-input', dialog);
  function render() { view.update(snapshot()); }
  function releaseThumbnails() {
    for (const url of thumbnails.values()) URL.revokeObjectURL(url);
    thumbnails.clear();
  }
  async function select(asset: LibraryAsset) {
    const version = ++selectionVersion;
    selected = asset;
    selectedImage = null;
    render();
    try {
      const image = asset.image || await client.image(asset.id);
      if (disposed || version !== selectionVersion) return;
      selectedImage = image;
    } catch (error) { if (version === selectionVersion) status = error instanceof Error ? error.message : String(error); }
    render();
  }
  async function load(more = false) {
    if (disposed) return;
    const version = ++generation;
    status = '正在读取…';
    loading = true;
    if (!more) { items = []; releaseThumbnails(); }
    render();
    try {
      const data = await client.list(kind, more ? items.length : 0);
      if (disposed || version !== generation) return;
      items.push(...data.items);
      total = data.total;
      status = `${names[kind]} · ${total} 张${pending.length ? ` · ${pending.length} 张尚未保存` : ''}`;
      render();
      for (const asset of data.items) {
        const blob = await client.blob(asset.id, true);
        if (disposed || version !== generation || !dialog.open) return;
        thumbnails.set(asset.id, URL.createObjectURL(blob));
        render();
      }
    } catch (error) {
      if (version === generation) status = error instanceof Error ? error.message : String(error);
    } finally { if (version === generation) { loading = false; render(); } }
  }
  function setKind(next: AssetKind) {
    kind = next;
    selected = null;
    selectedImage = null;
    selectionVersion++;
    query = '';
    void load();
  }
  function open(next: AssetKind = kind, callback: UseImage | null = null) {
    if (disposed) return;
    picker = callback;
    if (!dialog.open) dialog.showModal();
    setKind(next);
  }
  function retain(targetKind: AssetKind, image: string, name: string) {
    const asset = { id: crypto.randomUUID(), kind: targetKind, image, name, pending: true, created: new Date().toISOString() };
    pending.unshift(asset);
    render();
    return asset;
  }
  async function save(targetKind: AssetKind, image: string, name: string) {
    saves++;
    try {
      const asset = await client.add(targetKind, image, name);
      if (dialog.open) void load();
      return asset;
    } catch (error) {
      retain(targetKind, image, name);
      throw new Error(`${error instanceof Error ? error.message : String(error)} 图片暂留相册“未保存”项，可重试或下载；请勿刷新。`);
    } finally { saves--; }
  }
  async function action(run: (asset: LibraryAsset, image: string) => unknown) {
    if (busy || !selected || !selectedImage) return;
    busy = true;
    render();
    try { await run(selected, selectedImage); } catch (error) { status = error instanceof Error ? error.message : String(error); }
    finally { busy = false; render(); }
  }
  function download() {
    if (!selected || !selectedImage) return;
    const link = document.createElement('a');
    link.download = selected.name;
    link.href = selectedImage;
    link.click();
  }
  async function upload(file: File) {
    if (busy) return;
    busy = true;
    render();
    const targetKind = kind;
    try {
      const limit = ['photo', 'result'].includes(targetKind) ? 32 : 8;
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > limit * 1024 * 1024) throw new Error(`仅支持 ${limit} MB 以内的 PNG/JPG。`);
      const image = await imageDataUrl(file);
      const asset = await client.add(targetKind, image, file.name.slice(0, 160));
      if (disposed) return;
      await load();
      await select(asset);
      status = '素材已保存';
    } catch (error) { status = error instanceof Error ? error.message : String(error); }
    finally { busy = false; render(); }
  }
  const openButton = requiredElement('#library-open', root);
  const openFromButton = () => open();
  const close = () => {
    generation++; selectionVersion++; releaseThumbnails(); selectedImage = null; picker = null; loading = false; render();
  };
  openButton.addEventListener('click', openFromButton);
  dialog.addEventListener('close', close);
  return {
    open, save, retain, get hasPending() { return pending.length > 0 || busy || saves > 0; },
    refresh: () => { if (dialog.open) void load(); },
    dispose() {
      disposed = true; generation++; selectionVersion++; releaseThumbnails();
      openButton.removeEventListener('click', openFromButton); dialog.removeEventListener('close', close);
      dialog.close(); view.dispose();
    },
  };
}