const errors: Record<string, string> = {
  storage_failed: '本地保存失败，请检查磁盘空间和目录权限。',
  settings_conflict: '配置已被其他窗口更新，请先导出当前配置，再刷新页面。',
  invalid_token: '服务已重启，请刷新页面后重试。',
  not_found: '图片已被删除，请刷新相册。',
  invalid_image: '图片无效或超出大小限制。',
  request_too_large: '图片或配置超出大小限制。',
};

export type AssetKind = 'photo' | 'result' | 'person' | 'garment';
export type SettingsName = 'scene' | 'retouch' | 'shots';
export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  created: string;
  mime: string;
  width: number;
  height: number;
  metadata: Record<string, unknown>;
}

export class LibraryError extends Error {
  constructor(public readonly code: string) {
    super(errors[code] ?? '本地数据操作失败。');
    this.name = 'LibraryError';
  }
}

export function imageDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result) : reject(new Error('无法读取图片。'));
    reader.onerror = () => reject(new Error('无法读取图片。'));
    reader.readAsDataURL(blob);
  });
}

export function createLibraryClient(request: typeof fetch = fetch) {
  let tokenRequest: Promise<string> | undefined;
  const revisions = new Map<SettingsName, number>();
  const queues = new Map<SettingsName, Promise<void>>();

  function token(): Promise<string> {
    tokenRequest ??= request('/api/ai/status').then(async response => {
      if (!response.ok) throw new Error('本地存储服务不可用。');
      const data: { token: string } = await response.json();
      return data.token;
    }).catch(error => { tokenRequest = undefined; throw error; });
    return tokenRequest;
  }

  async function call(path: string, body?: unknown): Promise<Response> {
    let response: Response;
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
      const data: { error?: string } = await response.json().catch(() => ({}));
      throw new LibraryError(data.error ?? 'unknown');
    }
    return response;
  }

  async function json<Result>(path: string, body?: unknown): Promise<Result> {
    return (await call(path, body)).json();
  }

  async function settings<Value = unknown>(name: SettingsName): Promise<Value | null> {
    const data = await json<{ revision: number; value: Value | null }>('settings/' + name);
    revisions.set(name, data.revision);
    return data.value;
  }

  const blob = async (id: string, thumbnail = false): Promise<Blob> =>
    (await call(`assets/${encodeURIComponent(id)}${thumbnail ? '?thumbnail=1' : ''}`)).blob();

  return {
    list: (kind: AssetKind, offset = 0) => json<{ items: Asset[]; total: number }>(`assets?kind=${encodeURIComponent(kind)}&offset=${offset}`),
    add: (kind: AssetKind, image: string, name: string) => json<Asset>('assets', { kind, image, name }),
    remove: (id: string) => json<{ ok: boolean }>(`assets/${encodeURIComponent(id)}/delete`, {}),
    blob,
    image: async (id: string) => imageDataUrl(await blob(id)),
    settings,
    saveSettings(name: SettingsName, value: unknown): Promise<void> {
      const snapshot = structuredClone(value);
      const operation = (queues.get(name) || Promise.resolve()).catch(() => {}).then(async () => {
        if (!revisions.has(name)) await settings(name);
        const saved = await json<{ revision: number }>('settings/' + name, { value: snapshot, revision: revisions.get(name) });
        revisions.set(name, saved.revision);
      });
      queues.set(name, operation);
      return operation;
    },
  };
}

export type LibraryClient = ReturnType<typeof createLibraryClient>;