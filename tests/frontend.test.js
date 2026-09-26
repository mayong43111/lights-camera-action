import { JOINTS, validPose } from '../src/pose-schema.js';
import { createDefaultState, validProject } from '../src/project-schema.js';
import { loadPoseLibrary, validatePoseLibrary } from '../src/pose-library.js';
import { createPoseBrowser } from '../src/pose-browser.js';
import { createStudio, createStudioLight, LIGHT_DEFINITIONS } from '../src/studio-scene.js';
import { createCaptureController } from '../src/capture.js';

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
  await test('legacy project and floating pose', () => {
    const state = createDefaultState(catalog.defaultPose, LIGHT_DEFINITIONS);
    for (const light of Object.values(state.lights)) { delete light.height; delete light.depth; }
    assert(validProject({ version: 1, state }, registry), 'legacy defaults rejected');
    state.jointPose = { format: 'studio-pose', version: 1, units: 'radians', rotation: 0.2, joints: { head: [0.1, 0, 0] }, placement: { grounded: false, height: 1.5 } };
    assert(validProject({ version: 1, state }, registry), 'floating pose rejected');
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