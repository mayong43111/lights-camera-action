import { imageDataUrl } from './library-client.js';

const names = { photo: '拍摄相册', result: '生成历史', person: '人物素材', garment: '服装素材' };

export function createLibrary({ client, onUse, onDelete, announce, root = document }) {
  const dialog = root.querySelector('#library-dialog');
  const grid = root.querySelector('#library-grid');
  const status = root.querySelector('#library-status');
  const search = root.querySelector('#library-search');
  const detail = root.querySelector('#library-detail');
  const preview = root.querySelector('#library-preview');
  const pending = [];
  let kind = 'photo';
  let items = [];
  let total = 0;
  let selected = null;
  let selectedImage = null;
  let generation = 0;
  let selectionVersion = 0;
  let busy = false;
  let saves = 0;
  let picker = null;
  const thumbnails = new Map();

  function releaseThumbnails() {
    for (const url of thumbnails.values()) URL.revokeObjectURL(url);
    thumbnails.clear();
  }

  function refreshActions() {
    for (const id of ['download', 'use', 'delete']) root.querySelector(`#library-${id}`).disabled = busy || !selectedImage;
    root.querySelector('#library-retry').hidden = !selected?.pending;
    root.querySelector('#library-retry').disabled = busy;
    root.querySelector('#library-upload').disabled = busy;
    root.querySelector('#library-refresh').disabled = busy;
    root.querySelector('#library-more').disabled = busy;
    root.querySelector('#library-more').hidden = items.length >= total;
    root.querySelectorAll('[data-library-kind]').forEach(button => { button.disabled = busy; });
    root.querySelector('#library-use').textContent = picker ? '选用此图片' : selected?.kind === 'person' ? '使用人物图' : selected?.kind === 'garment' ? '使用服装图' : '用于修图';
  }

  async function select(asset) {
    const version = ++selectionVersion;
    selected = asset;
    selectedImage = null;
    preview.removeAttribute('src');
    detail.hidden = false;
    root.querySelector('#library-name').textContent = asset.name;
    root.querySelector('#library-info').textContent = `${asset.pending ? '尚未保存 · ' : ''}${new Date(asset.created).toLocaleString()}${asset.width ? ` · ${asset.width} × ${asset.height}` : ''}`;
    root.querySelector('#library-prompt').textContent = asset.metadata?.prompt || '';
    grid.querySelectorAll('[data-asset-id]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.assetId === asset.id)));
    refreshActions();
    try {
      const image = asset.image || await client.image(asset.id);
      if (version !== selectionVersion) return;
      selectedImage = image;
      preview.src = image;
      refreshActions();
    } catch (error) { if (version === selectionVersion) status.textContent = error.message; }
  }

  function render() {
    grid.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase();
    const visible = [...pending.filter(asset => asset.kind === kind), ...items].filter(asset => asset.name.toLocaleLowerCase().includes(query));
    for (const asset of visible) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'library-item';
      button.dataset.assetId = asset.id;
      button.setAttribute('aria-pressed', String(asset.id === selected?.id));
      const image = document.createElement('img');
      image.alt = asset.name;
      image.loading = 'lazy';
      if (asset.image || thumbnails.has(asset.id)) image.src = asset.image || thumbnails.get(asset.id);
      const label = document.createElement('span');
      label.textContent = asset.name;
      const state = document.createElement('small');
      state.textContent = asset.pending ? '未保存 · 可重试' : new Date(asset.created).toLocaleDateString();
      button.append(image, label, state);
      button.addEventListener('click', () => select(asset));
      grid.append(button);
    }
    root.querySelector('#library-empty').hidden = visible.length > 0;
    root.querySelector('#library-empty').textContent = query ? '没有匹配的图片' : '暂无图片';
    refreshActions();
  }

  async function load(more = false) {
    const version = ++generation;
    status.textContent = '正在读取…';
    if (!more) { items = []; releaseThumbnails(); }
    try {
      const data = await client.list(kind, more ? items.length : 0);
      if (version !== generation) return;
      items.push(...data.items);
      total = data.total;
      render();
      status.textContent = `${names[kind]} · ${total} 张${pending.length ? ` · ${pending.length} 张尚未保存` : ''}`;
      for (const asset of data.items) {
        const blob = await client.blob(asset.id, true);
        if (version !== generation || !dialog.open) return;
        const url = URL.createObjectURL(blob);
        thumbnails.set(asset.id, url);
        const image = grid.querySelector(`[data-asset-id="${asset.id}"] img`);
        if (image) image.src = url;
      }
    } catch (error) {
      if (version === generation) { render(); status.textContent = error.message; }
    }
  }

  function setKind(next) {
    kind = next;
    selected = null;
    selectedImage = null;
    selectionVersion++;
    detail.hidden = true;
    preview.removeAttribute('src');
    search.value = '';
    root.querySelectorAll('[data-library-kind]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.libraryKind === kind)));
    load();
  }

  function open(next = kind, callback = null) {
    picker = callback;
    if (!dialog.open) dialog.showModal();
    setKind(next);
  }

  function retain(kind, image, name) {
    const asset = { id: crypto.randomUUID(), kind, image, name, pending: true, created: new Date().toISOString() };
    pending.unshift(asset);
    if (dialog.open) render();
    return asset;
  }

  async function save(kind, image, name) {
    saves++;
    try {
      const asset = await client.add(kind, image, name);
      if (dialog.open) load();
      return asset;
    } catch (error) {
      retain(kind, image, name);
      throw new Error(`${error.message} 图片暂留相册“未保存”项，可重试或下载；请勿刷新。`);
    } finally { saves--; }
  }

  async function action(run) {
    if (busy || !selectedImage) return;
    busy = true;
    refreshActions();
    try { await run(); } catch (error) { status.textContent = error.message; }
    finally { busy = false; refreshActions(); }
  }

  root.querySelector('#library-open').addEventListener('click', () => open());
  root.querySelector('#library-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { generation++; selectionVersion++; releaseThumbnails(); preview.removeAttribute('src'); selectedImage = null; picker = null; });
  root.querySelectorAll('[data-library-kind]').forEach(button => button.addEventListener('click', () => { if (!busy) setKind(button.dataset.libraryKind); }));
  root.querySelector('#library-refresh').addEventListener('click', () => load());
  root.querySelector('#library-more').addEventListener('click', () => load(true));
  search.addEventListener('input', render);
  root.querySelector('#library-download').addEventListener('click', () => {
    if (!selectedImage) return;
    const link = document.createElement('a');
    link.download = selected.name;
    link.href = selectedImage;
    link.click();
  });
  root.querySelector('#library-use').addEventListener('click', () => action(async () => {
    if (selected.pending && (picker || ['person', 'garment'].includes(selected.kind))) throw new Error('请先重试保存此素材。');
    await (picker || onUse)(selected, selectedImage);
    dialog.close();
  }));
  root.querySelector('#library-delete').addEventListener('click', () => action(async () => {
    const asset = selected;
    if (!confirm(`永久删除“${asset.name}”？此操作不可撤销。`)) return;
    if (asset.pending) pending.splice(pending.indexOf(asset), 1);
    else await client.remove(asset.id);
    await onDelete(asset.id);
    setKind(kind);
  }));
  root.querySelector('#library-retry').addEventListener('click', () => action(async () => {
    const asset = selected;
    const saved = await client.add(asset.kind, asset.image, asset.name);
    pending.splice(pending.indexOf(asset), 1);
    await load();
    await select(saved);
    status.textContent = '已保存';
  }));
  const input = root.querySelector('#library-input');
  root.querySelector('#library-upload').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file || busy) return;
    busy = true;
    refreshActions();
    const targetKind = kind;
    try {
      const limit = ['photo', 'result'].includes(targetKind) ? 32 : 8;
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > limit * 1024 * 1024) throw new Error(`仅支持 ${limit} MB 以内的 PNG/JPG。`);
      const image = await imageDataUrl(file);
      const asset = await client.add(targetKind, image, file.name.slice(0, 160));
      await load();
      await select(asset);
      status.textContent = '素材已保存';
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; refreshActions(); }
  });
  return { open, save, retain, get hasPending() { return pending.length > 0 || busy || saves > 0; }, refresh: () => { if (dialog.open) load(); } };
}