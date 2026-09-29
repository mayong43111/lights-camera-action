import { test, expect } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { StudioProject } from '../src/scene-types';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/ai/edit', route => route.abort());
  await page.route('**/api/ai/analyze', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#loading-state')).toHaveClass(/is-hidden/);
  await expect(page.locator('#config-save')).toBeEnabled();
});

test.skip('existing frontend contracts', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const path = '/tests/frontend.test.js';
    return (await import(path)).runTests();
  });
  expect(result.passed).toBeGreaterThanOrEqual(43);
});

test('project session tracks edits, undo and pending saves without navigation writes', async ({ page }) => {
  const writes: StudioProject[] = [];
  let stored: StudioProject | null = null;
  let revision = 0;
  let holdNextSave = false;
  let rejectNextSave = false;
  let releaseSave: (() => void) | undefined;
  await page.route('**/api/data/settings/scene', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { value: stored, revision } });
    const body: { value: StudioProject; revision: number } = route.request().postDataJSON();
    writes.push(body.value);
    if (holdNextSave) {
      holdNextSave = false;
      await new Promise<void>(resolve => { releaseSave = resolve; });
    }
    if (rejectNextSave) {
      rejectNextSave = false;
      return route.fulfill({ status: 503, json: { error: 'storage_failed' } });
    }
    if (body.revision !== revision) return route.fulfill({ status: 409, json: { error: 'settings_conflict' } });
    stored = body.value;
    return route.fulfill({ json: { revision: ++revision } });
  });
  try {
    await page.reload();
    await expect(page.locator('#config-save')).toBeEnabled();
    await page.clock.install();
    await page.locator('#tab-camera').click();
    await page.locator('#tab-lights').click();
    await page.clock.fastForward(1000);
    expect(writes).toHaveLength(0);
    await page.locator('#tab-camera').click();
    const focal = page.locator('#focal-length [role="slider"]');
    const slider = focal;
    const original = Number(await focal.getAttribute('aria-valuenow'));
    await slider.press('ArrowRight');
    await page.clock.fastForward(1000);
    await expect(page.locator('#persistence-status')).toHaveText('配置已保存到本机');
    expect(writes.at(-1)?.state.focal).not.toBe(original);
    await page.locator('#undo-button').click();
    await expect(focal).toHaveAttribute('aria-valuenow', String(original));
    await focal.scrollIntoViewIfNeeded();
    const handle = (await focal.boundingBox())!;
    const track = (await page.locator('#focal-length .ant-slider').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * 0.7, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(focal).not.toHaveAttribute('aria-valuenow', String(original));
    await page.locator('#undo-button').click();
    await expect(focal).toHaveAttribute('aria-valuenow', String(original));
    await page.clock.fastForward(1000);
    await expect(page.locator('#persistence-status')).toHaveText('配置已保存到本机');
    const beforePending = writes.length;
    holdNextSave = true;
    await slider.press('ArrowRight');
    await page.clock.fastForward(1000);
    await expect.poll(() => Boolean(releaseSave)).toBe(true);
    await slider.press('ArrowRight');
    const latest = Number(await focal.getAttribute('aria-valuenow'));
    await page.clock.fastForward(1000);
    expect(writes).toHaveLength(beforePending + 1);
    expect(writes.at(-1)?.state.focal).not.toBe(latest);
    releaseSave?.();
    await expect(page.locator('#persistence-status')).toHaveText('配置已保存到本机');
    expect(writes).toHaveLength(beforePending + 2);
    expect(writes.at(-1)?.state.focal).toBe(latest);
    rejectNextSave = true;
    await slider.press('ArrowRight');
    await page.clock.fastForward(1000);
    await expect(page.locator('#persistence-status')).toHaveText('配置保存失败');
    const beforeRetry = writes.length;
    await page.clock.fastForward(2000);
    expect(writes).toHaveLength(beforeRetry);
    await page.locator('#config-save').click();
    await expect(page.locator('#persistence-status')).toHaveText('配置已保存到本机');
    expect(writes).toHaveLength(beforeRetry + 1);
    const beforeRestore = writes.length;
    const restoredFocal = await focal.getAttribute('aria-valuenow');
    await page.reload();
    await expect(page.locator('#persistence-status')).toHaveText('已恢复本地配置');
    await expect(focal).toHaveAttribute('aria-valuenow', restoredFocal!);
    await page.clock.fastForward(1000);
    expect(writes).toHaveLength(beforeRestore);
  } finally { releaseSave?.(); }
});

