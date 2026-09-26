import { JOINTS, validPose } from '../src/pose-schema.js';
import { createDefaultState, validProject } from '../src/project-schema.js';
import { loadPoseLibrary, validatePoseLibrary } from '../src/pose-library.js';
import { createPoseBrowser } from '../src/pose-browser.js';
import { createStudio, createStudioLight, LIGHT_DEFINITIONS } from '../src/studio-scene.js';
import { createCaptureController } from '../src/capture.js';
import { createPoseStore } from '../src/pose-store.js';
import { CHARACTERS, validateVrmBytes } from '../src/character.js';

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
    equal(clean.poses.length, 61);
    equal(clean.defaultPose, 'warrior');
    equal(imported.length, 43);
    equal(new Set(imported.map(pose => pose.source.clip)).size, 43);
    const counts = Object.fromEntries([...new Set(imported.map(pose => pose.folder))]
      .map(folder => [folder, imported.filter(pose => pose.folder === folder).length]));
    equal(Object.values(counts), [2, 6, 7, 7, 3, 8, 6, 4]);
    assert(imported.every(pose => pose.folder.startsWith('Quaternius · ')
      && Object.keys(pose.joints).length === 51 && pose.source.license === 'CC0-1.0'), 'incomplete imported metadata');
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
  await test('data-only browser entry, filtering and selection', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div id="pose-library-home"><div id="pose-library"><select id="pose-folder"></select><nav id="pose-folders"></nav><input id="pose-search"><button id="pose-search-clear"></button><div id="pose-controls"></div><span id="pose-count"></span><p id="pose-empty"></p></div></div><dialog id="pose-dialog"><button id="pose-dialog-close"></button><div id="pose-dialog-body"></div></dialog><button id="pose-expand"></button><span id="pose-state"></span>';
    const data = structuredClone(catalog);
    data.poses.push({ id: 'testEntry', name: 'Test Pose', folder: 'Test Folder', joints: { head: [0, 0, 0] } });
    let selected;
    const browser = createPoseBrowser(data, (pose) => { selected = pose.id; }, root);
    for (const category of new Set(catalog.poses.filter(pose => pose.source).map(pose => pose.folder))) {
      const control = root.querySelector('#pose-folder');
      control.value = category;
      control.dispatchEvent(new Event('change'));
      const expected = catalog.poses.filter(pose => pose.folder === category);
      equal(root.querySelectorAll('[data-pose]:not([hidden])').length, expected.length);
      root.querySelector(`[data-pose="${expected[0].id}"]`).click();
      equal(selected, expected[0].id);
    }
    browser.updateCatalog(data);
    browser.updateCatalog(data, { reveal: 'testEntry' });
    equal(root.querySelectorAll('[data-pose]').length, data.poses.length);
    equal(root.querySelector('#pose-folder').value, 'Test Folder');
    const folder = root.querySelector('#pose-folder');
    folder.value = 'Test Folder';
    folder.dispatchEvent(new Event('change'));
    equal(root.querySelectorAll('[data-pose]:not([hidden])').length, 1);
    root.querySelector('[data-pose="testEntry"]').click();
    equal(selected, 'testEntry');
    browser.setSelection(selected);
    equal(root.querySelector('[data-pose][aria-pressed="true"]').dataset.pose, selected);
    browser.setSelection(null);
    equal(root.querySelectorAll('[data-pose][aria-pressed="true"]').length, 0);
    equal(root.querySelector('#pose-state').textContent, '自定义姿势');
  });
  console.table(results);
  const failures = results.filter((result) => !result.passed);
  if (failures.length) throw new Error(JSON.stringify(failures));
  return { passed: results.length, results };
}