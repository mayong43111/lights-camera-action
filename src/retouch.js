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

export function createRetouch(capturePhoto) {
  const dialog = document.querySelector('#retouch-dialog');
  const status = document.querySelector('#retouch-status');
  const prompt = document.querySelector('#retouch-prompt');
  const clearPrompt = document.querySelector('#retouch-prompt-clear');
  const generate = document.querySelector('#retouch-generate');
  const consent = document.querySelector('#retouch-consent');
  const preview = document.querySelector('#retouch-preview-image');
  const referencePreview = document.querySelector('#retouch-reference-image');
  let source = null;
  let reference = null;
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

  function refresh() {
    const image = view === 'result' ? result : source;
    preview.hidden = !image;
    if (image && preview.getAttribute('src') !== image) preview.src = image;
    if (!image) preview.removeAttribute('src');
    preview.alt = view === 'result' ? 'AI 修图结果' : '修图原图';
    document.querySelector('#retouch-empty').hidden = !!image;
    document.querySelector('#retouch-result-tab').textContent = result && resultSourceVersion !== sourceVersion ? '上次修图结果' : '修图结果';
    document.querySelector('#retouch-preview').setAttribute('aria-labelledby', view === 'result' ? 'retouch-result-tab' : 'retouch-original-tab');
    document.querySelectorAll('[data-retouch-view]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.retouchView === view));
      button.disabled = button.dataset.retouchView === 'result' && !result;
    });
    referencePreview.hidden = !reference;
    if (reference && referencePreview.getAttribute('src') !== reference) referencePreview.src = reference;
    if (!reference) referencePreview.removeAttribute('src');
    document.querySelector('#retouch-reference-empty').hidden = !!reference;
    document.querySelector('#retouch-reference-import').setAttribute('aria-label', reference ? '更换参考图' : '添加参考图');
    document.querySelector('#retouch-reference-clear').disabled = !reference || busy || loading;
    document.querySelector('#retouch-fields').disabled = busy || loading;
    clearPrompt.disabled = busy || loading || !prompt.value;
    document.querySelector('#retouch-source-import').disabled = busy || loading;
    document.querySelector('#retouch-latest').disabled = !latestPhoto || busy || loading;
    document.querySelector('#retouch-download').disabled = !result;
    document.querySelector('#retouch-continue').disabled = !result || busy || loading;
    document.querySelector('#retouch-config-refresh').disabled = busy || checking;
    document.querySelector('#retouch-photo-name').textContent = photoName || '未选择原图';
    generate.disabled = busy || loading || checking || !source || !prompt.value.trim() || !consent.checked || !config?.configured;
    generate.querySelector('span').textContent = busy ? '生成中…' : '生成修图';
    dialog.setAttribute('aria-busy', String(busy));
    document.querySelector('#retouch-open').classList.toggle('is-working', busy);
  }

  function setSource(image, name, keepResult = false) {
    sourceVersion++;
    source = image;
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
  for (const kind of ['source', 'reference']) {
    const input = document.querySelector(`#retouch-${kind}-input`);
    document.querySelector(`#retouch-${kind}-import`).addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = '';
      if (!file || busy || loading) return;
      loading = true;
      const uploadSourceVersion = sourceVersion;
      refresh();
      try {
        const image = await readImage(file);
        if (kind === 'source') {
          if (sourceVersion === uploadSourceVersion) setSource(image, file.name);
        }
        else {
          reference = image;
          status.textContent = '参考图已就绪';
        }
      } catch (error) {
        status.textContent = error.message;
      } finally {
        loading = false;
        refresh();
      }
    });
  }
  document.querySelector('#retouch-reference-clear').addEventListener('click', () => {
    reference = null;
    refresh();
  });
  prompt.addEventListener('input', refresh);
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
      const response = await fetch('/api/ai/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Studio-Token': config.token },
        body: JSON.stringify({ image: source, reference, prompt: prompt.value.trim(), quality: document.querySelector('#retouch-quality').value, size: document.querySelector('#retouch-size').value }),
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
      if (sourceVersion === submittedSourceVersion) {
        view = 'result';
        status.textContent = `生成完成 · ${decoded.naturalWidth} × ${decoded.naturalHeight}`;
      } else {
        status.textContent = '上一张原图修图已完成，可切换查看或下载；当前场景原图保持不变。';
      }
    } catch (error) {
      status.textContent = error.name === 'TimeoutError' ? messages.azure_timeout : error instanceof TypeError ? '连接中断，Azure 可能仍在处理并计费；请勿连续重复提交。' : error.message;
    } finally {
      busy = false;
      refresh();
    }
  });
  refresh();
  return {
    setPhoto(image, name) {
      latestPhoto = { image, name };
      if (!busy && !loading) setSource(image, name);
      else refresh();
    },
  };
}