test('character stage toolbar and recording use controlled state', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    class Recorder extends EventTarget {
      state = 'inactive';
      mimeType = 'video/webm';
      constructor(stream: MediaStream) {
        super();
        Reflect.set(window, '__recordingTracks', stream.getTracks());
      }
      static isTypeSupported() { return true; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        queueMicrotask(() => {
          this.dispatchEvent(new BlobEvent('dataavailable', { data: new Blob(['recording-state-fixture'], { type: this.mimeType }) }));
          this.dispatchEvent(new Event('stop'));
        });
      }
    }
    Object.defineProperty(window, 'MediaRecorder', { value: Recorder, configurable: true });
  });
  await page.reload();
  await expect(page.locator('#config-save')).toBeEnabled();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('#tab-poses').click();
  await expect(page.locator('input[type="range"]')).toHaveCount(0);
  await page.locator('#auto-ground').uncheck();
  await page.locator('#character-height-value').fill('2');
  await expect(page.locator('#character-height [role="slider"]')).toHaveAttribute('aria-valuenow', '2');
  await page.locator('#joint-select').selectOption('head');
  await page.locator('#joint-x-value').fill('17');
  await expect(page.locator('#joint-x [role="slider"]')).toHaveAttribute('aria-valuenow', '17');
  const rotation = page.locator('#star-rotation [role="slider"]');
  const originalRotation = await rotation.getAttribute('aria-valuenow');
  await rotation.press('ArrowRight');
  await page.locator('#undo-button').click();
  await expect(rotation).toHaveAttribute('aria-valuenow', originalRotation!);
  const request = page.waitForRequest(request => request.url().endsWith('/api/data/settings/scene') && request.method() === 'POST');
  await page.locator('#config-save').click();
  const project: StudioProject = (await request).postDataJSON().value;
  expect(project.state.jointPose?.placement).toMatchObject({ grounded: false, height: 2 });
  expect(project.state.jointPose?.joints.head[0]).toBeCloseTo(17 * Math.PI / 180);
  const pose = structuredClone(project.state.jointPose!);
  pose.rotation = 0.5;
  pose.placement = { grounded: false, height: 1.8 };
  await page.locator('#pose-input').setInputFiles({ name: 'pose.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pose)) });
  await expect(page.locator('#rotation-output')).toHaveText('28.6°');
  await expect(rotation).toHaveAttribute('aria-valuenow', '29');
  await expect(page.locator('#character-height-value')).toHaveValue('1.8');
  const poseExport = page.waitForEvent('download');
  await page.locator('#pose-export').click();
  expect((await poseExport).suggestedFilename()).toBe('studio-pose.json');
  await page.locator('#tab-stage').click();
  await page.locator('[data-color="#1f674f"]').click();
  await expect(page.locator('[data-color="#1f674f"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-aspect="1"]').click();
  await expect(page.locator('[data-aspect="1"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#record-button').click();
  await expect(page.locator('#record-button')).toHaveAttribute('aria-label', '停止录制');
  await expect(page.locator('#record-time')).not.toHaveText('00:00');
  await expect(page.locator('#photo-button')).toBeDisabled();
  await expect(page.locator('#undo-button')).toBeDisabled();
  await expect(page.locator('[data-aspect="1.5"]')).toBeDisabled();
  await page.locator('#tab-props').click();
  await expect(page.locator('#prop-add')).toBeDisabled();
  const recording = page.waitForEvent('download');
  await page.locator('#record-button').click();
  expect((await recording).suggestedFilename()).toMatch(/\.webm$/);
  await expect(page.locator('#prop-add')).toBeEnabled();
  await expect(page.locator('#photo-button')).toBeEnabled();
  await expect(page.locator('#recording-indicator')).toBeHidden();
  await page.locator('#library-open').click();
  await expect(page.locator('#library-dialog')).toBeVisible();
  await page.locator('#library-close').click();
  await page.locator('#tab-poses').click();
  await page.locator('#edit-joints').check();
  await page.evaluate(() => {
    const fixture = document.createElement('canvas');
    fixture.width = 1; fixture.height = 1;
    const encoded = fixture.toDataURL();
    Object.defineProperty(document.querySelector('#viewport canvas'), 'toDataURL', { value: () => encoded, configurable: true });
  });
  await page.locator('#photo-button').click();
  await expect(page.locator('#status-message')).toHaveText('已存入拍摄相册');
  await expect(page.locator('#edit-joints')).toBeChecked();
  await page.locator('#record-button').click();
  await expect(page.locator('#record-button')).toHaveAttribute('aria-label', '停止录制');
  await page.evaluate(async () => {
    const path = document.querySelector<HTMLScriptElement>('script[src*="/src/main.tsx"]')!.src;
    const module = await import(path);
    module.application.unmount();
  });
  await expect(page.locator('#viewport canvas')).toHaveCount(0);
  expect(await page.evaluate(() => (Reflect.get(window, '__recordingTracks') as MediaStreamTrack[]).every(track => track.readyState === 'ended'))).toBe(true);
  expect(errors).toEqual([]);
});

test('project framing and background restoration wait for assets', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  async function readProject() {
    const request = page.waitForRequest(request => request.url().endsWith('/api/data/settings/scene') && request.method() === 'POST');
    await page.locator('#config-save').click();
    const project: StudioProject = (await request).postDataJSON().value;
    await expect(page.locator('#persistence-status')).toHaveText('配置已保存到本机');
    return project;
  }
  await page.locator('#tab-camera').click();
  const frames = new Set<string>();
  for (const mode of ['full', 'half', 'face', 'low']) {
    await page.locator(`[data-framing="${mode}"]`).click();
    const { state } = await readProject();
    expect([...state.cameraPosition, ...state.target].every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...state.cameraPosition.map((value, index) => value - state.target[index]))).toBeGreaterThan(0.1);
    frames.add(JSON.stringify([state.cameraPosition, state.target]));
  }
  expect(frames.size).toBe(4);
  const original = await readProject();
  const image = await page.evaluate(async () => {
    const path = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname.endsWith('/three.js'))!.name;
    const three = await import(path);
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    const image = canvas.toDataURL();
    const load = three.TextureLoader.prototype.loadAsync;
    Reflect.set(window, '__restoreBackgroundLoader', () => { three.TextureLoader.prototype.loadAsync = load; });
    three.TextureLoader.prototype.loadAsync = function(url: string) {
      if (url !== image) return load.call(this, url);
      return new Promise((resolve, reject) => {
        Reflect.set(window, '__finishBackground', (success: boolean) => {
          Reflect.deleteProperty(window, '__finishBackground');
          if (!success) { reject(new Error('fixture decode failure')); return; }
          const texture = new three.CanvasTexture(canvas);
          Reflect.set(window, '__releasedBackgroundDisposed', false);
          texture.addEventListener('dispose', () => Reflect.set(window, '__releasedBackgroundDisposed', true));
          resolve(texture);
        });
      });
    };
    return image;
  });
  const project = structuredClone(original);
  project.state.background = image;
  project.state.focal = Number(original.state.focal) === 64 ? 65 : 64;
  const importProject = () => page.locator('#project-input').setInputFiles({ name: 'background-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  try {
    await importProject();
    await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, '__finishBackground'))).toBe('function');
    await expect(page.locator('#config-save')).toBeDisabled();
    await expect(page.locator('#focal-length [role="slider"]')).toHaveAttribute('aria-valuenow', String(original.state.focal));
    await expect(page.locator('#status-message')).not.toHaveText('项目已恢复');
    await page.evaluate(() => Reflect.get(window, '__finishBackground')(true));
    await expect(page.locator('#status-message')).toHaveText('项目已恢复');
    await expect(page.locator('#config-save')).toBeEnabled();
    const restored = await readProject();
    expect(restored.state.background).toBe(image);
    expect(restored.state.focal).toBe(project.state.focal);
    project.state.focal = Number(project.state.focal) + 1;
    await importProject();
    await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, '__finishBackground'))).toBe('function');
    await page.evaluate(() => Reflect.get(window, '__finishBackground')(false));
    await expect(page.locator('#status-message')).toHaveText('背景图片无法解码，项目未恢复');
    await expect(page.locator('#config-save')).toBeEnabled();
    const preserved = await readProject();
    expect(preserved.state.background).toBe(restored.state.background);
    expect(preserved.state.focal).toBe(restored.state.focal);
    await importProject();
    await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, '__finishBackground'))).toBe('function');
    await page.evaluate(async () => {
      const path = document.querySelector<HTMLScriptElement>('script[src*="/src/main.tsx"]')!.src;
      (await import(path)).application.unmount();
    });
    await expect(page.locator('#viewport canvas')).toHaveCount(0);
    await page.evaluate(() => Reflect.get(window, '__finishBackground')(true));
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__releasedBackgroundDisposed'))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(() => {
      Reflect.get(window, '__finishBackground')?.(false);
      Reflect.get(window, '__restoreBackgroundLoader')?.();
    });
  }
});

