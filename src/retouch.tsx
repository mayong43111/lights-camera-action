import { Button, Input } from 'antd';
import { Camera, Download, Eraser, ImagePlus, Images, RefreshCw, Replace, Shirt, Trash2, UserRoundPlus, WandSparkles, X } from 'lucide-react';
import { createImagePreview } from './image-preview';
import { requiredElement } from './dom';
import type { ViewHost } from './react-view';
import { imageDataUrl, LibraryError } from './library-client';
import type { LibraryClient } from './library-client';
import type { createLibrary, LibraryAsset } from './library';
import { isRecord } from './schema-utils';

const referenceKinds = ['reference', 'garment'] as const;
type ReferenceKind = typeof referenceKinds[number];
interface Photo { image: string; name: string }
interface RetouchConfig { configured: boolean; deployment: string; token: string }
const defaultPrompt = '生成自然真实的服装摄影作品。以原图为姿势、身体比例、构图、拍摄角度和光照依据；使用人物图的面部特征和发型，使用服装图的款式、颜色、面料、图案与细节，让服装自然贴合原图姿态，形成合理的褶皱与阴影。不要照搬参考图的姿势、背景或服装图中模特的脸。保持手部结构自然。未上传人物图时保留原图人物；未上传服装图时沿用人物图的衣着，没有人物图则保留原图衣着。';
const messages: Record<string, string> = {
  not_configured: 'Azure 未配置，请填写本地 .env 后重新检查配置。',
  invalid_image: '图片无效。仅支持 8 MB 以内、1600 万像素以内的 PNG/JPG。',
  invalid_prompt: '请输入 1 至 4000 字的修图要求。',
  invalid_options: '修图参数无效，请重新选择。',
  invalid_request: '请求无效，请重新打开修图窗口。',
  request_too_large: '图片总大小超出限制，请缩小图片后重试。',
  invalid_token: '服务已重启，请重新检查配置后再生成。',
  invalid_origin: '修图请求来源不被允许，请通过本地服务打开。',
  busy: '已有修图任务正在处理，请稍后再试。',
  azure_auth: 'Azure 密钥无效，请检查 .env 中的密钥。',
  azure_forbidden: 'Azure 拒绝访问，请检查资源权限与模型访问资格。',
  azure_deployment: '未找到 Azure 部署，请核对端点、部署名和 API 版本。',
  azure_rejected: 'Azure 拒绝了请求，请检查提示词、内容限制及部署支持的参数。',
  azure_rate_limit: 'Azure 配额或速率受限，请稍后手动重试。',
  azure_timeout: 'Azure 响应超时，任务可能仍在处理并计费；请勿连续重复提交。',
  azure_network: '无法连接 Azure，请检查网络和端点配置。',
  azure_failed: 'Azure 服务暂时不可用，请稍后手动重试。',
  invalid_result: 'Azure 未返回有效图片，请检查模型部署。',
};
const referenceNames = { reference: '人物图', garment: '服装图' };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

async function readImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error(messages.invalid_image);
  let bitmap;
  try { bitmap = await createImageBitmap(file); if (bitmap.width * bitmap.height > 16_000_000) throw new Error(); }
  catch { throw new Error(messages.invalid_image); }
  finally { bitmap?.close(); }
  return imageDataUrl(file);
}

interface RetouchState {
  source: string | null;
  result: string | null;
  references: Record<ReferenceKind, string | null>;
  sourceVersion: number;
  resultSourceVersion: number | null;
  latestPhoto: Photo | null;
  photoName: string;
  view: 'source' | 'result';
  busy: boolean;
  loading: boolean;
  checking: boolean;
  preferencesReady: boolean;
  consent: boolean;
  prompt: string;
  quality: string;
  size: string;
  status: string;
  saveStatus: string;
  configText: string;
  configured: boolean;
}

