import { createImagePreview } from './image-preview';

const defaultPrompt = '生成自然真实的服装摄影作品。以原图为姿势、身体比例、构图、拍摄角度和光照依据；使用人物图的面部特征和发型，使用服装图的款式、颜色、面料、图案与细节，让服装自然贴合原图姿态，形成合理的褶皱与阴影。不要照搬参考图的姿势、背景或服装图中模特的脸。保持手部结构自然。未上传人物图时保留原图人物；未上传服装图时沿用人物图的衣着，没有人物图则保留原图衣着。';

const messages = {
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

async function readImage(file) {
  if (!file || !['image/png', 'image/jpeg'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error(messages.invalid_image);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 16_000_000) throw new Error();
  } catch {
    throw new Error(messages.invalid_image);
  } finally {
    bitmap?.close();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取图片失败。'));
    reader.readAsDataURL(file);
  });
}

export function createRetouch(capturePhoto, { client, library }) {
  const dialog = document.querySelector('#retouch-dialog');
  const status = document.querySelector('#retouch-status');
  const saveStatus = document.querySelector('#retouch-save-status');
  const prompt = document.querySelector('#retouch-prompt');
  prompt.placeholder = defaultPrompt;
  const clearPrompt = document.querySelector('#retouch-prompt-clear');
  const generate = document.querySelector('#retouch-generate');
  const consent = document.querySelector('#retouch-consent');
  const preview = document.querySelector('#retouch-preview-image');
  const previewOpen = document.querySelector('#retouch-preview-open');
  const imagePreview = createImagePreview();
  let source = null;
  const references = { reference: null, garment: null };
  const referenceIds = { referenceId: null, garmentId: null };
  const referenceNames = { reference: '人物图', garment: '服装图' };
  let result = null;
  let sourceVersion = 0;
  let resultSourceVersion = null;
  let latestPhoto = null;
  let photoName = '';
  let view = 'source';
  let busy = false;
  let loading = false;
  let checking = false;
  let config = null;
  let preferencesReady = false;
  let preferenceTimer = null;
  let preferenceDirty = false;
  let preferenceSaves = 0;
  let preferenceVersion = 0;

  async function savePreferences() {
    clearTimeout(preferenceTimer);
    preferenceTimer = null;
    if (!preferencesReady) throw new Error('修图配置尚未读取，请刷新页面后重试。');
    const version = preferenceVersion;
    preferenceSaves++;
    saveStatus.textContent = '正在保存参数';
    try {
      await client.saveSettings('retouch', { prompt: prompt.value, quality: document.querySelector('#retouch-quality').value,
        size: document.querySelector('#retouch-size').value, ...referenceIds });
      if (version === preferenceVersion) {
        preferenceDirty = false;
        saveStatus.textContent = '参数与参考图选择已保存';
      }
    } catch (error) {
      saveStatus.textContent = '参数保存失败';
      throw error;
    } finally { preferenceSaves--; }
  }

  function schedulePreferences() {
    if (!preferencesReady) return;
    preferenceDirty = true;
    preferenceVersion++;
    saveStatus.textContent = '参数待保存';
    clearTimeout(preferenceTimer);
    preferenceTimer = setTimeout(() => savePreferences().catch(error => { status.textContent = error.message; }), 400);
  }

  async function restorePreferences() {
    try {
      const saved = await client.settings('retouch');
      if (saved) {
        prompt.value = saved.prompt === defaultPrompt ? '' : saved.prompt;
        document.querySelector('#retouch-quality').value = saved.quality;
        document.querySelector('#retouch-size').value = saved.size;
        for (const kind of Object.keys(references)) {
          const id = saved[`${kind}Id`];
          if (!id) continue;
          try {
            references[kind] = await client.image(id);
            referenceIds[`${kind}Id`] = id;
          } catch (error) { if (error.code !== 'not_found') throw error; }
        }
      }
      preferencesReady = true;
      saveStatus.textContent = saved ? '已恢复本地参数' : '参数尚未保存';
    } catch (error) {
      saveStatus.textContent = '参数读取失败';
      status.textContent = `修图配置读取失败：${error.message}`;
    }
    finally { refresh(); }
  }

  function refresh() {
    const image = view === 'result' ? result : source;
    preview.hidden = !image;
    if (image && preview.getAttribute('src') !== image) preview.src = image;
    if (!image) preview.removeAttribute('src');
    preview.alt = view === 'result' ? 'AI 修图结果' : '修图原图';
    previewOpen.hidden = !image;
    previewOpen.title = `放大预览${preview.alt}`;
    previewOpen.setAttribute('aria-label', previewOpen.title);
    document.querySelector('#retouch-empty').hidden = !!image;
    document.querySelector('#retouch-result-tab').textContent = result && resultSourceVersion !== sourceVersion ? '上次修图结果' : '修图结果';
    document.querySelector('#retouch-preview').setAttribute('aria-labelledby', view === 'result' ? 'retouch-result-tab' : 'retouch-original-tab');
    document.querySelectorAll('[data-retouch-view]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.retouchView === view));
      button.disabled = button.dataset.retouchView === 'result' && !result;
    });
    for (const [kind, image] of Object.entries(references)) {
      const referencePreview = document.querySelector(`#retouch-${kind}-image`);
      referencePreview.hidden = !image;
      if (image && referencePreview.getAttribute('src') !== image) referencePreview.src = image;
      if (!image) referencePreview.removeAttribute('src');
      document.querySelector(`#retouch-${kind}-empty`).hidden = !!image;
      const upload = document.querySelector(`#retouch-${kind}-import`);
      const label = `${image ? '预览' : '添加'}${referenceNames[kind]}`;
      upload.setAttribute('aria-label', label);
      upload.title = label;
      document.querySelector(`#retouch-${kind}-clear`).disabled = !image || busy || loading;
      document.querySelector(`#retouch-${kind}-replace`).hidden = !image;
      document.querySelector(`#retouch-${kind}-replace`).disabled = busy || loading;
    }
    document.querySelector('#retouch-fields').disabled = busy || loading || !preferencesReady;
    clearPrompt.disabled = busy || loading || !prompt.value;
    document.querySelector('#retouch-source-import').disabled = busy || loading;
    document.querySelector('#retouch-latest').disabled = !latestPhoto || busy || loading;
    document.querySelector('#retouch-download').disabled = !result;
    document.querySelector('#retouch-continue').disabled = !result || busy || loading;
    document.querySelector('#retouch-config-refresh').disabled = busy || checking;
    document.querySelector('#retouch-photo-name').textContent = photoName || '未选择原图';
    generate.disabled = busy || loading || checking || !preferencesReady || !source || !consent.checked || !config?.configured;
    generate.querySelector('span').textContent = busy ? '生成中…' : '生成修图';
    dialog.setAttribute('aria-busy', String(busy));
    document.querySelector('#retouch-open').classList.toggle('is-working', busy);
  }

  function setSource(image, name, keepResult = false) {
    sourceVersion++;
    source = image;
    consent.checked = false;
    photoName = name;
    if (!keepResult) result = null;
    view = 'source';
    status.textContent = '原图已就绪';
    refresh();
  }

  async function checkConfig() {
    if (checking || busy) return;
    checking = true;
    refresh();
    try {
      const response = await fetch('/api/ai/status', { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error();
      config = await response.json();
      document.querySelector('#retouch-config').textContent = config.configured ? `Azure · ${config.deployment}` : 'Azure 未配置';
      if (!config.configured) status.textContent = messages.not_configured;
      else status.textContent = source ? '已就绪' : '等待选择照片';
    } catch {
      config = null;
      document.querySelector('#retouch-config').textContent = '本地 AI 服务不可用';
      status.textContent = '请使用更新后的 start.ps1 启动服务。';
    } finally {
      checking = false;
      refresh();
    }
  }

  document.querySelector('#retouch-open').addEventListener('click', () => {
    try {
      const photo = capturePhoto();
      if (!photo) return;
      latestPhoto = photo;
      setSource(photo.image, photo.name, true);
      dialog.showModal();
      if (busy) status.textContent = '当前场景已更新，上一张原图仍在生成中…';
      else checkConfig();
    } catch {
      setSource(null, '', true);
      dialog.showModal();
      status.textContent = '当前场景拍摄失败，请关闭窗口后重试。';
    }
  });
  document.querySelector('#retouch-close').addEventListener('click', () => dialog.close());
  previewOpen.addEventListener('click', () => imagePreview.open(view === 'result' ? result : source, preview.alt));
  dialog.addEventListener('close', () => document.querySelector('#retouch-open').focus({ preventScroll: true }));
  document.querySelector('#retouch-config-refresh').addEventListener('click', checkConfig);
  document.querySelector('#retouch-latest').addEventListener('click', () => setSource(latestPhoto.image, latestPhoto.name));
  document.querySelectorAll('[data-retouch-view]').forEach((button) => {
    button.addEventListener('click', () => {
      view = button.dataset.retouchView;
      refresh();
    });
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...document.querySelectorAll('[data-retouch-view]:not(:disabled)')];
      const target = buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (buttons.indexOf(button) + 1) % buttons.length];
      target.focus();
      target.click();
    });
  });
  for (const kind of ['source', 'reference', 'garment']) {
    const input = document.querySelector(`#retouch-${kind}-input`);
    document.querySelector(`#retouch-${kind}-import`).addEventListener('click', () => {
      if (kind !== 'source' && references[kind]) imagePreview.open(references[kind], referenceNames[kind]);
      else input.click();
    });
    if (kind !== 'source') document.querySelector(`#retouch-${kind}-replace`).addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = '';
      if (!file || busy || loading) return;
      loading = true;
      const uploadSourceVersion = sourceVersion;
      refresh();
      try {
        const image = await readImage(file);
        const asset = await library.save(kind === 'source' ? 'photo' : kind === 'reference' ? 'person' : 'garment', image, file.name.slice(0, 160));
        if (kind === 'source') {
          if (sourceVersion === uploadSourceVersion) setSource(image, file.name);
        }
        else {
          references[kind] = image;
          referenceIds[`${kind}Id`] = asset.id;
          consent.checked = false;
          schedulePreferences();
          status.textContent = `${referenceNames[kind]}已存入素材库`;
        }
      } catch (error) {
        status.textContent = error.message;
      } finally {
        loading = false;
        refresh();
      }
    });
  }
  for (const kind of Object.keys(references)) {
    document.querySelector(`#retouch-${kind}-clear`).addEventListener('click', () => {
      references[kind] = null;
      referenceIds[`${kind}Id`] = null;
      consent.checked = false;
      schedulePreferences();
      refresh();
    });
    document.querySelector(`#retouch-${kind}-library`).addEventListener('click', () => {
      library.open(kind === 'reference' ? 'person' : 'garment', async (asset, image) => {
        if (busy || loading) throw new Error('请等待当前修图任务完成。');
        references[kind] = image;
        referenceIds[`${kind}Id`] = asset.id;
        consent.checked = false;
        schedulePreferences();
        status.textContent = `${referenceNames[kind]}已选用`;
        refresh();
      });
    });
  }
  prompt.addEventListener('input', () => { refresh(); schedulePreferences(); });
  for (const id of ['retouch-quality', 'retouch-size']) document.querySelector(`#${id}`).addEventListener('change', schedulePreferences);
  clearPrompt.addEventListener('click', () => {
    prompt.value = '';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    prompt.focus();
  });
  consent.addEventListener('change', refresh);
  document.querySelector('#retouch-download').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = result;
    link.download = `studio-retouched-${Date.now()}.png`;
    link.click();
  });
  document.querySelector('#retouch-continue').addEventListener('click', () => setSource(result, '上次修图结果'));
  document.querySelector('#retouch-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (generate.disabled) return;
    const submittedSourceVersion = sourceVersion;
    busy = true;
    status.textContent = '正在等待 Azure 生成图片…';
    refresh();
    try {
      await savePreferences();
      const response = await fetch('/api/ai/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Studio-Token': config.token },
        body: JSON.stringify({ image: source, ...references, prompt: prompt.value.trim() || defaultPrompt, quality: document.querySelector('#retouch-quality').value, size: document.querySelector('#retouch-size').value }),
        signal: AbortSignal.timeout(255000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(messages[data.error] || '修图失败，请稍后手动重试。');
      if (typeof data.image !== 'string' || !data.image.startsWith('data:image/png;base64,')) throw new Error(messages.invalid_result);
      const decoded = new Image();
      decoded.src = data.image;
      await decoded.decode();
      result = data.image;
      resultSourceVersion = submittedSourceVersion;
      let saved = true;
      if (data.storageError) {
        library.retain('result', result, `studio-retouched-${Date.now()}.png`);
        saved = false;
      } else if (!data.asset) {
        try { await library.save('result', result, `studio-retouched-${Date.now()}.png`); }
        catch { saved = false; }
      }
      library.refresh();
      if (sourceVersion === submittedSourceVersion) {
        view = 'result';
        status.textContent = `生成完成 · ${decoded.naturalWidth} × ${decoded.naturalHeight}${saved ? ' · 已存入生成历史' : ' · 保存失败，图片暂留相册，可重试或下载；请勿刷新'}`;
      } else {
        status.textContent = saved ? '上一张原图修图已完成并存入历史；当前场景原图保持不变。' : '上一张修图已完成但保存失败，请在相册重试或下载，勿刷新。';
      }
    } catch (error) {
      status.textContent = error.name === 'TimeoutError' ? messages.azure_timeout : error instanceof TypeError ? '连接中断，Azure 可能仍在处理并计费；请勿连续重复提交。' : error.message;
    } finally {
      busy = false;
      refresh();
    }
  });
  refresh();
  const ready = restorePreferences();
  return {
    ready,
    get hasPendingChanges() { return preferenceDirty || preferenceSaves > 0 || loading || busy; },
    async useAsset(asset, image) {
      await ready;
      if (busy || loading || !preferencesReady) throw new Error('请等待修图任务完成，或刷新页面恢复配置。');
      if (asset.kind === 'person' || asset.kind === 'garment') {
        const kind = asset.kind === 'person' ? 'reference' : 'garment';
        references[kind] = image;
        referenceIds[`${kind}Id`] = asset.id;
        consent.checked = false;
        schedulePreferences();
        if (!source) {
          const photo = capturePhoto();
          if (photo) setSource(photo.image, photo.name, true);
        }
      } else setSource(image, asset.name, true);
      if (!dialog.open) dialog.showModal();
      checkConfig();
      refresh();
    },
    removeAsset(id) {
      for (const kind of Object.keys(references)) {
        if (referenceIds[`${kind}Id`] !== id) continue;
        referenceIds[`${kind}Id`] = null;
        references[kind] = null;
        consent.checked = false;
        schedulePreferences();
      }
      refresh();
    },
    setPhoto(image, name) {
      latestPhoto = { image, name };
      if (!busy && !loading) setSource(image, name);
      else refresh();
    },
  };
}