test('controlled photography and portal panels preserve project compatibility', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('#tab-lights').click();
  await expect(page.locator('#panel-lights input[type="range"]')).toHaveCount(0);
  const intensity = page.getByRole('slider', { name: '主光亮度', exact: true });
  const originalIntensity = await intensity.getAttribute('aria-valuenow');
  await intensity.press('ArrowRight');
  await expect(intensity).not.toHaveAttribute('aria-valuenow', originalIntensity!);
  await page.locator('#undo-button').click();
  await expect(intensity).toHaveAttribute('aria-valuenow', originalIntensity!);
  const rigs = page.locator('#show-rigs');
  const originalRigs = await rigs.isChecked();
  await rigs.setChecked(!originalRigs);
  await page.locator('#undo-button').click();
  await expect(rigs).toBeChecked({ checked: originalRigs });
  const shadows = page.locator('#remove-shadows');
  const originalShadows = await shadows.isChecked();
  await shadows.setChecked(!originalShadows);
  await page.locator('#undo-button').click();
  await expect(shadows).toBeChecked({ checked: originalShadows });
  await page.locator('#tab-camera').click();
  await expect(page.locator('#panel-camera input[type="range"]')).toHaveCount(0);
  const focal = page.getByRole('slider', { name: '焦距', exact: true });
  await focal.press('ArrowRight');
  await expect(page.locator('#lens-readout')).toHaveText(`${await focal.getAttribute('aria-valuenow')} MM`);
  const save = page.waitForRequest(request => request.url().endsWith('/api/data/settings/scene') && request.method() === 'POST');
  await page.locator('#config-save').click();
  const project: StudioProject = (await save).postDataJSON().value;
  await expect(page.locator('#persistence-status')).toHaveText('配置已保存到本机');
  project.state.focal = '62';
  project.state.exposure = '0.5';
  project.state.dof = '20';
  project.state.lights.key.intensity = '6.1';
  await page.locator('#project-input').setInputFiles({ name: 'legacy-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(focal).toHaveAttribute('aria-valuenow', '62');
  await expect(page.locator('#aperture-readout')).toHaveText('f/4.8');
  await page.locator('#tab-lights').click();
  await expect(intensity).toHaveAttribute('aria-valuenow', '6.1');
  await page.locator('#tab-poses').click();
  await page.locator('#pose-save-as').click();
  await expect(page.locator('#pose-save-name')).toBeVisible();
  await page.locator('#pose-save-cancel').click();
  await expect(page.locator('#pose-save-name')).toBeHidden();
  await expect(page.locator('#viewport canvas')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('runtime file writes preserve preset selection without applying or reloading', async ({ page }) => {
  const dataDirectory = resolve('.studio-data');
  await mkdir(dataDirectory, { recursive: true });
  const directory = await mkdtemp(resolve(dataDirectory, 'vite-watch-test-'));
  const marker = resolve(directory, 'runtime.txt');
  try {
    await writeFile(marker, 'initial');
    const originalFocal = await page.locator('#focal-length [role="slider"]').getAttribute('aria-valuenow');
    const originalPose = await page.locator('#pose-state').textContent();
    const originalPreview = await page.locator('#shot-preview').getAttribute('src');
    const originalPersistence = await page.locator('#persistence-status').textContent();
    const preset = page.getByRole('combobox', { name: '配置预设', exact: true });
    const dropdown = page.locator('.ant-select-dropdown:visible');
    await preset.fill('不存在的预设');
    await expect(dropdown).toContainText('没有匹配的预设');
    await preset.fill('四十五');
    await expect(dropdown.locator('.ant-select-item-option')).toHaveCount(1);
    const selection = '四十五度侧颜';
    await dropdown.locator('.ant-select-item-option').click();
    await expect(dropdown).toHaveCount(0);
    await expect(page.locator('#shot-select .ant-select-selection-item')).toHaveText(selection);
    await page.locator('#shot-select .ant-select-selector').click();
    await expect(preset).toHaveValue('');
    await expect(dropdown.locator('.ant-select-item-option').nth(1)).toBeVisible();
    await preset.press('Escape');
    await expect(page.locator('#persistence-status')).toHaveText(originalPersistence!);
    const navigation = page.waitForEvent('framenavigated', {
      predicate: frame => frame === page.mainFrame(), timeout: 3000,
    }).then(() => true, error => {
      if (error.name === 'TimeoutError') return false;
      throw error;
    });
    await writeFile(marker, 'updated');
    expect(await navigation).toBe(false);
    await expect(page.locator('#shot-select .ant-select-selection-item')).toHaveText(selection);
    await expect(page.locator('#shot-preview')).not.toHaveAttribute('src', originalPreview!);
    await expect(page.locator('#focal-length [role="slider"]')).toHaveAttribute('aria-valuenow', originalFocal!);
    await expect(page.locator('#pose-state')).toHaveText(originalPose!);
    await expect(page.locator('.startup-error')).toHaveCount(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('React preset panel edits and saves an explicitly authorized draft', async ({ page }) => {
  let analysisCalls = 0;
  let saved: { version: number; items: { name: string; category: string }[] } | undefined;
  await page.route('**/api/ai/analyze/status', route => route.fulfill({ json: { configured: true, deployment: 'mock', token: 'mock-token' } }));
  await page.route('**/api/ai/analyze', route => {
    analysisCalls++;
    expect(route.request().postDataJSON().consent).toBe(true);
    return route.fulfill({ json: { preset: {
      id: `shot-${'a'.repeat(32)}`, name: '模拟草稿', category: '肖像', notes: '模拟响应，不代表实际 AI 效果', sourceName: 'fixture.png',
      scene: {
        jointPose: { format: 'studio-pose', version: 1, units: 'radians', rotation: 0, placement: { grounded: true, height: 0 }, joints: { head: [0, 0, 0] } },
        cameraPosition: [0, 2, 8], target: [0, 1.6, 0], focal: 50, aspect: '1.5', exposure: 0.5, backdrop: '#edf4f6', props: [],
        lights: Object.fromEntries(['key', 'fill', 'rim'].map(id => [id, { enabled: true, intensity: 3, color: '#ffffff', position: 0, height: 3, depth: 2 }])),
      },
    } } });
  });
  await page.route('**/api/data/settings/shots', route => {
    if (route.request().method() === 'POST') {
      saved = route.request().postDataJSON().value;
      return route.fulfill({ json: { revision: 1 } });
    }
    return route.fulfill({ json: { revision: 0, value: null } });
  });
  await page.locator('#shot-config-refresh').click();
  await expect(page.locator('#shot-ai-config')).toContainText('mock');
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    return canvas.toDataURL().split(',')[1];
  });
  await page.locator('#shot-source-input').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await expect(page.locator('#shot-source-preview')).toBeVisible();
  await expect(page.locator('#shot-generate')).toBeDisabled();
  expect(analysisCalls).toBe(0);
  await page.locator('#shot-consent').check();
  await page.locator('#shot-generate').click();
  await expect(page.locator('#shot-result')).toBeVisible();
  await expect(page.locator('#shot-consent')).not.toBeChecked();
  expect(analysisCalls).toBe(1);
  expect(saved).toBeUndefined();
  await page.locator('#shot-name').fill('React 自定义预设');
  await page.locator('.ant-select').filter({ has: page.locator('#shot-result-category') }).click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="写真集"]').click();
  await page.locator('#shot-save-result').click();
  await expect(page.locator('#shot-result')).toBeHidden();
  await expect(page.locator('#shot-select')).toContainText('React 自定义预设');
  expect(saved?.items[0]).toMatchObject({ name: 'React 自定义预设', category: '写真集' });
});

test('studio lifecycle releases resources and remounts once', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const jointCount = await page.locator('#joint-select option').count();
  await page.evaluate(async () => {
    const path = document.querySelector<HTMLScriptElement>('script[src*="/src/main.tsx"]')!.src;
    const module = await import(path);
    Reflect.set(window, '__previousCanvas', document.querySelector('#viewport canvas'));
    module.application.unmount();
  });
  await expect(page.locator('#viewport canvas')).toHaveCount(0);
  await expect(page.locator('.image-viewer')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__previousCanvas').getContext('webgl2').isContextLost())).toBe(true);
  await page.evaluate(async () => {
    window.dispatchEvent(new Event('resize'));
    const path = document.querySelector<HTMLScriptElement>('script[src*="/src/main.tsx"]')!.src;
    const module = await import(path);
    Reflect.set(window, '__remountedApplication', module.mountApplication(document.getElementById('root')));
  });
  await expect(page.locator('#config-save')).toBeEnabled();
  await expect(page.locator('#loading-state')).toHaveClass(/is-hidden/);
  await expect(page.locator('#viewport canvas')).toHaveCount(1);
  await expect(page.locator('.image-viewer')).toHaveCount(1);
  await expect(page.locator('#joint-select option')).toHaveCount(jointCount);
  await page.locator('#config-save').click();
  await expect(page.locator('#persistence-status')).toHaveText('配置已保存到本机');
  await page.evaluate(() => { Reflect.get(window, '__remountedApplication').unmount(); });
  await expect(page.locator('.image-viewer')).toHaveCount(0);
  let releaseModel!: () => void;
  const modelHeld = new Promise<void>(resolve => { releaseModel = resolve; });
  let modelRequested = false;
  await page.route('**/assets/characters/**', async route => {
    modelRequested = true;
    await modelHeld;
    await route.abort().catch(() => {});
  });
  try {
    await page.evaluate(async () => {
      const path = document.querySelector<HTMLScriptElement>('script[src*="/src/main.tsx"]')!.src;
      const module = await import(path);
      Reflect.set(window, '__initializingApplication', module.mountApplication(document.getElementById('root')));
    });
    await expect.poll(() => modelRequested).toBe(true);
    await expect(page.locator('#viewport canvas')).toHaveCount(1);
    await page.evaluate(() => { Reflect.get(window, '__initializingApplication').unmount(); });
    await expect(page.locator('.image-viewer')).toHaveCount(0);
    await expect(page.locator('#viewport canvas')).toHaveCount(0);
  } finally { releaseModel(); }
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  expect(errors).toEqual([]);
});

test('React asset dialogs preserve consent and isolate pending edit results', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/ai/status', route => route.fulfill({ json: { configured: true, deployment: 'mock-edit', token: 'mock-token' } }));
  const fixture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#b32939'; context.fillRect(0, 0, 16, 16);
    const source = canvas.toDataURL();
    context.fillStyle = '#285943'; context.fillRect(0, 0, 16, 16);
    const currentPhoto = canvas.toDataURL();
    Object.defineProperty(document.querySelector('#viewport canvas'), 'toDataURL', { value: () => currentPhoto, configurable: true });
    return source;
  });
  const file = { name: 'react-asset-fixture.png', mimeType: 'image/png', buffer: Buffer.from(fixture.split(',')[1], 'base64') };
  await page.locator('#library-open').click();
  await page.locator('#library-input').setInputFiles(file);
  await expect(page.locator('#library-status')).toHaveText('素材已保存');
  await page.locator('#library-search').fill(file.name);
  await expect(page.locator('#library-grid .library-item')).toHaveCount(1);
  await expect(page.locator('#library-preview')).toHaveAttribute('src', fixture);
  await page.locator('#library-use').click();
  await expect(page.locator('#library-dialog')).not.toBeVisible();
  await expect(page.locator('#retouch-dialog')).toBeVisible();
  await expect(page.locator('#retouch-config')).toContainText('mock-edit');
  await expect(page.locator('#retouch-generate')).toBeDisabled();
  await page.locator('#retouch-prompt').fill('模拟修图请求');
  await page.locator('#retouch-reference-input').setInputFiles({ ...file, name: 'react-person-fixture.png' });
  await expect(page.locator('#retouch-status')).toContainText('人物图已存入素材库');
  await page.locator('#retouch-consent').check();
  await page.locator('#retouch-reference-clear').click();
  await expect(page.locator('#retouch-consent')).not.toBeChecked();
  await expect(page.locator('#retouch-generate')).toBeDisabled();
  let requests = 0;
  let submitted: { image: string; prompt: string; reference: string | null } | undefined;
  let finishEdit!: () => void;
  const editHeld = new Promise<void>(resolve => { finishEdit = resolve; });
  await page.route('**/api/ai/edit', async route => {
    requests++;
    submitted = route.request().postDataJSON();
    await editHeld;
    await route.fulfill({ json: { image: fixture } });
  });
  expect(requests).toBe(0);
  try {
    await page.locator('#retouch-consent').check();
    await page.locator('#retouch-generate').click();
    await expect.poll(() => requests).toBe(1);
    await expect(page.locator('#retouch-open')).toHaveClass(/is-working/);
    expect(submitted).toMatchObject({ image: fixture, prompt: '模拟修图请求', reference: null });
    await expect(page.locator('#retouch-generate')).toBeDisabled();
    await page.locator('#retouch-close').click();
    await page.locator('#retouch-open').click();
    await expect(page.locator('#retouch-consent')).not.toBeChecked();
    const currentSource = await page.locator('#retouch-preview-image').getAttribute('src');
    expect(currentSource).not.toBe(fixture);
    finishEdit();
    await expect(page.locator('#retouch-result-tab')).toHaveText('上次修图结果');
    await expect(page.locator('#retouch-status')).toContainText('当前场景原图保持不变');
    await expect(page.locator('#retouch-open')).not.toHaveClass(/is-working/);
    await expect(page.locator('#retouch-preview-image')).toHaveAttribute('src', currentSource!);
    await page.locator('#retouch-result-tab').click();
    await expect(page.locator('#retouch-preview-image')).toHaveAttribute('src', fixture);
    await page.route('**/api/ai/edit', route => {
      requests++;
      return route.fulfill({ status: 429, json: { error: 'azure_rate_limit' } });
    });
    await page.locator('#retouch-consent').check();
    await page.locator('#retouch-generate').click();
    await expect(page.locator('#retouch-status')).toContainText('Azure 配额或速率受限');
    await expect(page.locator('#retouch-preview-image')).toHaveAttribute('src', fixture);
    await page.locator('#retouch-preview-open').click();
    await expect(page.locator('.image-viewer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.image-viewer')).not.toBeVisible();
    await expect(page.locator('#retouch-dialog')).toBeVisible();
    expect(requests).toBe(2);
    expect(errors).toEqual([]);
  } finally { finishEdit(); }
});

test('React controls preserve studio workflows', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('tab', { name: '镜头', exact: true }).click();
  const focal = page.getByRole('slider', { name: '焦距', exact: true });
  await focal.focus();
  const originalFocal = Number(await focal.getAttribute('aria-valuenow'));
  await focal.press('ArrowRight');
  await expect(focal).toHaveAttribute('aria-valuenow', String(originalFocal + 1));
  await page.locator('#undo-button').click();
  await expect(focal).toHaveAttribute('aria-valuenow', String(originalFocal));
  await page.getByRole('tab', { name: '姿势', exact: true }).click();
  await expect(page.locator('#panel-poses')).toBeVisible();
  await expect(page.locator('#panel-shots')).toBeHidden();
  await page.locator('#pose-search').fill('站');
  await expect(page.locator('.ant-select-dropdown:visible .ant-select-item-option').first()).toBeVisible();
  await page.locator('#pose-search').fill('');
  await page.locator('#pose-search').press('Escape');
  await page.getByRole('tab', { name: '道具', exact: true }).click();
  await expect(page.locator('#panel-props')).toBeVisible();
  await page.getByRole('tab', { name: '布景', exact: true }).click();
  await page.locator('[data-aspect="1"]').click();
  await expect(page.locator('[data-aspect="1"]')).toHaveClass(/is-active/);
  await page.locator('[data-aspect="1.5"]').click();
  await page.getByRole('tab', { name: '灯光', exact: true }).click();
  await expect(page.locator('#light-controls .light-control')).toHaveCount(3);
  await page.locator('#show-rigs').check();
  await page.locator('#show-rigs').uncheck();
  await page.getByRole('tab', { name: '镜头', exact: true }).click();
  await page.locator('[data-framing="half"]').click();
  await page.locator('[data-framing="full"]').click();
  const download = page.waitForEvent('download');
  await page.locator('#save-button').click();
  const project = await download;
  expect(project.suggestedFilename()).toMatch(/\.json$/);
  const filePath = await project.path();
  expect(filePath).toBeTruthy();
  await page.locator('#project-input').setInputFiles(filePath!);
  await expect(page.locator('#status-message')).toContainText('项目已恢复');
  const take = await page.locator('#take-number').textContent();
  await page.locator('#photo-button').click();
  await expect(page.locator('#take-number')).not.toHaveText(take!);
  await expect(page.locator('#status-message')).toContainText('已存入拍摄相册');
  await page.locator('#library-open').click();
  await expect(page.locator('#library-dialog')).toBeVisible();
  await page.locator('#library-close').click();
  await page.locator('#retouch-open').click();
  await expect(page.locator('#retouch-dialog')).toBeVisible();
  await expect(page.locator('#retouch-preview-image')).toBeVisible();
  await expect(page.locator('#retouch-consent')).not.toBeChecked();
  if (process.env.STUDIO_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath('retouch.png'), fullPage: true });
  await page.locator('#retouch-close').click();
  expect(errors).toEqual([]);
});