export function createRetouch(capturePhoto: () => Photo | undefined, { client, library, views, onBusyChange }: {
  client: LibraryClient; library: ReturnType<typeof createLibrary>; views: ViewHost; onBusyChange(busy: boolean): void;
}) {
  const dialog = requiredElement<HTMLDialogElement>('#retouch-dialog');
  const openButton = requiredElement('#retouch-open');
  const imagePreview = createImagePreview(views);
  const model: RetouchState = {
    source: null, result: null, references: { reference: null, garment: null }, sourceVersion: 0, resultSourceVersion: null,
    latestPhoto: null, photoName: '', view: 'source', busy: false, loading: false, checking: false, preferencesReady: false,
    consent: false, prompt: '', quality: 'medium', size: 'auto', status: '等待选择照片', saveStatus: '正在读取本地参数', configText: 'Azure Foundry', configured: false,
  };
  const referenceIds: Record<`${ReferenceKind}Id`, string | null> = { referenceId: null, garmentId: null };
  let config: RetouchConfig | null = null;
  let disposed = false;
  let reportedBusy = false;
  const requests = new AbortController();
  let preferenceTimer: ReturnType<typeof setTimeout> | undefined;
  let preferenceDirty = false;
  let preferenceSaves = 0;
  let preferenceVersion = 0;
  const snapshot = () => ({ ...model, references: { ...model.references } });
  const renderer = views.mountView(dialog, snapshot(), state => {
    const image = state.view === 'result' ? state.result : state.source;
    const alt = state.view === 'result' ? 'AI 修图结果' : '修图原图';
    const locked = state.busy || state.loading;
    const fieldsDisabled = locked || !state.preferencesReady;
    return <>
      <header className="retouch-header"><div><h2 id="retouch-title">AI 修图</h2><span id="retouch-config">{state.configText}</span></div><div className="retouch-actions">
        <Button className="icon-button" id="retouch-config-refresh" title="重新检查配置" aria-label="重新检查配置" icon={<RefreshCw size={16} />} disabled={state.busy || state.checking} onClick={() => void checkConfig()} />
        <Button className="icon-button" id="retouch-close" title="关闭修图窗口" aria-label="关闭修图窗口" icon={<X size={16} />} onClick={() => dialog.close()} />
      </div></header>
      <div className="retouch-workspace" aria-busy={state.busy}><section className="retouch-image-area" aria-label="照片预览">
        <div className="retouch-image-toolbar"><div className="retouch-tabs" role="tablist" aria-label="修图预览">
          {(['source', 'result'] as const).map(value => <Button key={value} id={value === 'source' ? 'retouch-original-tab' : 'retouch-result-tab'} role="tab" data-retouch-view={value}
            aria-selected={state.view === value} aria-controls="retouch-preview" disabled={value === 'result' && !state.result}
            onClick={() => { model.view = value; refresh(); }} onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' || !model.result ? 'source' : event.key === 'End' ? 'result' : model.view === 'source' ? 'result' : 'source';
              model.view = next; refresh(); requiredElement(next === 'source' ? '#retouch-original-tab' : '#retouch-result-tab', dialog).focus();
            }}>{value === 'source' ? '原图' : state.result && state.resultSourceVersion !== state.sourceVersion ? '上次修图结果' : '修图结果'}</Button>)}
        </div><div className="retouch-actions">
          <Button className="icon-button" id="retouch-latest" title="使用最近拍摄的照片" aria-label="使用最近拍摄的照片" icon={<Camera size={16} />} disabled={!state.latestPhoto || locked}
            onClick={() => { if (model.latestPhoto) setSource(model.latestPhoto.image, model.latestPhoto.name); }} />
          <Button className="icon-button" id="retouch-source-import" title="导入原图" aria-label="导入原图" icon={<ImagePlus size={16} />} disabled={locked} onClick={() => fileInput('source').click()} />
        </div></div>
        <div className="retouch-preview" id="retouch-preview" role="tabpanel" aria-labelledby={state.view === 'result' ? 'retouch-result-tab' : 'retouch-original-tab'}>
          <button type="button" className="retouch-image-open" id="retouch-preview-open" title={`放大预览${alt}`} aria-label={`放大预览${alt}`} hidden={!image}
            onClick={() => void imagePreview.open(image ?? '', alt)}><img id="retouch-preview-image" alt={alt} hidden={!image} src={image ?? undefined} /></button>
          <p id="retouch-empty" hidden={!!image}>尚无照片</p>
        </div><div className="retouch-image-footer"><span id="retouch-photo-name">{state.photoName || '未选择原图'}</span>
          <Button className="icon-button" id="retouch-download" title="下载修图结果" aria-label="下载修图结果" icon={<Download size={16} />} disabled={!state.result} onClick={download} />
          <Button className="icon-button" id="retouch-continue" title="以结果继续修图" aria-label="以结果继续修图" icon={<Replace size={16} />} disabled={!state.result || locked} onClick={() => setSource(model.result, '上次修图结果')} />
        </div><input type="file" id="retouch-source-input" accept="image/png,image/jpeg" hidden onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload('source', file);
        }} />
      </section>
      <form id="retouch-form" className="retouch-settings" onSubmit={event => { event.preventDefault(); void generate(); }}>
        <fieldset id="retouch-fields" disabled={fieldsDisabled}>
          <label htmlFor="retouch-prompt">修图要求</label><div className="retouch-prompt-field">
            <Input.TextArea id="retouch-prompt" rows={5} maxLength={4000} placeholder={defaultPrompt} value={state.prompt} disabled={fieldsDisabled}
              onChange={event => { model.prompt = event.target.value; schedulePreferences(); refresh(); }} />
            <div className="retouch-prompt-actions"><Button className="icon-button" id="retouch-prompt-clear" title="清空修图要求" aria-label="清空修图要求" icon={<Eraser size={16} />}
              disabled={fieldsDisabled || !state.prompt} onClick={() => { model.prompt = ''; schedulePreferences(); refresh(); requiredElement('#retouch-prompt', dialog).focus(); }} /></div>
          </div><div className="retouch-references">{referenceKinds.map(kind => {
            const reference = state.references[kind];
            const name = referenceNames[kind];
            return <div key={kind}><div className="retouch-reference-heading"><label htmlFor={`retouch-${kind}-input`}>{name} <span>可选</span></label><div className="retouch-actions">
              <Button className="icon-button" id={`retouch-${kind}-replace`} title={`更换${name}`} aria-label={`更换${name}`} icon={<ImagePlus size={16} />} hidden={!reference} disabled={fieldsDisabled} onClick={() => fileInput(kind).click()} />
              <Button className="icon-button" id={`retouch-${kind}-clear`} title={`移除${name}`} aria-label={`移除${name}`} icon={<Trash2 size={16} />} disabled={!reference || fieldsDisabled} onClick={() => selectReference(kind, null, null)} />
            </div></div>
              <button type="button" id={`retouch-${kind}-import`} className="retouch-reference" title={`${reference ? '预览' : '添加'}${name}`} aria-label={`${reference ? '预览' : '添加'}${name}`} disabled={fieldsDisabled}
                onClick={() => { if (reference) void imagePreview.open(reference, name); else fileInput(kind).click(); }}>
                <img id={`retouch-${kind}-image`} alt={`${name === '人物图' ? '人物' : '服装'}参考图`} hidden={!reference} src={reference ?? undefined} />
                <span id={`retouch-${kind}-empty`} hidden={!!reference}>{kind === 'reference' ? <UserRoundPlus size={16} /> : <Shirt size={16} />}添加{name}</span>
              </button>
              <Button className="retouch-library-button" id={`retouch-${kind}-library`} icon={<Images size={16} />} disabled={fieldsDisabled}
                onClick={() => library.open(kind === 'reference' ? 'person' : 'garment', (asset, selectedImage) => {
                  if (model.busy || model.loading || disposed) throw new Error('请等待当前修图任务完成。');
                  selectReference(kind, selectedImage, asset.id); model.status = `${name}已选用`; refresh();
                })}>选择已存{kind === 'reference' ? '人物' : '服装'}</Button>
              <input type="file" id={`retouch-${kind}-input`} accept="image/png,image/jpeg" hidden onChange={event => {
                const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(kind, file);
              }} />
            </div>;
          })}</div>
          <div className="retouch-options"><label htmlFor="retouch-quality">质量<select id="retouch-quality" value={state.quality} onChange={event => { model.quality = event.target.value; schedulePreferences(); refresh(); }}>
            <option value="low">快速</option><option value="medium">标准</option><option value="high">高质量</option>
          </select></label><label htmlFor="retouch-size">尺寸<select id="retouch-size" value={state.size} onChange={event => { model.size = event.target.value; schedulePreferences(); refresh(); }}>
            <option value="auto">自动</option><option value="1024x1024">1024 × 1024</option><option value="1536x1024">1536 × 1024</option><option value="1024x1536">1024 × 1536</option>
          </select></label></div>
          <label className="check-control retouch-consent"><input id="retouch-consent" type="checkbox" required checked={state.consent} onChange={event => { model.consent = event.target.checked; refresh(); }} />同意上传原图及已选人物图、服装图至 Azure（按量计费）</label>
        </fieldset><p id="retouch-save-status" role="status">{state.saveStatus}</p>
        <Button className="button button-light" id="retouch-generate" htmlType="submit" icon={<WandSparkles size={16} />}
          disabled={locked || state.checking || !state.preferencesReady || !state.source || !state.consent || !state.configured}><span>{state.busy ? '生成中…' : '生成修图'}</span></Button>
        <p id="retouch-status" role="status" aria-live="polite">{state.status}</p>
      </form></div>
    </>;
  });
  function refresh() {
    if (disposed) return;
    if (reportedBusy !== model.busy) {
      reportedBusy = model.busy;
      onBusyChange(model.busy);
    }
    renderer.update(snapshot());
  }
  function fileInput(kind: 'source' | ReferenceKind) { return requiredElement<HTMLInputElement>(`#retouch-${kind}-input`, dialog); }
  async function savePreferences() {
    clearTimeout(preferenceTimer); preferenceTimer = undefined;
    if (!model.preferencesReady) throw new Error('修图配置尚未读取，请刷新页面后重试。');
    const version = preferenceVersion;
    preferenceSaves++; model.saveStatus = '正在保存参数'; refresh();
    try {
      await client.saveSettings('retouch', { prompt: model.prompt, quality: model.quality, size: model.size, ...referenceIds });
      if (version === preferenceVersion) { preferenceDirty = false; model.saveStatus = '参数与参考图选择已保存'; }
    } catch (error) { model.saveStatus = '参数保存失败'; throw error; }
    finally { preferenceSaves--; refresh(); }
  }
  function schedulePreferences() {
    if (!model.preferencesReady || disposed) return;
    preferenceDirty = true; preferenceVersion++; model.saveStatus = '参数待保存';
    clearTimeout(preferenceTimer);
    preferenceTimer = setTimeout(() => { void savePreferences().catch(error => { model.status = errorMessage(error); refresh(); }); }, 400);
  }
  async function restorePreferences() {
    try {
      const saved = await client.settings('retouch');
      if (disposed) return;
      if (saved) {
        if (!isRecord(saved) || typeof saved.prompt !== 'string' || typeof saved.quality !== 'string' || typeof saved.size !== 'string') throw new Error('修图配置格式无效');
        model.prompt = saved.prompt === defaultPrompt ? '' : saved.prompt; model.quality = saved.quality; model.size = saved.size;
        for (const kind of referenceKinds) {
          const id = saved[`${kind}Id`];
          if (!id) continue;
          if (typeof id !== 'string') throw new Error('参考图片编号无效');
          try {
            const image = await client.image(id);
            if (disposed) return;
            model.references[kind] = image; referenceIds[`${kind}Id`] = id;
          } catch (error) { if (!(error instanceof LibraryError) || error.code !== 'not_found') throw error; }
        }
      }
      model.preferencesReady = true; model.saveStatus = saved ? '已恢复本地参数' : '参数尚未保存';
    } catch (error) { model.saveStatus = '参数读取失败'; model.status = `修图配置读取失败：${errorMessage(error)}`; }
    finally { refresh(); }
  }
  function setSource(image: string | null, name: string, keepResult = false) {
    model.sourceVersion++; model.source = image; model.consent = false; model.photoName = name;
    if (!keepResult) model.result = null;
    model.view = 'source'; model.status = '原图已就绪'; refresh();
  }
  function selectReference(kind: ReferenceKind, image: string | null, id: string | null) {
    model.references[kind] = image; referenceIds[`${kind}Id`] = id; model.consent = false; schedulePreferences(); refresh();
  }
  async function checkConfig() {
    if (model.checking || model.busy || disposed) return;
    model.checking = true; refresh();
    try {
      const response = await fetch('/api/ai/status', { signal: AbortSignal.any([requests.signal, AbortSignal.timeout(10000)]) });
      if (!response.ok) throw new Error();
      const data: unknown = await response.json();
      if (disposed) return;
      if (!isRecord(data) || typeof data.configured !== 'boolean' || typeof data.deployment !== 'string' || typeof data.token !== 'string') throw new Error('AI 配置格式无效');
      config = { configured: data.configured, deployment: data.deployment, token: data.token };
      model.configured = config.configured; model.configText = config.configured ? `Azure · ${config.deployment}` : 'Azure 未配置';
      model.status = !config.configured ? messages.not_configured : model.source ? '已就绪' : '等待选择照片';
    } catch {
      config = null; model.configured = false; model.configText = '本地 AI 服务不可用'; model.status = '请使用更新后的 start.ps1 启动服务。';
    } finally { model.checking = false; refresh(); }
  }
  function open() {
    if (disposed) return;
    try {
      const photo = capturePhoto();
      if (!photo) return;
      model.latestPhoto = photo; setSource(photo.image, photo.name, true); dialog.showModal();
      if (model.busy) model.status = '当前场景已更新，上一张原图仍在生成中…';
      else void checkConfig();
    } catch { setSource(null, '', true); dialog.showModal(); model.status = '当前场景拍摄失败，请关闭窗口后重试。'; }
    refresh();
  }
  async function upload(kind: 'source' | ReferenceKind, file: File) {
    if (model.busy || model.loading || disposed) return;
    model.loading = true;
    const version = model.sourceVersion;
    refresh();
    try {
      const image = await readImage(file);
      if (disposed) return;
      const asset = await library.save(kind === 'source' ? 'photo' : kind === 'reference' ? 'person' : 'garment', image, file.name.slice(0, 160));
      if (disposed) return;
      if (kind === 'source') { if (model.sourceVersion === version) setSource(image, file.name); }
      else { selectReference(kind, image, asset.id); model.status = `${referenceNames[kind]}已存入素材库`; }
    } catch (error) { model.status = errorMessage(error); }
    finally { model.loading = false; refresh(); }
  }
  function download() {
    if (!model.result) return;
    const link = document.createElement('a'); link.href = model.result; link.download = `studio-retouched-${Date.now()}.png`; link.click();
  }
  async function generate() {
    if (disposed || model.busy || model.loading || model.checking || !model.preferencesReady || !model.source || !model.consent || !config?.configured) return;
    const submittedSourceVersion = model.sourceVersion;
    const token = config.token;
    const body = JSON.stringify({ image: model.source, ...model.references, prompt: model.prompt.trim() || defaultPrompt, quality: model.quality, size: model.size });
    model.busy = true; model.status = '正在等待 Azure 生成图片…'; refresh();
    try {
      await savePreferences();
      if (disposed) return;
      const response = await fetch('/api/ai/edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token },
        body, signal: AbortSignal.any([requests.signal, AbortSignal.timeout(255000)]) });
      const data: unknown = await response.json();
      if (disposed) return;
      if (!isRecord(data)) throw new Error(messages.invalid_result);
      if (!response.ok) throw new Error(typeof data.error === 'string' ? messages[data.error] || '修图失败，请稍后手动重试。' : '修图失败，请稍后手动重试。');
      if (typeof data.image !== 'string' || !data.image.startsWith('data:image/png;base64,')) throw new Error(messages.invalid_result);
      const decoded = new Image(); decoded.src = data.image; await decoded.decode();
      if (disposed) return;
      model.result = data.image; model.resultSourceVersion = submittedSourceVersion;
      let saved = true;
      if (data.storageError) { library.retain('result', model.result, `studio-retouched-${Date.now()}.png`); saved = false; }
      else if (!data.asset) { try { await library.save('result', model.result, `studio-retouched-${Date.now()}.png`); } catch { saved = false; } }
      if (disposed) return;
      library.refresh();
      if (model.sourceVersion === submittedSourceVersion) {
        model.view = 'result'; model.status = `生成完成 · ${decoded.naturalWidth} × ${decoded.naturalHeight}${saved ? ' · 已存入生成历史' : ' · 保存失败，图片暂留相册，可重试或下载；请勿刷新'}`;
      } else model.status = saved ? '上一张原图修图已完成并存入历史；当前场景原图保持不变。' : '上一张修图已完成但保存失败，请在相册重试或下载，勿刷新。';
    } catch (error) {
      model.status = error instanceof Error && error.name === 'TimeoutError' ? messages.azure_timeout : error instanceof TypeError ? '连接中断，Azure 可能仍在处理并计费；请勿连续重复提交。' : errorMessage(error);
    } finally { model.busy = false; refresh(); }
  }
  const close = () => openButton.focus({ preventScroll: true });
  dialog.addEventListener('close', close);
  const ready = restorePreferences();
  return {
    ready, open,
    get hasPendingChanges() { return preferenceDirty || preferenceSaves > 0 || model.loading || model.busy; },
    async useAsset(asset: LibraryAsset, image: string) {
      await ready;
      if (disposed || model.busy || model.loading || !model.preferencesReady) throw new Error('请等待修图任务完成，或刷新页面恢复配置。');
      if (asset.kind === 'person' || asset.kind === 'garment') {
        selectReference(asset.kind === 'person' ? 'reference' : 'garment', image, asset.id);
        if (!model.source) { const photo = capturePhoto(); if (photo) setSource(photo.image, photo.name, true); }
      } else setSource(image, asset.name, true);
      if (!dialog.open) dialog.showModal();
      void checkConfig(); refresh();
    },
    removeAsset(id: string) { for (const kind of referenceKinds) if (referenceIds[`${kind}Id`] === id) selectReference(kind, null, null); },
    setPhoto(image: string, name: string) { model.latestPhoto = { image, name }; if (!model.busy && !model.loading) setSource(image, name); else refresh(); },
    dispose() {
      if (disposed) return;
      disposed = true; requests.abort(); clearTimeout(preferenceTimer);
      if (reportedBusy) onBusyChange(false);
      dialog.removeEventListener('close', close);
      imagePreview.destroy(); dialog.close(); renderer.dispose();
    },
  };
}