import { JOINTS, validPose } from '../src/pose-schema';
import { createDefaultState, validProject } from '../src/project-schema';
import { loadPoseLibrary, validatePoseLibrary } from '../src/pose-library';
import { createPoseBrowser } from '../src/pose-browser';
import { createStudio, createStudioLight, LIGHT_DEFINITIONS } from '../src/studio-scene';
import { createCaptureController } from '../src/capture';
import { createPoseStore } from '../src/pose-store';
import { CHARACTERS, validateVrmBytes } from '../src/character';
import { createLibraryClient } from '../src/library-client';
import { SHOT_CATEGORIES, createBuiltInShots, loadBuiltInShots, createShotProject, validShot } from '../src/shot-presets';
import { Scene, Box3, Vector3, PerspectiveCamera, Object3D, Quaternion } from 'three';
import { LimbIK } from '../src/pose-ik';
import { PROP_TYPES, MAX_PROPS, createPropState, validProps } from '../src/prop-schema';
import { createPropsController } from '../src/props';
import { createShotBrowser } from '../src/shot-browser';
import { createShotModel } from '../src/shot-model';
import { createImagePreview } from '../src/image-preview';

function shotFixture() {
  return { id: 'shot-' + 'a'.repeat(32), name: '模拟单人', category: '肖像', notes: '仅测试模拟数据',
    sourceName: 'fixture.png', thumbnail: 'data:image/jpeg;base64,AAAA', scene: {
      jointPose: { format: 'studio-pose', version: 1, units: 'radians', rotation: 0,
        placement: { grounded: true, height: 0 }, joints: { head: [0, 0, 0] } },
      cameraPosition: [0, 2, 8], target: [0, 1.6, 0], focal: 50, aspect: '1.5', exposure: 0.5, backdrop: '#edf4f6',
      props: [{ type: 'block', position: [1, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1], color: '#ffffff' }],
      lights: Object.fromEntries(['key', 'fill', 'rim'].map(id => [id, { enabled: true, intensity: 3, color: '#ffffff', position: 0, height: 3, depth: 2 }])),
    } };
}

async function waitUntil(predicate, message = 'timed out waiting for UI state') {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (predicate()) return;
    await new Promise(requestAnimationFrame);
  }
  throw new Error(typeof message === 'function' ? message() : message);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}

function captureFixture(failure) {
  const root = document.createElement('div');
  root.innerHTML = '<div class="viewfinder" hidden></div><span id="take-number">01</span><button id="record-button"></button><span id="record-label"></span><span id="record-time"></span><span id="recording-indicator" hidden></span><button id="photo-button"></button><select id="pose-mode" disabled></select>';
  const state = { size: [320, 200], ratio: 2, stopped: 0, resized: 0, photos: 0, frames: [], messages: [] };
  const floorMarks = { visible: true };
  const character = { vrm: {}, editing: true, setEditing(value) { this.editing = value; }, update() {} };
  const camera = { aspect: 1.6, updateProjectionMatrix() {} };
  const fail = (stage) => { if (failure === stage) throw new Error(`Expected ${stage} failure`); };
  class Recorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor() {
      super();
      fail('constructor');
      this.state = 'inactive';
      state.recorder = this;
    }
    start() { fail('start'); this.state = 'recording'; }
    stop() { fail('stop'); this.state = 'inactive'; this.dispatchEvent(new Event('stop')); }
  }
  const renderer = {
    getSize: (target) => target.set(...state.size),
    getPixelRatio: () => state.ratio,
    setPixelRatio: (value) => { state.ratio = value; },
    setSize: (width, height) => { state.size = [width, height]; },
    domElement: {
      toDataURL() { fail('photo'); return 'data:image/png;base64,test'; },
      captureStream() { fail('stream'); return { getTracks: () => [{ stop: () => state.stopped++ }] }; },
    },
  };
  const capture = createCaptureController({
    renderer, camera, character, floorMarks, root, Recorder,
    composer: {
      setSize() {},
      render() { fail('render'); state.frames.push({ size: [...state.size], marks: floorMarks.visible, editing: character.editing }); },
    },
    getAspect: () => 1.5, isLoading: () => false,
    onPhoto: () => state.photos++, onResize: () => state.resized++,
    announce: (message) => state.messages.push(message),
  });
  return { capture, state, root, character, camera, floorMarks };
}