test('React pose dialogs preserve filters and failed save input', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.getByRole('tab', { name: '姿势', exact: true }).click();
  const picker = page.getByRole('combobox', { name: '搜索当前文件夹中的姿势' });
  const dropdown = page.locator('.ant-select-dropdown:visible');
  await expect(page.locator('#pose-controls')).toHaveCount(0);
  await picker.fill('不存在的姿势');
  await expect(dropdown).toContainText('没有匹配的姿势');
  await picker.fill('山式');
  await expect(dropdown.locator('.ant-select-item-option')).toHaveCount(1);
  await picker.press('ArrowDown');
  await picker.press('Enter');
  await expect(dropdown).toHaveCount(0);
  await expect(page.locator('#pose-state')).toHaveText('山式站立');
  await page.locator('#pose-expand').click();
  const browser = page.getByRole('dialog', { name: '姿势库', exact: true });
  await expect(browser).toBeVisible();
  await page.locator('#pose-search').fill('站');
  await page.locator('#pose-controls button:not([hidden])').first().click();
  await expect(browser).toBeHidden();
  await page.locator('.ant-select').filter({ has: picker }).locator('.ant-select-selector').click();
  await expect(page.locator('#pose-search')).toHaveValue('站');
  await picker.press('Escape');
  await page.locator('#pose-save-as').click();
  const saveDialog = page.getByRole('dialog', { name: '另存为新姿势', exact: true });
  await expect(saveDialog).toBeVisible();
  await page.locator('#pose-save-name').fill('React 保存验收');
  await page.locator('#pose-save-folder').fill('自动化测试');
  await page.locator('#pose-save-submit').click();
  await expect(saveDialog).toBeHidden();
  await expect(page.locator('#pose-state')).toHaveText('React 保存验收');
  await expect(page.locator('#persistence-status')).toHaveText('配置已保存到本机');
  await page.locator('#pose-save-as').click();
  await page.locator('#pose-save-name').fill('React 保存验收');
  await page.locator('#pose-save-submit').click();
  await expect(page.locator('#pose-save-error')).toContainText('同名姿势');
  await expect(page.locator('#pose-save-name')).toHaveValue('React 保存验收');
  await page.locator('#pose-save-cancel').click();
  await page.locator('#pose-expand').click();
  await expect(page.locator('#pose-controls [aria-pressed="true"]')).toContainText('React 保存验收');
  if (process.env.STUDIO_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath('pose-library.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(browser).toBeHidden();
});

test('workspace navigation preserves controls and fits responsive layouts', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const originalCanvas = await page.locator('#viewport canvas').elementHandle();
  const navigation = page.getByRole('tablist', { name: '工具分类' });
  await expect(navigation.getByRole('tab')).toHaveCount(7);
  await expect(page.locator('#studio-inspector [role="tabpanel"]')).toHaveCount(7);
  for (const name of ['人物', '组合', '姿势', '道具', '布景', '镜头', '灯光']) {
    const tab = navigation.getByRole('tab', { name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#studio-inspector [role="tabpanel"]:visible')).toHaveCount(1);
    await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
  }
  await navigation.getByRole('tab', { name: '姿势', exact: true }).click();
  await page.locator('#pose-search').fill('站');
  await page.locator('#edit-joints').check();
  await navigation.getByRole('tab', { name: '镜头', exact: true }).click();
  await expect(page.locator('#edit-joints')).not.toBeChecked();
  await navigation.getByRole('tab', { name: '姿势', exact: true }).click();
  await page.locator('.ant-select').filter({ has: page.locator('#pose-search') }).locator('.ant-select-selector').click();
  await expect(page.locator('#pose-search')).toHaveValue('站');
  await page.locator('#pose-search').fill('');
  await page.locator('#pose-search').press('Escape');
  await page.locator('#tab-poses').press('Home');
  await expect(page.locator('#tab-cast')).toBeFocused();
  await page.locator('#tab-cast').press('End');
  await expect(page.locator('#tab-lights')).toBeFocused();
  await page.locator('#tab-lights').press(testInfo.project.name === 'mobile' ? 'ArrowRight' : 'ArrowDown');
  await expect(page.locator('#tab-cast')).toBeFocused();
  if (testInfo.project.name === 'desktop') {
    const before = await page.locator('.viewport-surface').boundingBox();
    await page.getByRole('button', { name: '收起参数区' }).click();
    await expect(page.locator('#studio-inspector')).toBeHidden();
    await expect.poll(async () => (await page.locator('.viewport-surface').boundingBox())!.width).toBeGreaterThan(before!.width);
  }
  await page.evaluate(() => document.getElementById('tab-props')!.click());
  await expect(page.locator('#panel-props')).toBeVisible();
  expect(await originalCanvas!.evaluate(canvas => canvas === document.querySelector('#viewport canvas'))).toBe(true);
  await navigation.getByRole('tab', { name: '布景', exact: true }).click();
  for (const aspect of ['1.5', '1.333333', '1', '0.5625']) {
    await page.locator(`[data-aspect="${aspect}"]`).click();
    await expect.poll(() => page.locator('#viewport-frame').evaluate((frame, ratio) => {
      const bounds = frame.getBoundingClientRect();
      const parent = frame.parentElement!.getBoundingClientRect();
      return Math.abs(bounds.width / bounds.height - ratio) < 0.01 && bounds.left >= parent.left - 1 && bounds.top >= parent.top - 1 && bounds.right <= parent.right + 1 && bounds.bottom <= parent.bottom + 1;
    }, Number(aspect))).toBe(true);
  }
  await page.locator('[data-aspect="1.5"]').click();
  const viewports = testInfo.project.name === 'mobile'
    ? [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 667, height: 375 }]
    : [{ width: 1440, height: 960 }, { width: 1024, height: 768 }, { width: 768, height: 600 }];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => {
      const selectors = ['.topbar', '.tool-rail', '#studio-inspector', '.viewport-surface', '.capture-bar', '#photo-button', '#record-button', '#retouch-open'];
      return selectors.every(selector => {
        const bounds = document.querySelector(selector)!.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0 && bounds.left >= -1 && bounds.top >= -1 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1;
      }) && document.documentElement.scrollWidth <= innerWidth;
    })).toBe(true);
  }
});

