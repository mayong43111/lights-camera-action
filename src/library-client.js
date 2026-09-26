const errors = {
  storage_failed: '本地保存失败，请检查磁盘空间和目录权限。',
  settings_conflict: '配置已被其他窗口更新，请先导出当前配置，再刷新页面。',
  invalid_token: '服务已重启，请刷新页面后重试。',
  not_found: '图片已被删除，请刷新相册。',
  invalid_image: '图片无效或超出大小限制。',
  request_too_large: '图片或配置超出大小限制。',
};

export function imageDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('无法读取图片。'));
    reader.readAsDataURL(blob);
  });
}

export function createLibraryClient(request = fetch) {
  let tokenRequest;
  const revisions = new Map();
  const queues = new Map();

  async function token() {
    tokenRequest ??= request('/api/ai/status').then(async response => {
      if (!response.ok) throw new Error('本地存储服务不可用。');
      return (await response.json()).token;
    }).catch(error => { tokenRequest = null; throw error; });
    return tokenRequest;
  }

  async function call(path, body, blob = false) {
    let response;
    try {
      response = await request('/api/data/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-Studio-Token': await token(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error('无法连接本地存储服务，数据尚未确认保存。');
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(errors[data.error] || '本地数据操作失败。');
      error.code = data.error;
      throw error;
    }
    return blob ? response.blob() : response.json();
  }

  async function settings(name) {
    const data = await call('settings/' + name);
    revisions.set(name, data.revision);
    return data.value;
  }

  return {
    list: (kind, offset = 0) => call(`assets?kind=${encodeURIComponent(kind)}&offset=${offset}`),
    add: (kind, image, name) => call('assets', { kind, image, name }),
    remove: id => call(`assets/${id}/delete`, {}),
    blob: (id, thumbnail = false) => call(`assets/${id}${thumbnail ? '?thumbnail=1' : ''}`, undefined, true),
    async image(id) { return imageDataUrl(await this.blob(id)); },
    settings,
    saveSettings(name, value) {
      const snapshot = structuredClone(value);
      const operation = (queues.get(name) || Promise.resolve()).catch(() => {}).then(async () => {
        if (!revisions.has(name)) await settings(name);
        const saved = await call('settings/' + name, { value: snapshot, revision: revisions.get(name) });
        revisions.set(name, saved.revision);
      });
      queues.set(name, operation);
      return operation;
    },
  };
}