import { validShot } from './shot-presets';
import { imageDataUrl } from './library-client';
import type { ShotCategory, ShotLibrary, ShotPreset } from './scene-types';

const errors: Record<string, string> = {
  vision_not_configured: '未配置视觉分析模型，请检查本机 .env。',
  single_person_required: '图片必须且只能包含一人，请更换图片。',
  invalid_image: '图片无效，请选择 8 MB、1600 万像素以内的 PNG/JPG。',
  invalid_result: 'AI 返回的配置不完整或参数越界，未应用或保存。',
  azure_rejected: '模型拒绝了请求，或不支持图片输入与 JSON 输出。',
  azure_auth: 'AI 鉴权失败，请检查本机配置。', azure_forbidden: '当前 AI 配置没有访问权限。',
  azure_deployment: '找不到配置的视觉分析部署。', azure_rate_limit: 'AI 服务限流，请稍后手动重试。',
  azure_timeout: 'AI 请求超时，可能仍会计费；未自动重试。',
  azure_network: '无法连接 AI 服务，未自动重试。', azure_failed: 'AI 服务请求失败，未自动重试。',
  busy: '已有 AI 请求正在执行，请稍后再试。', invalid_token: '服务已重启，请刷新页面。',
};

interface SourceImage { image: string; sourceName: string; thumbnail: string }
interface VisionConfig { configured: boolean; token?: string; deployment?: string }
export interface ShotState {
  items: ShotPreset[];
  selectedId: string;
  category: ShotCategory | '';
  draft: ShotPreset | null;
  source: SourceImage | null;
  config: VisionConfig | null;
  configStatus: string;
  status: string;
  libraryStatus: string;
  consent: boolean;
  busy: boolean;
  imageLoading: boolean;
  loaded: boolean;
}