test('viewport renders, moves and fits the screen', async ({ page }, testInfo) => {
  for (const path of ['/.env', '/.studio-data/studio.sqlite3', '/.venv/pyvenv.cfg']) {
    const response = await page.request.get(path);
    expect([403, 404]).toContain(response.status());
  }
  await page.locator('#viewport').scrollIntoViewIfNeeded();
  const pixels = await page.locator('#viewport canvas').evaluate((node: HTMLCanvasElement) => {
    const context = node.getContext('webgl2');
    if (!context) throw new Error('WebGL2 is unavailable');
    const data = new Uint8Array(node.width * node.height * 4);
    context.readPixels(0, 0, node.width, node.height, context.RGBA, context.UNSIGNED_BYTE, data);
    const colors = new Set<string>();
    for (let offset = 0; offset < data.length; offset += 64) colors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`);
    return { width: node.width, height: node.height, colors: colors.size };
  });
  expect(pixels.width).toBeGreaterThan(250);
  expect(pixels.height).toBeGreaterThan(150);
  expect(pixels.colors).toBeGreaterThan(100);
  const frame = () => page.locator('#viewport canvas').evaluate((node: HTMLCanvasElement) => node.toDataURL());
  const before = await frame();
  await page.getByRole('tab', { name: '镜头', exact: true }).click();
  await page.locator('#auto-orbit').check();
  await expect.poll(frame).not.toBe(before);
  await page.locator('#auto-orbit').uncheck();
  const layout = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth,
    broken: [...document.images].filter(image => image.getAttribute('src') && !image.naturalWidth).map(image => image.src) }));
  expect(layout.content).toBeLessThanOrEqual(layout.width);
  expect(layout.broken).toEqual([]);
  await page.locator('#viewport').scrollIntoViewIfNeeded();
  if (process.env.STUDIO_SCREENSHOTS === '1') await page.screenshot({ path: testInfo.outputPath('studio.png'), fullPage: true });
});