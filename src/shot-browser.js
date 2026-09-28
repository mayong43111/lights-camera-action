import { SHOT_CATEGORIES, validShot } from './shot-presets.js';
import { imageDataUrl } from './library-client.js';

const errors = {
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

export function createShotBrowser({ root, client, apply, isAvailable, builtIns = [], request = fetch, confirmDelete = message => window.confirm(message) }) {
  const builtInItems = structuredClone(builtIns);
  const builtInIds = new Set(builtInItems.map(item => item.id));
  if (!builtInItems.every(validShot) || builtInIds.size !== builtInItems.length) throw new Error('内置组合数据无效');
  root.innerHTML = `
    <section class="tool-section">
      <div class="section-heading"><span>PRESETS</span><h2>配置预设</h2></div>
      <select id="shot-category" aria-label="预设分类"><option value="">全部分类</option></select>
      <select id="shot-select" size="5" aria-label="配置预设列表"></select>
      <p id="shot-empty">暂无预设</p>
      <img id="shot-preview" class="shot-preview" alt="预设预览图" hidden>
      <p id="shot-notes" class="shot-notes"></p>
      <div class="prop-toolbar"><output id="shot-count">0 / 100</output>
        <button class="icon-button" id="shot-apply" type="button" title="应用预设，替换姿势、道具、镜头和灯光" aria-label="应用配置预设" disabled><i data-lucide="clapperboard"></i></button>
        <button class="icon-button" id="shot-delete" type="button" title="删除预设" aria-label="删除预设" disabled><i data-lucide="trash-2"></i></button></div>
      <p id="shot-library-status" role="status"></p>
    </section>
    <section class="tool-section">
      <div class="section-heading"><span>AI</span><h2>图片生成预设</h2><button class="icon-button" id="shot-config-refresh" type="button" title="重新读取 AI 配置" aria-label="重新读取 AI 配置"><i data-lucide="refresh-cw"></i></button></div>
      <p id="shot-ai-config" role="status">正在读取配置</p>
      <button class="button" id="shot-upload" type="button"><i data-lucide="image-plus"></i>上传单人图片</button>
      <input id="shot-source-input" type="file" accept="image/png,image/jpeg" hidden>
      <img id="shot-source-preview" class="shot-preview" alt="待分析的单人参考图" hidden>
      <p id="shot-source-name" class="shot-notes"></p>
      <label class="shot-consent"><input id="shot-consent" type="checkbox">我有权使用此图，同意上传至配置的 AI 服务并承担可能的费用</label>
      <button class="button" id="shot-generate" type="button" disabled><i data-lucide="scan-eye"></i>分析生成</button>
      <p id="shot-ai-status" role="status" aria-live="polite"></p>
      <fieldset id="shot-result" hidden><legend>生成结果 · 待确认</legend>
        <label>名称<input id="shot-name" type="text" maxlength="80"></label>
        <label>分类<select id="shot-result-category"></select></label>
        <p id="shot-result-notes" class="shot-notes"></p>
        <div class="prop-toolbar"><button class="icon-button" id="shot-preview-result" type="button" title="在场景中预览，替换当前姿势、道具、镜头和灯光" aria-label="预览生成配置"><i data-lucide="eye"></i></button>
        <button class="button" id="shot-save-result" type="button"><i data-lucide="save"></i>保存预设</button></div>
      </fieldset>
    </section>`;
  const get = selector => root.querySelector(selector);
  let items = [];
  let draft = null;
  let source = null;
  let config = null;
  let busy = false;
  let loaded = false;
  let imageVersion = 0;
  const list = get('#shot-select');
  const category = get('#shot-category');
  SHOT_CATEGORIES.forEach(name => {
    category.add(new Option(name, name));
    get('#shot-result-category').add(new Option(name, name));
  });
  const allItems = () => [...builtInItems, ...items];
  const selected = () => allItems().find(item => item.id === list.value);
  const report = message => { get('#shot-ai-status').textContent = message; };
  function sync() {
    get('#shot-generate').disabled = busy || !source || !config?.configured || !get('#shot-consent').checked;
    ['#shot-upload', '#shot-source-input', '#shot-consent', '#shot-config-refresh', '#shot-name', '#shot-result-category'].forEach(selector => { get(selector).disabled = busy; });
    get('#shot-save-result').disabled = busy || !draft || !loaded || items.length >= 100;
    get('#shot-preview-result').disabled = busy || !draft;
    get('#shot-apply').disabled = busy || !selected();
    get('#shot-delete').disabled = busy || !selected() || builtInIds.has(list.value);
    root.setAttribute('aria-busy', String(busy));
  }
  function showSelection() {
    const item = selected();
    get('#shot-preview').hidden = !item;
    if (item) get('#shot-preview').src = item.thumbnail;
    else get('#shot-preview').removeAttribute('src');
    get('#shot-notes').textContent = item ? `${item.sourceName}\n${item.notes}` : '';
    sync();
  }
  function render(selectedId = list.value) {
    const visible = allItems().filter(item => !category.value || item.category === category.value);
    if (builtInItems.length) {
      list.replaceChildren();
      for (const [label, isBuiltIn] of [['内置手动组合', true], ['个人预设', false]]) {
        const entries = visible.filter(item => builtInIds.has(item.id) === isBuiltIn);
        if (!entries.length) continue;
        const group = document.createElement('optgroup');
        group.label = label;
        group.append(...entries.map(item => new Option(item.name, item.id)));
        list.append(group);
      }
    } else list.replaceChildren(...visible.map(item => new Option(item.name, item.id)));
    list.value = visible.some(item => item.id === selectedId) ? selectedId : visible[0]?.id ?? '';
    get('#shot-empty').hidden = visible.length > 0;
    get('#shot-count').value = `${builtInItems.length ? `内置 ${builtInItems.length} · 自存 ` : ''}${items.length} / 100`;
    showSelection();
  }
  async function refreshConfig() {
    try {
      const response = await request('/api/ai/analyze/status');
      if (!response.ok) throw new Error('无法读取 AI 配置，请确认服务已更新。');
      config = await response.json();
      get('#shot-ai-config').textContent = config.configured ? `视觉模型：${config.deployment}` : '未配置视觉分析模型';
    } catch (error) { config = null; get('#shot-ai-config').textContent = error.message; }
    sync();
  }
  async function load() {
    try {
      const saved = await client.settings('shots');
      if (saved != null && (saved.version !== 1 || !Array.isArray(saved.items) || saved.items.length > 100 || !saved.items.every(validShot)
        || saved.items.some(item => builtInIds.has(item.id))
        || new Set(saved.items.map(item => item.id)).size !== saved.items.length)) throw new Error('预设库数据无效，未覆盖原数据。');
      items = saved?.items ?? [];
      loaded = true;
      render();
    } catch (error) { get('#shot-library-status').textContent = error.message; }
  }
  async function applyPreset(item) {
    if (!item || !isAvailable() || busy) return;
    if (!validShot(item)) { report(errors.invalid_result); return; }
    try { await apply(item); }
    catch { report('无法应用配置，未保存预设。'); }
  }
  category.addEventListener('change', () => render());
  list.addEventListener('change', showSelection);
  get('#shot-apply').addEventListener('click', () => applyPreset(selected()));
  get('#shot-config-refresh').addEventListener('click', refreshConfig);
  get('#shot-upload').addEventListener('click', () => get('#shot-source-input').click());
  get('#shot-consent').addEventListener('change', sync);
  get('#shot-source-input').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file || busy) return;
    const version = ++imageVersion;
    source = null; draft = null;
    get('#shot-consent').checked = false;
    get('#shot-result').hidden = true;
    get('#shot-source-preview').hidden = true;
    get('#shot-source-name').textContent = '';
    report(''); sync();
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 8 * 1024 * 1024 || file.name.length > 160) throw new Error(errors.invalid_image);
      const bitmap = await createImageBitmap(file);
      let thumbnail;
      try {
        if (bitmap.width * bitmap.height > 16000000) throw new Error(errors.invalid_image);
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        thumbnail = canvas.toDataURL('image/jpeg', 0.8);
      } finally { bitmap.close(); }
      const image = await imageDataUrl(file);
      if (version !== imageVersion) return;
      source = { image, sourceName: file.name, thumbnail };
      get('#shot-source-preview').src = thumbnail;
      get('#shot-source-preview').hidden = false;
      get('#shot-source-name').textContent = file.name;
    } catch (error) { if (version === imageVersion) report(error.message || errors.invalid_image); }
    event.target.value = '';
    sync();
  });
  get('#shot-generate').addEventListener('click', async () => {
    if (busy || !source || !config?.configured || !get('#shot-consent').checked) return;
    busy = true; draft = null;
    get('#shot-result').hidden = true;
    report('AI 正在分析单人图片…'); sync();
    try {
      const response = await request('/api/ai/analyze', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Studio-Token': config.token },
        body: JSON.stringify({ image: source.image, sourceName: source.sourceName, consent: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(errors[data.error] || '分析失败，未自动重试。');
      const result = { ...data.preset, thumbnail: source.thumbnail };
      if (!validShot(result)) throw new Error(errors.invalid_result);
      draft = result;
      get('#shot-name').value = draft.name;
      get('#shot-result-category').value = draft.category;
      get('#shot-result-notes').textContent = draft.notes;
      get('#shot-result').hidden = false;
      report('已生成，尚未应用或保存。');
    } catch (error) { report(error.message || '连接中断，未自动重试。'); }
    finally { busy = false; get('#shot-consent').checked = false; sync(); }
  });
  get('#shot-preview-result').addEventListener('click', () => applyPreset(draft));
  get('#shot-save-result').addEventListener('click', async () => {
    if (busy || !draft || !loaded || items.length >= 100) return;
    const item = { ...draft, name: get('#shot-name').value.trim(), category: get('#shot-result-category').value };
    if (!validShot(item)) { report('请填写有效的预设名称与分类。'); return; }
    busy = true; sync();
    try {
      const next = [...items, item];
      await client.saveSettings('shots', { version: 1, items: next });
      items = next; draft = null;
      category.value = item.category;
      get('#shot-result').hidden = true;
      render(item.id); report('预设已保存到本机。');
    } catch (error) { report(error.message); }
    finally { busy = false; sync(); }
  });
  get('#shot-delete').addEventListener('click', async () => {
    const item = selected();
    if (busy || !item || builtInIds.has(item.id) || !confirmDelete(`删除预设“${item.name}”？此操作不能撤销。`)) return;
    busy = true; sync();
    try {
      const next = items.filter(entry => entry.id !== item.id);
      await client.saveSettings('shots', { version: 1, items: next });
      items = next; render(); get('#shot-library-status').textContent = '预设已删除。';
    } catch (error) { get('#shot-library-status').textContent = error.message; }
    finally { busy = false; sync(); }
  });
  const beforeUnload = event => { if (busy || draft) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  render();
  const ready = Promise.all([load(), refreshConfig()]);
  return { ready, dispose() { imageVersion++; window.removeEventListener('beforeunload', beforeUnload); } };
}