export interface ShotModelOptions {
  client: {
    settings(name: 'shots'): Promise<unknown>;
    saveSettings(name: 'shots', value: ShotLibrary): Promise<void>;
  };
  apply(preset: ShotPreset): void | Promise<void>;
  isAvailable(): boolean;
  builtIns?: ShotPreset[];
  request?: typeof fetch;
  confirmDelete?(message: string): boolean;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isShot = (value: unknown): value is ShotPreset => validShot(value);
const isLibrary = (value: unknown): value is ShotLibrary => record(value) && value.version === 1
  && Array.isArray(value.items) && value.items.length <= 100 && value.items.every(isShot);
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

export function createShotModel(options: ShotModelOptions) {
  const builtIns = structuredClone(options.builtIns ?? []);
  const builtInIds = new Set(builtIns.map(item => item.id));
  if (!builtIns.every(isShot) || builtInIds.size !== builtIns.length) throw new Error('内置组合数据无效');
  const request = options.request ?? fetch;
  const listeners = new Set<() => void>();
  let disposed = false;
  let imageVersion = 0;
  let configVersion = 0;
  let state: ShotState = {
    items: [], selectedId: builtIns[0]?.id ?? '', category: '', draft: null, source: null,
    config: null, configStatus: '正在读取配置', status: '', libraryStatus: '',
    consent: false, busy: false, imageLoading: false, loaded: false,
  };
  function update(patch: Partial<ShotState>) {
    if (disposed) return;
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  }
  const all = () => [...builtIns, ...state.items];
  const visible = () => all().filter(item => !state.category || item.category === state.category);
  const selected = () => visible().find(item => item.id === state.selectedId);
  function selectVisible(selectedId = state.selectedId) {
    const entries = visible();
    update({ selectedId: entries.some(item => item.id === selectedId) ? selectedId : entries[0]?.id ?? '' });
  }
  async function load() {
    try {
      const saved = await options.client.settings('shots');
      if (saved != null && (!isLibrary(saved)
        || saved.items.some(item => builtInIds.has(item.id))
        || new Set(saved.items.map(item => item.id)).size !== saved.items.length)) {
        throw new Error('预设库数据无效，未覆盖原数据。');
      }
      update({ items: saved ? saved.items : [], loaded: true });
      selectVisible();
    } catch (error) { update({ libraryStatus: message(error, '无法读取预设库。') }); }
  }
  async function refreshConfig() {
    const version = ++configVersion;
    try {
      const response = await request('/api/ai/analyze/status');
      if (!response.ok) throw new Error('无法读取 AI 配置，请确认服务已更新。');
      const config: unknown = await response.json();
      if (!record(config) || typeof config.configured !== 'boolean'
        || (config.configured && (typeof config.token !== 'string' || typeof config.deployment !== 'string'))) {
        throw new Error('AI 配置响应无效。');
      }
      if (version !== configVersion) return;
      update({ config: { configured: config.configured,
        token: typeof config.token === 'string' ? config.token : undefined,
        deployment: typeof config.deployment === 'string' ? config.deployment : undefined },
        configStatus: config.configured ? `视觉模型：${config.deployment}` : '未配置视觉分析模型' });
    } catch (error) {
      if (version === configVersion) update({ config: null, configStatus: message(error, '无法读取 AI 配置。') });
    }
  }
  async function upload(file: File) {
    if (state.busy || disposed) return;
    const version = ++imageVersion;
    update({ source: null, draft: null, consent: false, imageLoading: true, status: '' });
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 8 * 1024 * 1024 || file.name.length > 160) throw new Error(errors.invalid_image);
      const bitmap = await createImageBitmap(file);
      let thumbnail: string;
      try {
        if (bitmap.width * bitmap.height > 16_000_000) throw new Error(errors.invalid_image);
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error(errors.invalid_image);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        thumbnail = canvas.toDataURL('image/jpeg', 0.8);
      } finally { bitmap.close(); }
      const image = await imageDataUrl(file);
      if (version === imageVersion) update({ source: { image, sourceName: file.name, thumbnail } });
    } catch (error) {
      if (version === imageVersion) update({ status: message(error, errors.invalid_image) });
    } finally { if (version === imageVersion) update({ imageLoading: false }); }
  }
  async function generate() {
    if (disposed || state.busy || !state.source || !state.config?.configured || !state.consent) return;
    const { source, config } = state;
    update({ busy: true, draft: null, status: 'AI 正在分析单人图片…' });
    try {
      const response = await request('/api/ai/analyze', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Studio-Token': config.token ?? '' },
        body: JSON.stringify({ image: source.image, sourceName: source.sourceName, consent: true }) });
      const data: unknown = await response.json();
      if (!response.ok) throw new Error(record(data) && typeof data.error === 'string' ? errors[data.error] ?? '分析失败，未自动重试。' : '分析失败，未自动重试。');
      const result = record(data) && record(data.preset) ? { ...data.preset, thumbnail: source.thumbnail } : null;
      if (!isShot(result) || all().some(item => item.id === result.id)) throw new Error(errors.invalid_result);
      update({ draft: result, status: '已生成，尚未应用或保存。' });
    } catch (error) { update({ status: message(error, '连接中断，未自动重试。') }); }
    finally { update({ busy: false, consent: false }); }
  }
  async function applyPreset(item: ShotPreset | null | undefined) {
    if (disposed || !item || state.busy || !options.isAvailable()) return;
    if (!isShot(item)) { update({ status: errors.invalid_result }); return; }
    update({ busy: true });
    try { await options.apply(structuredClone(item)); }
    catch { update({ status: '无法应用配置，未保存预设。' }); }
    finally { update({ busy: false }); }
  }
  async function saveDraft() {
    if (disposed || state.busy || !state.draft || !state.loaded || state.items.length >= 100) return;
    const item = { ...state.draft, name: state.draft.name.trim() };
    if (!isShot(item)) { update({ status: '请填写有效的预设名称与分类。' }); return; }
    update({ busy: true });
    try {
      const next = [...state.items, item];
      await options.client.saveSettings('shots', { version: 1, items: next });
      update({ items: next, draft: null, category: item.category, selectedId: item.id, status: '预设已保存到本机。' });
    } catch (error) { update({ status: message(error, '预设保存失败。') }); }
    finally { update({ busy: false }); }
  }
  async function removeSelected() {
    const item = selected();
    if (disposed || state.busy || !state.loaded || !item || builtInIds.has(item.id)) return;
    if (!(options.confirmDelete ?? window.confirm)(`删除预设“${item.name}”？此操作不能撤销。`)) return;
    update({ busy: true });
    try {
      const next = state.items.filter(entry => entry.id !== item.id);
      await options.client.saveSettings('shots', { version: 1, items: next });
      update({ items: next, libraryStatus: '预设已删除。' });
      selectVisible();
    } catch (error) { update({ libraryStatus: message(error, '预设删除失败。') }); }
    finally { update({ busy: false }); }
  }
  return {
    builtIns, builtInIds, ready: Promise.all([load(), refreshConfig()]),
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    visible, selected, refreshConfig, upload, generate, saveDraft, removeSelected,
    applySelected: () => applyPreset(selected()), previewDraft: () => applyPreset(state.draft),
    setCategory(category: ShotCategory | '') { update({ category }); selectVisible(); },
    select(selectedId: string) { selectVisible(selectedId); },
    setConsent(consent: boolean) { if (!state.busy) update({ consent }); },
    editDraft(patch: Partial<Pick<ShotPreset, 'name' | 'category'>>) {
      if (state.draft && !state.busy) update({ draft: { ...state.draft, ...patch } });
    },
    dispose() { disposed = true; imageVersion++; configVersion++; listeners.clear(); },
  };
}

export type ShotModel = ReturnType<typeof createShotModel>;