export async function runTests() {
  const results = [];
  const test = async (name, run) => {
    try { await run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };
  const catalog = await loadPoseLibrary();
  await test('typed shot model filters, applies snapshots and protects built-ins', async () => {
    const builtIn = shotFixture();
    const personal = { ...shotFixture(), id: 'shot-' + 'b'.repeat(32), category: '其他' };
    let saved = { version: 1, items: [personal] };
    let writes = 0;
    const model = createShotModel({ builtIns: [builtIn], isAvailable: () => true, confirmDelete: () => true,
      apply(item) { item.name = 'changed'; },
      client: { async settings() { return saved; }, async saveSettings(name, value) { saved = value; writes++; } },
      request: async () => new Response(JSON.stringify({ configured: false })) });
    try {
      await model.ready;
      await model.applySelected();
      equal(model.selected().name, builtIn.name);
      await model.removeSelected(); equal(writes, 0);
      model.setCategory('其他'); equal(model.visible().length, 1);
      await model.removeSelected(); equal(saved.items, []); equal(writes, 1);
      model.setCategory(''); equal(model.visible().length, 1);
    } finally { model.dispose(); }
  });
  await test('image preview fits, zooms, preserves its parent dialog and releases the image', async () => {
    const parent = document.createElement('dialog');
    parent.innerHTML = '<button type="button">Open preview</button>';
    document.body.append(parent);
    const preview = createImagePreview();
    try {
      parent.showModal();
      parent.querySelector('button').focus();
      const canvas = document.createElement('canvas');
      canvas.width = 1200; canvas.height = 800;
      assert(await preview.open(canvas.toDataURL(), 'Preview test'), 'image failed to load');
      assert(parent.open && preview.dialog.open, 'parent dialog closed');
      const image = preview.dialog.querySelector('img');
      const viewport = preview.dialog.querySelector('.image-viewer-viewport');
      assert(image.getBoundingClientRect().width <= viewport.clientWidth + 1, 'initial image does not fit');
      preview.dialog.querySelector('[data-preview="actual"]').click();
      equal(preview.dialog.querySelector('output').value, '100%');
      preview.dialog.querySelector('[data-preview="in"]').click();
      equal(preview.dialog.querySelector('output').value, '125%');
      preview.dialog.querySelector('[data-preview="fit"]').click();
      assert(image.getBoundingClientRect().height <= viewport.clientHeight + 1, 'fit height overflow');
      preview.dialog.querySelector('[data-preview="close"]').click();
      await waitUntil(() => !image.hasAttribute('src'));
      assert(parent.open && document.activeElement === parent.querySelector('button'), 'focus or parent dialog not restored');
      assert(!await preview.open('data:image/png;base64,AAAA', 'Invalid image'), 'invalid image accepted');
      equal(preview.dialog.querySelector('[role="status"]').textContent, '图片无法加载');
      preview.dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert(!preview.dialog.open && parent.open, 'Escape did not close only the preview');
    } finally { preview.destroy(); parent.close(); parent.remove(); }
  });
  await test('props validate dimensions, limits and unique identities', () => {
    const items = Object.keys(PROP_TYPES).map(createPropState);
    assert(validProps(items), 'valid props rejected');
    for (const mutate of [
      entries => { entries[0].size[0] = 0; },
      entries => { entries[0].position[1] = Infinity; },
      entries => { entries[0].rotation[2] = Math.PI + 0.1; },
      entries => { entries[0].type = 'unknown'; },
      entries => { entries[1].id = entries[0].id; },
      entries => { entries[0].color = 'red'; },
    ]) {
      const invalid = structuredClone(items);
      mutate(invalid);
      assert(!validProps(invalid), 'invalid props accepted');
    }
    assert(!validProps(Array.from({ length: MAX_PROPS + 1 }, () => createPropState('block'))), 'prop limit ignored');
  });
  await test('prop controller adds, edits, duplicates, deletes and restores real meshes', () => {
    const root = document.createElement('div');
    const scene = new Scene();
    let changes = 0;
    let available = true;
    const controller = createPropsController({ scene, root, onBeforeChange() {}, onChange() { changes++; }, onFrame() {}, isAvailable: () => available, announce() {} });
    try {
      for (const type of Object.keys(PROP_TYPES)) {
        root.querySelector('#prop-type').value = type;
        root.querySelector('#prop-type').dispatchEvent(new Event('change', { bubbles: true }));
        root.querySelector('#prop-add').click();
      }
      const before = controller.capture();
      equal(before.length, 4);
      equal(new Set(before.map(item => item.position[0])).size, 4);
      for (const [index, model] of controller.group.children.entries()) {
        const bounds = new Box3().setFromObject(model);
        const size = bounds.getSize(new Vector3()).toArray();
        assert(size.every((value, axis) => Math.abs(value - before[index].size[axis]) < 0.0001), 'incorrect prop dimensions');
        assert(Math.abs(bounds.min.y) < 0.0001, 'prop does not rest on floor');
      }
      const width = root.querySelector('[data-prop-field="size"][data-axis="0"]');
      width.value = '2.5'; width.dispatchEvent(new Event('input', { bubbles: true }));
      equal(controller.capture()[3].size[0], 2.5);
      width.value = '0'; width.dispatchEvent(new Event('input', { bubbles: true }));
      equal(controller.capture()[3].size[0], 2.5);
      root.querySelector('#prop-copy').click();
      equal(controller.capture().length, 5);
      assert(validProps(controller.capture()), 'duplicate identity after copy');
      root.querySelector('#prop-delete').click();
      equal(controller.capture().length, 4);
      controller.restore(before);
      equal(controller.capture(), before);
      let rejected = false;
      try { controller.restore([{ ...before[0], size: [-1, 1, 1] }]); } catch { rejected = true; }
      assert(rejected, 'invalid restore accepted');
      equal(controller.capture(), before);
      available = false;
      root.querySelector('#prop-add').click();
      root.querySelector('#prop-delete').click();
      equal(controller.capture(), before);
      controller.restore([]);
      equal(controller.group.children.length, 0);
      assert(changes >= 7, 'changes not reported');
    } finally { controller.dispose(); }
    equal(scene.children.length, 0);
  });
  await test('prop gizmo synchronizes transforms, clamps bounds and restores camera controls', () => {
    const root = document.createElement('div');
    const canvas = document.createElement('canvas');
    const scene = new Scene();
    const orbit = { enabled: true, autoRotate: true };
    let history = 0;
    const controller = createPropsController({ scene, root, canvas, camera: new PerspectiveCamera(), orbit,
      onBeforeChange() { history++; }, onChange() {}, onFrame() {}, isAvailable: () => true, announce() {} });
    try {
      root.querySelector('#prop-type').value = 'block';
      root.querySelector('#prop-type').dispatchEvent(new Event('change', { bubbles: true }));
      root.querySelector('#prop-add').click();
      controller.setEditing(true);
      const model = controller.gizmo.object;
      controller.gizmo.dispatchEvent({ type: 'mouseDown' });
      assert(!orbit.enabled && !orbit.autoRotate, 'orbit not locked');
      model.position.set(2, 3, 4);
      model.rotation.set(0.1, 0.2, 0.3);
      model.scale.set(2, 0, 20);
      controller.gizmo.dispatchEvent({ type: 'objectChange' });
      equal(controller.capture()[0].position, [2, 3, 4]);
      equal(controller.capture()[0].size, [2, 0.02, 10]);
      equal(root.querySelector('[data-prop-field="position"][data-axis="1"]').value, '3');
      controller.gizmo.dispatchEvent({ type: 'mouseUp' });
      assert(orbit.enabled && orbit.autoRotate, 'orbit not restored');
      equal(history, 2);
      root.querySelector('[data-prop-mode="rotate"]').click();
      equal(controller.gizmo.mode, 'rotate');
      controller.setHelpersVisible(false);
      assert(!controller.gizmo.object && !controller.gizmo.enabled, 'capture helper visible');
      controller.setHelpersVisible(true);
      assert(controller.gizmo.object === model, 'selection not restored');
      controller.restore([]);
      assert(!controller.gizmo.object, 'deleted selection attached');
    } finally { controller.dispose(); }
    equal(scene.children.length, 0);
  });
  await test('project props remain optional and reject unsafe scene data', () => {
    const state = createDefaultState(catalog.defaultPose, LIGHT_DEFINITIONS);
    const registry = { poses: { [catalog.defaultPose]: {} }, characters: {}, lightDefinitions: LIGHT_DEFINITIONS };
    delete state.props;
    assert(validProject({ version: 1, state }, registry), 'legacy project rejected');
    state.props = [createPropState('flowers')];
    assert(validProject({ version: 1, state }, registry), 'prop project rejected');
    state.props[0].size[1] = 11;
    assert(!validProject({ version: 1, state }, registry), 'invalid prop project accepted');
  });
  await test('twenty authored shots reuse distinct catalog poses and neutral backgrounds', () => {
    const drafts = createBuiltInShots(catalog);
    const thumbnails = Object.fromEntries(drafts.map(item => [item.id, shotFixture().thumbnail]));
    const presets = createBuiltInShots(catalog, thumbnails);
    equal(presets.length, 20);
    equal(new Set(presets.map(item => item.id)).size, 20);
    equal(new Set(presets.map(item => item.sourceName)).size, 20);
    for (const category of SHOT_CATEGORIES) equal(presets.filter(item => item.category === category).length, 5);
    for (const preset of presets) {
      assert(validShot(preset), `invalid authored preset: ${preset.name}`);
      equal(preset.scene.backdrop, '#eef2f4');
      equal(preset.scene.props.length, 0);
    }
    presets[0].scene.jointPose.joints.head = [1, 1, 1];
    assert(JSON.stringify(createBuiltInShots(catalog)[0].scene.jointPose.joints.head) !== '[1,1,1]', 'catalog pose was mutated');
  });
  await test('bundled shot previews load as twenty distinct JPEG images', async () => {
    const presets = await loadBuiltInShots(catalog);
    equal(presets.length, 20);
    equal(new Set(presets.map(preset => preset.thumbnail)).size, 20);
    for (const preset of presets) {
      const image = new Image();
      image.src = preset.thumbnail;
      await image.decode();
      equal(Math.max(image.naturalWidth, image.naturalHeight), 320);
    }
  });
  await test('built-in shots are read-only and remain separate from personal presets', async () => {
    const root = document.createElement('div');
    const builtIn = shotFixture();
    const personal = { ...shotFixture(), id: 'shot-' + 'b'.repeat(32), category: '其他', name: '个人条目' };
    let saved = { version: 1, items: [personal] };
    let writes = 0;
    let applied;
    const controller = createShotBrowser({ root, builtIns: [builtIn], isAvailable: () => true,
      apply(item) { applied = item.id; }, confirmDelete: () => true,
      client: { async settings() { return saved; }, async saveSettings(name, value) { writes++; saved = value; } },
      request: async () => new Response(JSON.stringify({ configured: false })) });
    try {
      await controller.ready;
      equal(controller.model.visible().length, 2);
      assert(root.querySelector('#shot-preset[role="combobox"]'), 'searchable preset picker missing');
      assert(root.querySelector('#shot-delete').disabled, 'built-in deletion was enabled');
      root.querySelector('#shot-delete').click(); equal(writes, 0);
      await controller.model.applySelected(); equal(applied, builtIn.id);
      controller.model.setCategory('其他');
      await waitUntil(() => root.querySelector('#shot-select').textContent.includes(personal.name));
      equal(controller.model.visible().length, 1);
      assert(!root.querySelector('#shot-delete').disabled, 'personal deletion was disabled');
      root.querySelector('#shot-delete').click();
      await waitUntil(() => !controller.model.getSnapshot().busy);
      equal(saved.items.length, 0); equal(writes, 1);
      controller.model.setCategory('');
      await waitUntil(() => root.querySelector('#shot-select').textContent.includes(builtIn.name));
      equal(controller.model.visible().length, 1);
      equal(root.querySelector('#shot-count').textContent, '内置 1 · 自存 0 / 100');
      assert(root.querySelector('#shot-source-input'), 'AI upload was removed');
    } finally { controller.dispose(); }
  });
  await test('AI shot presets validate and create independent editable projects', () => {
    const preset = shotFixture();
    equal(SHOT_CATEGORIES.length, 4);
    assert(validShot(preset), 'valid AI preset rejected');
    const project = createShotProject(preset);
    equal(project.state.backdrop, '#eef2f4');
    equal(project.state.background, null);
    assert(validProject(project, { poses: {}, characters: {}, lightDefinitions: LIGHT_DEFINITIONS }), 'AI project invalid');
    project.state.props[0].position[0] = 4;
    equal(preset.scene.props[0].position[0], 1);
    assert(!validShot({ ...preset, category: 'unknown' }), 'invalid category accepted');
    assert(!validShot({ ...preset, thumbnail: 'https://example.com/image.png' }), 'remote thumbnail accepted');
    assert(!validShot({ ...preset, scene: { ...preset.scene, backdrop: 'invalid' } }), 'invalid backdrop accepted');
    assert(!validShot({ ...preset, scene: { ...preset.scene, cameraPosition: preset.scene.target } }), 'degenerate camera accepted');
  });
  await test('AI browser requires consent, previews explicitly, saves categories and retains failed drafts', async () => {
    const root = document.createElement('div');
    let saved = null;
    let calls = 0;
    let applied = 0;
    let reject = false;
    let failSave = false;
    const options = { root, isAvailable: () => true, apply() { applied++; }, confirmDelete: () => true,
      client: { async settings() { return saved; }, async saveSettings(name, value) {
        equal(name, 'shots');
        if (failSave) throw new Error('settings_conflict');
        saved = structuredClone(value);
      } },
      request: async (url, init) => {
        if (url.endsWith('/status')) return new Response(JSON.stringify({ configured: true, deployment: 'mock', token: 'test' }));
        calls++;
        assert(JSON.parse(init.body).consent === true, 'missing consent');
        return new Response(JSON.stringify(reject ? { error: 'single_person_required' } : { preset: shotFixture() }), { status: reject ? 422 : 200 });
      } };
    let controller = createShotBrowser(options);
    try {
      await controller.ready;
      equal(controller.model.visible().length, 0);
      const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
      const blob = await new Promise(resolve => canvas.toBlob(resolve));
      const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'fixture.png', { type: 'image/png' }));
      await controller.model.upload(transfer.files[0]);
      await waitUntil(() => !root.querySelector('#shot-source-preview').hidden, () => 'first image: ' + root.querySelector('#shot-ai-status').textContent);
      root.querySelector('#shot-generate').click(); equal(calls, 0);
      const consent = root.querySelector('#shot-consent');
      controller.model.setConsent(true);
      await controller.model.generate();
      await waitUntil(() => !root.querySelector('#shot-result').hidden);
      equal(calls, 1); equal(applied, 0); equal(saved, null);
      assert(!consent.checked && !root.querySelector('#shot-result').hidden, 'result or consent state invalid');
      await controller.model.previewDraft(); equal(applied, 1);
      controller.model.editDraft({ name: '自定名称', category: '写真集' });
      failSave = true;
      await controller.model.saveDraft();
      assert(!root.querySelector('#shot-result').hidden && saved === null, 'failed save lost draft');
      failSave = false;
      await controller.model.saveDraft();
      equal(saved.items[0].name, '自定名称'); equal(saved.items[0].category, '写真集');
      controller.dispose(); controller = createShotBrowser(options); await controller.ready;
      equal(controller.model.visible().length, 1);
      controller.model.setCategory('时尚封面');
      await waitUntil(() => !root.querySelector('#shot-empty').hidden);
      equal(controller.model.visible().length, 0);
      controller.model.setCategory('');
      await controller.model.removeSelected();
      equal(saved.items, []);
      reject = true;
      const nextTransfer = new DataTransfer(); nextTransfer.items.add(new File([blob], 'fixture.png', { type: 'image/png' }));
      await controller.model.upload(nextTransfer.files[0]);
      await waitUntil(() => !root.querySelector('#shot-source-preview').hidden);
      controller.model.setConsent(true);
      await controller.model.generate();
      assert(root.querySelector('#shot-result').hidden, 'multiple-person response produced draft');
      equal(applied, 1); equal(saved.items, []);
    } finally { controller.dispose(); }
  });
  await test('local settings writes are serialized with revision and token', async () => {
    const writes = [];
    const client = createLibraryClient(async (url, options) => {
      if (url === '/api/ai/status') return { ok: true, json: async () => ({ token: 'local-test' }) };
      equal(options.headers['X-Studio-Token'], 'local-test');
      if (options.method === 'GET') return { ok: true, json: async () => ({ value: null, revision: 3 }) };
      const body = JSON.parse(options.body);
      writes.push(body);
      return { ok: true, json: async () => ({ revision: body.revision + 1 }) };
    });
    await client.settings('scene');
    await Promise.all([client.saveSettings('scene', { version: 1 }), client.saveSettings('scene', { version: 2 })]);
    equal(writes.map(write => write.revision), [3, 4]);
    equal(writes.map(write => write.value.version), [1, 2]);
  });
  await test('local storage rejects stale configurations without advancing revision', async () => {
    const revisions = [];
    const client = createLibraryClient(async (url, options) => {
      if (url === '/api/ai/status') return { ok: true, json: async () => ({ token: 'local-test' }) };
      if (options.method === 'GET') return { ok: true, json: async () => ({ value: null, revision: 2 }) };
      revisions.push(JSON.parse(options.body).revision);
      return { ok: false, json: async () => ({ error: 'settings_conflict' }) };
    });
    for (const value of [{ version: 1 }, { version: 2 }]) {
      let error;
      try { await client.saveSettings('scene', value); } catch (caught) { error = caught; }
      equal(error?.code, 'settings_conflict');
    }
    equal(revisions, [2, 2]);
  });
  const registry = {
    poses: Object.fromEntries(catalog.poses.map((pose) => [pose.id, pose.joints])),
    characters: { pixiv: {} }, lightDefinitions: LIGHT_DEFINITIONS,
  };
  function storageFixture() {
    let text = null;
    return { getItem: () => text, setItem: (key, value) => { text = value; } };
  }
  const savedPose = { format: 'studio-pose', version: 1, units: 'radians', rotation: 0.4, placement: { grounded: false, height: 1.5 }, joints: { head: [0.2, 0.1, 0] } };
  await test('all Standard poses are built in and categorized without local storage', () => {
    const clean = createPoseStore(catalog, () => ({ getItem: () => null })).catalog;
    const imported = clean.poses.filter(pose => pose.source?.pack === 'Universal Animation Library Standard');
    equal(clean.poses.length, 73);
    equal(clean.defaultPose, 'warrior');
    equal(imported.length, 43);
    equal(new Set(imported.map(pose => pose.source.clip)).size, 43);
    const counts = Object.fromEntries([...new Set(imported.map(pose => pose.folder))]
      .map(folder => [folder, imported.filter(pose => pose.folder === folder).length]));
    equal(Object.values(counts), [2, 6, 7, 7, 3, 8, 6, 4]);
    assert(imported.every(pose => pose.folder.startsWith('Quaternius · ')
      && Object.keys(pose.joints).length === 51 && pose.source.license === 'CC0-1.0'), 'incomplete imported metadata');
  });
  await test('fashion dataset includes twelve editable grounded poses in three folders', () => {
    const fashion = createPoseStore(catalog, () => ({ getItem: () => null })).catalog.poses
      .filter(pose => pose.source?.pack === 'Studio Fashion Poses');
    equal(fashion.length, 12);
    equal([...new Set(fashion.map(pose => pose.folder))].map(folder => fashion.filter(pose => pose.folder === folder).length), [4, 4, 4]);
    equal(fashion.map(pose => pose.id), ['fashionFront', 'fashionBack', 'fashionSide', 'fashionThreeQuarter',
      'fashionSleeves', 'fashionWaist', 'fashionTrousers', 'fashionCuff', 'fashionStep', 'fashionWeightShift', 'fashionTurn', 'fashionWideStep']);
    for (const pose of fashion) {
      equal(pose.placement, { grounded: true, height: 0 });
      assert(validPose({ format: 'studio-pose', version: 1, units: 'radians', ...pose }), pose.id);
      const store = createPoseStore(catalog, storageFixture);
      const updated = store.save(pose.id, { format: 'studio-pose', version: 1, units: 'radians',
        rotation: pose.rotation, placement: pose.placement, joints: pose.joints });
      equal(updated.joints, pose.joints);
      equal(updated.rotation, pose.rotation);
    }
    equal(fashion.find(pose => pose.id === 'fashionBack').rotation, Math.PI);
    equal(fashion.find(pose => pose.id === 'fashionSide').rotation, Math.PI / 2);
  });
  await test('save overrides one preset and preserves source catalog', () => {
    const before = JSON.stringify(catalog);
    const storage = storageFixture();
    const store = createPoseStore(catalog, () => storage);
    const saved = store.save(catalog.defaultPose, savedPose);
    equal(saved.id, catalog.defaultPose);
    equal(saved.joints, savedPose.joints);
    equal(saved.rotation, savedPose.rotation);
    equal(saved.placement, savedPose.placement);
    equal(store.catalog.poses.length, catalog.poses.length);
    equal(JSON.stringify(catalog), before);
  });
  await test('save as and reload preserves full pose', () => {
    const storage = storageFixture();
    const store = createPoseStore(catalog, () => storage);
    const saved = store.saveAs({ name: 'New Pose', folder: 'New Folder' }, savedPose);
    const restored = createPoseStore(catalog, () => storage);
    equal(restored.catalog.poses.length, catalog.poses.length + 1);
    equal(restored.catalog.poses.find((pose) => pose.id === saved.id), saved);
    restored.save(saved.id, { ...savedPose, rotation: 0.8 });
    equal(restored.catalog.poses.length, catalog.poses.length + 1);
    equal(restored.catalog.poses.find((pose) => pose.id === saved.id).rotation, 0.8);
  });
  await test('invalid or duplicate saves leave storage unchanged', () => {
    const storage = storageFixture();
    const store = createPoseStore(catalog, () => storage);
    const entry = catalog.poses[0];
    for (const details of [{ name: ' ', folder: 'New' }, { name: 'New', folder: '' }, { name: 'x'.repeat(81), folder: 'New' }, { name: entry.name, folder: entry.folder }]) {
      let rejected = false;
      try { store.saveAs(details, savedPose); } catch { rejected = true; }
      assert(rejected, 'invalid metadata accepted');
    }
    let rejected = false;
    try { store.save(entry.id, { ...savedPose, rotation: Infinity }); } catch { rejected = true; }
    assert(rejected, 'invalid snapshot accepted');
    equal(storage.getItem(), null);
  });
  await test('storage failure does not mutate the active catalog', () => {
    const storage = storageFixture();
    const store = createPoseStore(catalog, () => storage);
    const before = store.catalog;
    storage.setItem = () => { throw new Error('Quota'); };
    let rejected = false;
    try { store.save(catalog.defaultPose, savedPose); } catch { rejected = true; }
    assert(rejected, 'quota failure swallowed');
    equal(store.catalog, before);
  });
  await test('corrupted storage falls back without overwriting data', () => {
    const storage = storageFixture();
    storage.setItem('', '{invalid');
    const store = createPoseStore(catalog, () => storage);
    assert(store.warning, 'missing corruption warning');
    equal(store.catalog, catalog);
    let rejected = false;
    try { store.save(catalog.defaultPose, savedPose); } catch { rejected = true; }
    assert(rejected, 'corrupt storage overwritten');
    equal(storage.getItem(), '{invalid');
  });
  await test('stale tab cannot overwrite a newer library', () => {
    const storage = storageFixture();
    const first = createPoseStore(catalog, () => storage);
    const second = createPoseStore(catalog, () => storage);
    first.save(catalog.defaultPose, savedPose);
    const written = storage.getItem();
    let rejected = false;
    try { second.save(catalog.defaultPose, { ...savedPose, rotation: 0.9 }); } catch { rejected = true; }
    assert(rejected, 'stale write accepted');
    equal(storage.getItem(), written);
  });
  await test('pose protocol and catalog', () => {
    equal(JOINTS.length, 51);
    for (const pose of catalog.poses) assert(validPose({ format: 'studio-pose', version: 1, units: 'radians', rotation: 0, joints: pose.joints }), pose.id);
  });
  for (const [name, mutate] of [
    ['duplicate ID', (data) => data.poses.push(data.poses[0])],
    ['unknown joint', (data) => { data.poses[0].joints.invalid = [0, 0, 0]; }],
    ['invalid angle', (data) => { data.poses[0].joints.head = [4, 0, 0]; }],
    ['missing default', (data) => { data.defaultPose = 'missing'; }],
  ]) {
    await test(`reject ${name}`, () => {
      const data = structuredClone(catalog);
      mutate(data);
      let rejected = false;
      try { validatePoseLibrary(data); } catch { rejected = true; }
      assert(rejected, name);
    });
  }
  await test('original animation mannequin asset and project', async () => {
    const response = await fetch(CHARACTERS.quaternius.url);
    assert(response.ok, 'original mannequin asset missing');
    const model = validateVrmBytes(await response.arrayBuffer(), false);
    equal(model.animations?.length ?? 0, 0);
    equal(model.skins[0].joints.length, 65);
    equal(model.meshes.flatMap(mesh => mesh.primitives).length, 2);
    equal(model.materials.map(material => material.name).sort(), ['M_Joints', 'M_Main']);
    const preview = await createImageBitmap(await (await fetch('/assets/characters/quaternius-original.png')).blob());
    equal([preview.width, preview.height], [320, 400]);
    preview.close();
    const state = createDefaultState(catalog.defaultPose, LIGHT_DEFINITIONS);
    state.character = 'quaternius';
    assert(validProject({ version: 1, state }, { ...registry, characters: CHARACTERS }), 'original mannequin project rejected');
  });
  await test('legacy project and floating pose', () => {
    const state = createDefaultState(catalog.defaultPose, LIGHT_DEFINITIONS);
    for (const light of Object.values(state.lights)) { delete light.height; delete light.depth; }
    assert(validProject({ version: 1, state }, registry), 'legacy defaults rejected');
    state.jointPose = { format: 'studio-pose', version: 1, units: 'radians', rotation: 0.2, joints: { head: [0.1, 0, 0] }, placement: { grounded: false, height: 1.5 } };
    assert(validProject({ version: 1, state }, registry), 'floating pose rejected');
    const portable = structuredClone(state);
    portable.pose = 'user-other-browser';
    portable.poseSaveTarget = portable.pose;
    assert(validProject({ version: 1, state: portable }, registry), 'portable project rejected');
    delete portable.jointPose;
    assert(!validProject({ version: 1, state: portable }, registry), 'unknown pose without snapshot accepted');
    state.jointPose.placement.height = Infinity;
    assert(!validProject({ version: 1, state }, registry), 'invalid placement accepted');
  });
  await test('light registry expansion', () => {
    const expanded = { ...registry, lightDefinitions: [...LIGHT_DEFINITIONS, { id: 'extra', color: '#ffffff', intensity: 1, position: [0, 3, 0] }] };
    const project = { version: 1, state: createDefaultState(catalog.defaultPose, expanded.lightDefinitions) };
    assert(validProject(project, expanded), 'extra registered light rejected');
    assert(!validProject(project, registry), 'unregistered light accepted');
    delete project.state.lights.extra;
    assert(!validProject(project, expanded), 'missing light accepted');
  });
  await test('scene factory geometry and lights', () => {
    const studio = createStudio();
    equal(studio.floorMarks.children.length, 4);
    const sweep = studio.group.getObjectByName('Cyclorama');
    sweep.geometry.computeBoundingBox();
    equal(sweep.geometry.boundingBox.max.toArray(), [7, 7, 8]);
    const groups = [studio.group];
    for (const definition of LIGHT_DEFINITIONS) {
      const rig = createStudioLight(definition, 1024);
      groups.push(rig.group);
      equal(rig.light.position.toArray(), definition.position);
      equal(rig.light.intensity, definition.intensity * 8);
      equal(rig.light.shadow.mapSize.toArray(), [1024, 1024]);
    }
    const materials = new Set();
    for (const group of groups) group.traverse((object) => {
      object.geometry?.dispose();
      if (object.material) materials.add(object.material);
    });
    materials.forEach((material) => material.dispose());
  });
  await test('normalized IK nodes retain endpoint orientation and dispose targets', () => {
    const scene = new Scene();
    const upper = new Object3D();
    const lower = new Object3D();
    const hand = new Object3D();
    upper.add(lower); lower.add(hand); scene.add(upper);
    lower.position.x = 1; hand.position.x = 1;
    scene.updateMatrixWorld(true);
    const solver = new LimbIK({ leftUpperArm: upper, leftLowerArm: lower, leftHand: hand }, scene);
    const target = new Vector3(1.4, 0, 0.7);
    try {
      equal(solver.solve('leftHand', target), ['leftUpperArm', 'leftLowerArm', 'leftHand']);
      assert(hand.getWorldPosition(new Vector3()).distanceTo(target) < 0.08, 'IK endpoint did not reach target');
      assert(hand.getWorldQuaternion(new Quaternion()).angleTo(new Quaternion()) < 0.001, 'IK changed endpoint orientation');
      equal(solver.solve('missing', target), []);
    } finally { solver.dispose(); }
    assert(solver.target.parent === null && solver.chains.size === 0, 'IK targets were not released');
  });

  await test('normal capture archives once without downloading', () => {
    const { capture, state, root } = captureFixture();
    const original = HTMLAnchorElement.prototype.click;
    let downloads = 0;
    HTMLAnchorElement.prototype.click = () => { downloads++; };
    try {
      const photo = capture.takePhoto();
      assert(photo.name.endsWith('.png'), 'missing photo name');
      equal(state.photos, 1);
      equal(downloads, 0);
      equal(root.querySelector('#take-number').textContent, '02');
    } finally { HTMLAnchorElement.prototype.click = original; }
  });
  for (const failure of [undefined, 'photo']) {
    await test(`photo restoration ${failure ?? 'success'}`, () => {
      const { capture, state, root, character, camera, floorMarks } = captureFixture(failure);
      let error;
      try { equal(capture.takePhoto({ download: false }).name, '当前场景.png'); } catch (caught) { error = caught; }
      assert(failure ? error?.message === 'Expected photo failure' : !error, 'unexpected capture outcome');
      equal(state.frames, [{ size: [1920, 1280], marks: false, editing: false }]);
      equal(state.size, [320, 200]);
      equal(state.ratio, 2);
      equal(camera.aspect, 1.6);
      equal(state.photos, 0);
      equal(root.querySelector('#take-number').textContent, '01');
      assert(floorMarks.visible && character.editing && root.querySelector('.viewfinder').hidden, 'view state not restored');
    });
  }
  for (const failure of ['render', 'stream', 'constructor', 'start', 'stop', 'error', undefined]) {
    await test(`recording cleanup ${failure ?? 'normal stop'}`, () => {
      const { capture, state, root, character } = captureFixture(failure);
      try {
        capture.toggleRecording();
        if (capture.isRecording) {
          assert(root.querySelector('#photo-button').disabled && !character.editing, 'controls not locked');
          assert(!capture.takePhoto({ download: false }), 'photo accepted during recording');
          if (failure === 'error') state.recorder.dispatchEvent(new Event('error'));
          else capture.toggleRecording();
        }
        state.recorder?.dispatchEvent(new Event('stop'));
        equal(state.stopped, ['render', 'stream'].includes(failure) ? 0 : 1);
        equal(state.resized, 1);
        assert(!capture.isRecording && character.editing, 'recording state not cleared');
        assert(!root.querySelector('#photo-button').disabled && root.querySelector('#pose-mode').disabled, 'disabled state not restored');
        assert(root.querySelector('#recording-indicator').hidden, 'indicator not cleared');
      } finally {
        state.recorder?.dispatchEvent(new Event('error'));
      }
    });
  }
  await test('disposing active recording stops tracks without late UI or download callbacks', () => {
    const { capture, state, character } = captureFixture();
    capture.toggleRecording();
    assert(capture.isRecording, 'recording did not start');
    capture.dispose();
    capture.dispose();
    state.recorder.dispatchEvent(new Event('stop'));
    state.recorder.dispatchEvent(new Event('error'));
    capture.toggleRecording();
    equal(state.stopped, 1);
    equal(state.resized, 0);
    assert(!capture.isRecording && character.editing, 'disposed recorder stayed active');
    assert(!capture.takePhoto(), 'disposed capture accepted a photo');
  });
  await test('data-only browser entry, filtering and selection', async () => {
    const root = document.createElement('div');
    root.innerHTML = '<div id="pose-library-home"></div>';
    const data = structuredClone(catalog);
    data.poses.push({ id: 'testEntry', name: 'Test Pose', folder: 'Test Folder', joints: { head: [0, 0, 0] } });
    let selected;
    const browser = createPoseBrowser(data, (pose) => { selected = pose.id; }, root);
    try {
    assert(root.querySelector('#pose-search[role="combobox"]'), 'searchable pose picker missing');
    for (const category of new Set(catalog.poses.filter(pose => pose.source).map(pose => pose.folder))) {
      browser.setFolder(category);
      const expected = catalog.poses.filter(pose => pose.folder === category);
      await waitUntil(() => root.querySelector('#pose-count').textContent === `${category} · ${expected.length} / ${expected.length}`);
      browser.choose(expected[0]);
      equal(selected, expected[0].id);
    }
    browser.updateCatalog(data);
    browser.updateCatalog(data, { reveal: 'testEntry' });
    await waitUntil(() => root.querySelector('#pose-count').textContent === 'Test Folder · 1 / 1');
    equal(browser.getSnapshot().catalog.poses.length, data.poses.length);
    equal(browser.getSnapshot().folder, 'Test Folder');
    browser.choose(data.poses.find(pose => pose.id === 'testEntry'));
    equal(selected, 'testEntry');
    browser.setSelection(selected);
    await waitUntil(() => root.querySelector('#pose-library .ant-select-selection-item[title="Test Pose"]'));
    browser.setSelection(null);
    await waitUntil(() => !root.querySelector('#pose-library .ant-select-selection-item[title="Test Pose"]'));
    equal(root.querySelector('#pose-state').textContent, '自定义姿势');
    } finally { browser.dispose(); }
  });
  console.table(results);
  const failures = results.filter((result) => !result.passed);
  if (failures.length) throw new Error(JSON.stringify(failures));
  return { passed: results.length, results };
}