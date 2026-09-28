import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Character, CHARACTERS } from './character';
import { JOINTS, validPose } from './pose-schema';
import { createDefaultState, validProject } from './project-schema';
import { createRetouch } from './retouch';
import { loadPoseLibrary } from './pose-library';
import { createPoseBrowser } from './pose-browser';
import { createStudio, createStudioLight, LIGHT_DEFINITIONS as lightDefinitions } from './studio-scene';
import { createCaptureController } from './capture';
import { createPoseStore } from './pose-store';
import { createPoseSaveControls } from './pose-save';
import { createLibraryClient } from './library-client';
import { createLibrary } from './library';
import { createShotProject, loadBuiltInShots } from './shot-presets';
import { createShotBrowser } from './shot-browser';
import { createPropsController } from './props';

const builtInPoseLibrary = await loadPoseLibrary();
const builtInShotPresets = await loadBuiltInShots(builtInPoseLibrary);
const poseStore = createPoseStore(builtInPoseLibrary);
let poseLibrary = poseStore.catalog;
let poses = Object.fromEntries(poseLibrary.poses.map((pose) => [pose.id, pose.joints]));
const poseBrowser = createPoseBrowser(poseLibrary, (pose) => {
  rememberState();
  applyPose(pose.id);
  announce(`已切换为${pose.name}`);
  scheduleConfiguration();
});

const viewport = document.querySelector('#viewport');
const viewportFrame = document.querySelector('#viewport-frame');
const statusMessage = document.querySelector('#status-message');
const libraryClient = createLibraryClient();
const library = createLibrary({ client: libraryClient, announce,
  onUse: (asset, image) => retouch.useAsset(asset, image),
  onDelete: id => retouch.removeAsset(id),
});
const retouch = createRetouch(() => takePhoto({ archive: false }), { client: libraryClient, library });

const scene = new THREE.Scene();
scene.background = new THREE.Color('#eef2f4');

const camera = new THREE.PerspectiveCamera(32, 1.5, 0.1, 100);
camera.position.set(0.8, 2.1, 7.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;
viewport.append(renderer.domElement);
const environmentGenerator = new THREE.PMREMGenerator(renderer);
const environmentRoom = new RoomEnvironment();
const environmentTarget = environmentGenerator.fromScene(environmentRoom, 0.04);
scene.environment = environmentTarget.texture;
scene.environmentIntensity = 0.45;
environmentRoom.dispose();
environmentGenerator.dispose();

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.65, 0);
controls.enableDamping = true;
controls.minDistance = 0;
controls.maxDistance = Infinity;
controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI;

const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  samples: Math.min(4, renderer.capabilities.maxSamples),
});
const composer = new EffectComposer(renderer, renderTarget);
composer.addPass(new RenderPass(scene, camera));
const bokehPass = new BokehPass(scene, camera, {
  focus: 9,
  aperture: 0.000001,
  maxblur: 0.002,
  width: 1280,
  height: 720,
});
composer.addPass(bokehPass);
bokehPass.enabled = false;
composer.addPass(new OutputPass());

const studio = createStudio();
scene.add(studio.group);

const star = new Character(scene, camera, renderer.domElement, controls, onJointChange, rememberState, renderer.capabilities.getMaxAnisotropy());

const lights = Object.fromEntries(lightDefinitions.map((definition) => {
  const rig = createStudioLight(definition, window.innerWidth < 700 ? 1024 : 2048);
  scene.add(rig.group);
  return [definition.id, rig];
}));

scene.add(new THREE.HemisphereLight('#ffffff', '#c8d7e0', 0.45));

let currentPose = poseLibrary.defaultPose;
let poseSaveTarget = currentPose;
let currentAspect = 1.5;
let history = [];
let isRestoringState = false;
let backgroundData = null;
let backgroundLoadVersion = 0;
let previousFrameTime = 0;
let poseCustomized = false;
let modelLoading = false;
let persistenceReady = false;
let configurationTimer = null;
let configurationSaving = 0;
let configurationDirty = false;
let configurationVersion = 0;

const capture = createCaptureController({
  renderer, composer, camera, character: star, floorMarks: studio.floorMarks,
  getAspect: () => currentAspect,
  isLoading: () => modelLoading,
  setHelpersVisible: visible => props.setHelpersVisible(visible),
  onPhoto: async (image, name) => {
    retouch.setPhoto(image, name);
    announce('正在保存到拍摄相册…');
    await library.save('photo', image, name);
    announce('已存入拍摄相册');
  },
  onResize: () => { resizeViewport(); poseSaving.update(); },
  announce,
});
const { takePhoto, toggleRecording } = capture;
const poseSaving = createPoseSaveControls({
  getEntry: () => poseLibrary.poses.find((pose) => pose.id === poseSaveTarget),
  getFolders: () => [...new Set(poseLibrary.poses.map((pose) => pose.folder))],
  capturePose: () => star.capturePose(),
  isAvailable: () => !modelLoading && !!star.vrm && !capture.isRecording,
  save: (snapshot) => saveLibraryPose(snapshot),
  saveAs: (details, snapshot) => saveLibraryPose(snapshot, details),
  announce,
});
const props = createPropsController({
  scene, camera, canvas: renderer.domElement, orbit: controls, root: document.querySelector('#prop-controls'),
  canPick: () => !star.editing,
  onSelect: () => document.querySelector('#tab-props').click(),
  onBeforeChange: rememberState, onChange: scheduleConfiguration,
  onFrame: () => frameCharacter('scene'),
  isAvailable: () => !modelLoading && !isRestoringState && !capture.isRecording,
  announce,
});

createShotBrowser({
  root: document.querySelector('#panel-shots'), client: libraryClient,
  builtIns: builtInShotPresets,
  isAvailable: () => persistenceReady && !modelLoading && !isRestoringState && !capture.isRecording,
  apply: async preset => {
    rememberState();
    await restoreState(createShotProject(preset).state);
    announce(`已应用预设“${preset.name}”，可微调或撤销`);
  },
});

applyPose(currentPose, true);
buildLightControls();
buildJointControls();
bindInterface();
window.lucide?.createIcons();
updateRigVisibility();
resizeViewport();
renderer.setAnimationLoop(render);
await switchCharacter('mannequinFemale', false);
document.querySelector('#loading-state').classList.add('is-hidden');
if (poseStore.warning) announce(poseStore.warning);
try {
  const saved = await libraryClient.settings('scene');
  if (saved) {
    if (!validProject(saved, { poses, characters: CHARACTERS, lightDefinitions })) throw new Error('已存配置无效，未覆盖原始数据。');
    if (!await restoreState(saved.state)) throw new Error('配置中的人偶加载失败，未覆盖已存配置。');
  }
  persistenceReady = true;
  document.querySelector('#config-save').disabled = false;
  document.querySelector('#persistence-status').textContent = saved ? '已恢复本地配置' : '配置尚未保存';
} catch (error) {
  document.querySelector('#persistence-status').textContent = '配置读取失败';
  announce(error.message);
}
document.querySelector('#config-save').addEventListener('click', saveConfiguration);
document.querySelector('.workspace').addEventListener('input', scheduleConfiguration);
document.querySelector('.workspace').addEventListener('change', scheduleConfiguration);
document.querySelector('.workspace').addEventListener('click', scheduleConfiguration);
controls.addEventListener('end', scheduleConfiguration);
window.addEventListener('beforeunload', event => {
  if (configurationDirty || configurationSaving || retouch.hasPendingChanges || library.hasPending) {
    event.preventDefault();
    event.returnValue = '';
  }
});

function scheduleConfiguration() {
  if (!persistenceReady || isRestoringState) return;
  configurationDirty = true;
  configurationVersion++;
  document.querySelector('#persistence-status').textContent = '配置待保存';
  clearTimeout(configurationTimer);
  configurationTimer = setTimeout(saveConfiguration, 750);
}

async function saveConfiguration() {
  clearTimeout(configurationTimer);
  configurationTimer = null;
  if (!persistenceReady) return;
  if (modelLoading || isRestoringState) {
    configurationTimer = setTimeout(saveConfiguration, 500);
    return;
  }
  const version = configurationVersion;
  configurationSaving++;
  document.querySelector('#persistence-status').textContent = '正在保存配置';
  try {
    await libraryClient.saveSettings('scene', { version: 1, state: captureState() });
    if (version === configurationVersion) {
      configurationDirty = false;
      document.querySelector('#persistence-status').textContent = '配置已保存到本机';
    }
  } catch (error) {
    configurationDirty = true;
    document.querySelector('#persistence-status').textContent = '配置保存失败';
    announce(error.message);
  } finally { configurationSaving--; }
}

function applyPose(name) {
  currentPose = name;
  poseSaveTarget = name;
  const entry = poseLibrary.poses.find((pose) => pose.id === name);
  star.restorePose({
    format: 'studio-pose', version: 1, units: 'radians', joints: poses[name],
    rotation: entry.rotation ?? star.group.rotation.y,
    placement: entry.placement ?? { grounded: star.grounded, height: star.height },
  });
  const degrees = THREE.MathUtils.radToDeg(star.group.rotation.y);
  document.querySelector('#star-rotation').value = degrees;
  document.querySelector('#rotation-output').value = `${Number(degrees.toFixed(1))}°`;
  syncPlacementControls();
  poseCustomized = false;
  syncJointControls();
  poseBrowser.setSelection(name);
  poseSaving.update();
}

function saveLibraryPose(snapshot, details = null) {
  const saved = details ? poseStore.saveAs(details, snapshot) : poseStore.save(poseSaveTarget, snapshot);
  rememberState();
  poseLibrary = poseStore.catalog;
  poses = Object.fromEntries(poseLibrary.poses.map((pose) => [pose.id, pose.joints]));
  poseBrowser.updateCatalog(poseLibrary, details ? { reveal: saved.id } : {});
  currentPose = saved.id;
  poseSaveTarget = saved.id;
  poseCustomized = false;
  poseBrowser.setSelection(saved.id);
  poseSaving.update();
  window.lucide?.createIcons();
  announce(`${details ? '已另存' : '已保存'}“${saved.name}”到本机姿势库`);
  scheduleConfiguration();
}

function buildLightControls() {
  const container = document.querySelector('#light-controls');
  lightDefinitions.forEach((definition) => {
    const article = container.querySelector(`[data-light="${definition.id}"]`);
    article.dataset.light = definition.id;
    article.querySelector('.light-index').textContent = definition.index;
    article.querySelector('.light-name').textContent = definition.name;
    const intensity = article.querySelector('.light-intensity');
    intensity.value = definition.intensity;
    const output = article.querySelector('.light-output');
    output.value = definition.intensity.toFixed(1);
    const color = article.querySelector('.light-color');
    color.value = definition.color;
    const position = article.querySelector('.light-position');
    position.value = definition.position[0];
    article.querySelector('.light-height').value = definition.position[1];
    article.querySelector('.light-depth').value = definition.position[2];
    article.querySelectorAll('input').forEach((input) => {
      const label = input.closest('label').textContent.trim();
      input.setAttribute('aria-label', `${definition.name}${label}`);
    });
  });
}

function bindInterface() {
  window.addEventListener('studio:panel-change', event => {
    const panel = event.detail;
    if (!['shots', 'poses', 'props', 'stage'].includes(panel)) return;
    props.setEditing(panel === 'props');
    if (panel !== 'poses') {
      star.setEditing(false);
      document.querySelector('#edit-joints').checked = false;
    }
  });
  document.querySelector('#framing-controls').addEventListener('click', (event) => {
    const button = event.target.closest('[data-framing]');
    if (button && !modelLoading) frameCharacter(button.dataset.framing);
  });
  document.querySelector('#character-controls').addEventListener('click', (event) => {
    const button = event.target.closest('[data-character]');
    if (button && !modelLoading && !capture.isRecording) switchCharacter(button.dataset.character);
  });
  document.querySelector('#joint-select').addEventListener('change', (event) => { star.select(event.target.value); syncJointControls(); });
  document.querySelector('#edit-joints').addEventListener('change', (event) => star.setEditing(event.target.checked));
  document.querySelector('#auto-ground').addEventListener('change', (event) => {
    rememberState();
    star.setGrounded(event.target.checked);
    syncPlacementControls();
    onJointChange(star.selected);
  });
  for (const selector of ['#character-height', '#character-height-value']) {
    const input = document.querySelector(selector);
    input.addEventListener('pointerdown', rememberState);
    input.addEventListener('focus', rememberState);
    input.addEventListener('input', () => {
      if (input.value === '' || !Number.isFinite(Number(input.value))) return;
      star.setHeight(Number(input.value));
      syncPlacementControls();
      onJointChange(star.selected);
    });
  }
  document.querySelector('#pose-mode').addEventListener('change', (event) => {
    star.setEditMode(event.target.value);
    document.querySelector('#edit-joints').checked = true;
    star.setEditing(true);
    syncJointControls();
    announce(event.target.value === 'ik' ? '手脚 IK 拖拽已开启' : '关节旋转已开启');
  });
  document.querySelector('#joint-reset').addEventListener('click', () => {
    rememberState();
    star.setJoint(star.selected, poses[currentPose][star.selected] ?? [0, 0, 0]);
    onJointChange(star.selected);
  });
  document.querySelector('#pose-export').addEventListener('click', () => downloadJson(star.capturePose(), 'studio-pose.json'));
  document.querySelector('#pose-import').addEventListener('click', () => document.querySelector('#pose-input').click());
  document.querySelector('#pose-input').addEventListener('change', importPose);
  document.querySelector('#backdrop-controls').addEventListener('click', (event) => {
    const button = event.target.closest('[data-color]');
    if (!button || button.classList.contains('is-active')) return;
    rememberState();
    setActiveButton(button);
    studio.material.color.set(button.dataset.color);
    setBackground(null);
    announce('背景颜色已更新');
  });

  document.querySelector('#aspect-controls').addEventListener('click', (event) => {
    const button = event.target.closest('[data-aspect]');
    if (!button || button.classList.contains('is-active')) return;
    rememberState();
    setActiveButton(button);
    currentAspect = Number(button.dataset.aspect);
    document.documentElement.style.setProperty('--frame-aspect', currentAspect);
    requestAnimationFrame(resizeViewport);
    announce(`画幅已切换为 ${button.textContent}`);
  });

  bindRange('#star-rotation', '#rotation-output', (value, output) => {
    star.group.rotation.y = THREE.MathUtils.degToRad(value);
    output.value = `${value}°`;
    if (!isRestoringState && star.vrm) onJointChange(star.selected);
  });
  bindRange('#focal-length', '#focal-output', (value, output) => {
    camera.setFocalLength(value);
    output.value = `${Math.round(value)} mm`;
    document.querySelector('#lens-readout').textContent = `${Math.round(value)} MM`;
  });
  bindRange('#exposure', '#exposure-output', (value, output) => {
    renderer.toneMappingExposure = value;
    const ev = Math.log2(value);
    output.value = `${ev >= 0 ? '+' : ''}${ev.toFixed(1)} EV`;
  });
  bindRange('#depth-of-field', '#dof-output', (value, output) => {
    const strength = value / 100;
    bokehPass.enabled = value > 0;
    bokehPass.uniforms.aperture.value = strength * 0.00008 + 0.000001;
    bokehPass.uniforms.maxblur.value = strength * 0.012 + 0.001;
    output.value = value === 0 ? '关闭' : `${value}%`;
    document.querySelector('#aperture-readout').textContent = value === 0 ? 'f/5.6' : `f/${(5.6 - strength * 4.2).toFixed(1)}`;
  });

  document.querySelector('#light-controls').addEventListener('pointerdown', (event) => {
    if (event.target.matches('input')) rememberState();
  });
  document.querySelector('#light-controls').addEventListener('input', updateLightFromControl);
  document.querySelector('#light-controls').addEventListener('change', updateLightFromControl);
  document.querySelectorAll('input').forEach((input) => input.addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Home', 'End'].includes(event.key)) rememberState();
  }));
  document.querySelector('#auto-orbit').addEventListener('change', (event) => {
    controls.autoRotate = event.target.checked;
    controls.autoRotateSpeed = 0.6;
  });
  document.querySelector('#show-rigs').addEventListener('change', updateRigVisibility);
  document.querySelector('#remove-shadows').addEventListener('change', () => {
    rememberState();
    updateShadows();
  });
  ['#auto-orbit', '#show-rigs'].forEach((selector) => document.querySelector(selector).addEventListener('pointerdown', rememberState));
  document.querySelector('#save-button').addEventListener('click', saveProject);
  document.querySelector('#load-button').addEventListener('click', () => document.querySelector('#project-input').click());
  document.querySelector('#project-input').addEventListener('change', loadProject);
  document.querySelector('#background-import').addEventListener('click', () => document.querySelector('#background-input').click());
  document.querySelector('#background-input').addEventListener('change', importBackground);
  document.querySelector('#background-clear').addEventListener('click', () => { rememberState(); setBackground(null); });
  document.querySelector('#photo-button').addEventListener('click', () => {
    try { takePhoto(); } catch (error) {
      console.error(error);
      announce('图片导出失败，请降低分辨率或更换浏览器');
    }
  });
  document.querySelector('#record-button').addEventListener('click', toggleRecording);
  document.querySelector('#reset-button').addEventListener('click', resetStudio);
  document.querySelector('#undo-button').addEventListener('click', undo);
  window.addEventListener('resize', resizeViewport);
  new ResizeObserver(resizeViewport).observe(viewportFrame);
  controls.addEventListener('start', rememberState);
}

function frameCharacter(mode, shot = null) {
  const bounds = star.getFramingBounds(mode);
  if (!bounds) return;
  if (mode === 'scene') bounds.union(props.getBounds());
  if (!shot) rememberState();
  controls.autoRotate = false;
  document.querySelector('#auto-orbit').checked = false;
  controls.enableDamping = false;
  controls.update();
  const center = bounds.getCenter(new THREE.Vector3());
  const direction = shot ? new THREE.Vector3(...shot.direction).normalize() : camera.position.clone().sub(controls.target).normalize();
  if (mode === 'low') {
    direction.y = -0.16;
    direction.normalize();
  }
  const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right);
  const verticalSlope = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const horizontalSlope = verticalSlope * camera.aspect;
  let distance = controls.minDistance;
  for (const horizontal of [bounds.min.x, bounds.max.x]) {
    for (const vertical of [bounds.min.y, bounds.max.y]) {
      for (const depth of [bounds.min.z, bounds.max.z]) {
        const offset = new THREE.Vector3(horizontal, vertical, depth).sub(center);
        const clearance = Math.max(Math.abs(offset.dot(right)) / (horizontalSlope * (1 - Math.abs(shot?.offset ?? 0))), Math.abs(offset.dot(up)) / verticalSlope);
        distance = Math.max(distance, offset.dot(direction) + clearance * 1.12);
      }
    }
  }
  center.addScaledVector(right, (shot?.offset ?? 0) * distance * horizontalSlope);
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, distance);
  controls.update();
  controls.enableDamping = true;
  announce(`已切换为${{ full: '全身取景', half: '半身取景', face: '面部特写', low: '低机位仰拍', scene: '人物与全部道具取景' }[mode]}`);
}

function bindRange(inputSelector, outputSelector, update) {
  const input = document.querySelector(inputSelector);
  const output = document.querySelector(outputSelector);
  input.addEventListener('pointerdown', rememberState);
  input.addEventListener('input', () => update(Number(input.value), output));
  update(Number(input.value), output);
}

function updateLightFromControl(event) {
  const article = event.target.closest('.light-control');
  if (!article) return;
  const rig = lights[article.dataset.light];
  const enabled = article.querySelector('.light-enabled').checked;
  const intensity = Number(article.querySelector('.light-intensity').value);
  const color = article.querySelector('.light-color').value;
  const x = Number(article.querySelector('.light-position').value);
  const height = Number(article.querySelector('.light-height').value);
  const depth = Number(article.querySelector('.light-depth').value);
  rig.enabled = enabled;
  rig.light.intensity = enabled ? intensity * 8 : 0;
  rig.light.color.set(color);
  rig.glowMaterial.color.set(enabled ? color : '#222222');
  article.querySelector('.light-output').value = intensity.toFixed(1);
  rig.light.position.set(x, height, depth);
  rig.stand.position.set(x, height / 2, depth);
  rig.stand.scale.y = height / 3.1;
  rig.fixture.position.copy(rig.light.position);
  rig.panel.position.copy(rig.light.position);
  rig.fixture.lookAt(rig.light.target.position);
  rig.panel.lookAt(rig.light.target.position);
  rig.panel.translateZ(0.071);
}

function setActiveButton(button) {
  button.parentElement.querySelectorAll('.is-active').forEach((active) => active.classList.remove('is-active'));
  button.classList.add('is-active');
}

function resizeViewport() {
  if (capture.isRecording) return;
  const width = Math.max(1, viewport.clientWidth);
  const height = Math.max(1, viewport.clientHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  composer.setSize(width, height);
  bokehPass.uniforms.aspect.value = camera.aspect;
  document.querySelector('#resolution-readout').textContent = `${Math.round(width * renderer.getPixelRatio())} × ${Math.round(height * renderer.getPixelRatio())}`;
}

function render(time) {
  const delta = previousFrameTime ? Math.min((time - previousFrameTime) / 1000, 0.1) : 1 / 60;
  previousFrameTime = time;
  if (controls.enabled) controls.update(delta);
  const requiredFar = Math.max(100, camera.position.length() + controls.target.length() + 100);
  if (camera.far < requiredFar || camera.far > requiredFar * 4) {
    camera.far = requiredFar * 2;
    camera.updateProjectionMatrix();
  }
  star.update(delta);
  bokehPass.uniforms.focus.value = camera.position.distanceTo(controls.target);
  composer.render();
}

function captureState() {
  return {
    props: props.capture(),
    pose: currentPose,
    poseSaveTarget,
    backdrop: `#${studio.material.color.getHexString()}`,
    aspect: document.documentElement.style.getPropertyValue('--frame-aspect') || '1.5',
    cameraPosition: camera.position.toArray(),
    target: controls.target.toArray(),
    focal: document.querySelector('#focal-length').value,
    exposure: document.querySelector('#exposure').value,
    dof: document.querySelector('#depth-of-field').value,
    rotation: document.querySelector('#star-rotation').value,
    character: star.id,
    jointPose: star.capturePose(),
    poseCustomized,
    background: backgroundData,
    autoOrbit: document.querySelector('#auto-orbit').checked,
    showRigs: document.querySelector('#show-rigs').checked,
    removeShadows: !renderer.shadowMap.enabled,
    lights: Object.fromEntries([...document.querySelectorAll('.light-control')].map((article) => [article.dataset.light, {
      enabled: article.querySelector('.light-enabled').checked,
      intensity: article.querySelector('.light-intensity').value,
      color: article.querySelector('.light-color').value,
      position: article.querySelector('.light-position').value,
      height: article.querySelector('.light-height').value,
      depth: article.querySelector('.light-depth').value,
    }])),
  };
}

function rememberState() {
  if (isRestoringState) return;
  scheduleConfiguration();
  const state = JSON.stringify(captureState());
  if (history.at(-1) !== state) history.push(state);
  if (history.length > 30) history.shift();
}

async function undo() {
  const state = history.pop();
  if (!state) {
    announce('没有可撤销的操作');
    return;
  }
  if (await restoreState(JSON.parse(state))) announce('已撤销上一步');
}

async function restoreState(state) {
  if (state.character && state.character !== star.id && !await switchCharacter(state.character, false)) return false;
  isRestoringState = true;
  props.restore(state.props ?? []);
  const knownPose = Object.hasOwn(poses, state.pose);
  applyPose(knownPose ? state.pose : poseLibrary.defaultPose);
  studio.material.color.set(state.backdrop);
  document.querySelectorAll('[data-color]').forEach((button) => button.classList.toggle('is-active', button.dataset.color.toLowerCase() === state.backdrop.toLowerCase()));
  document.documentElement.style.setProperty('--frame-aspect', state.aspect);
  currentAspect = Number(state.aspect);
  document.querySelectorAll('[data-aspect]').forEach((button) => button.classList.toggle('is-active', button.dataset.aspect === state.aspect));
  camera.position.fromArray(state.cameraPosition);
  controls.target.fromArray(state.target);
  setRangeValue('#focal-length', state.focal);
  setRangeValue('#exposure', state.exposure);
  setRangeValue('#depth-of-field', state.dof);
  setRangeValue('#star-rotation', state.rotation ?? 0);
  if (state.jointPose) {
    setRangeValue('#star-rotation', THREE.MathUtils.radToDeg(state.jointPose.rotation));
    star.restorePose(state.jointPose);
    document.querySelector('#rotation-output').value = `${THREE.MathUtils.radToDeg(state.jointPose.rotation).toFixed(1)}°`;
  } else {
    star.setGrounded(true);
    for (const side of ['left', 'right']) {
      const angles = [...star.poseAngles[`${side}UpperArm`]];
      angles[2] += THREE.MathUtils.degToRad(Number(state[`${side}Arm`] ?? 0));
      star.setJoint(`${side}UpperArm`, angles);
    }
  }
  poseSaveTarget = !knownPose || state.poseSaveTarget === null ? null : state.pose;
  poseSaving.update();
  if (state.poseCustomized || !knownPose) onJointChange(star.selected);
  else syncJointControls();
  syncPlacementControls();
  document.querySelector('#auto-orbit').checked = state.autoOrbit ?? false;
  controls.autoRotate = state.autoOrbit ?? false;
  controls.autoRotateSpeed = 0.6;
  document.querySelector('#show-rigs').checked = state.showRigs ?? false;
  updateRigVisibility();
  document.querySelector('#remove-shadows').checked = state.removeShadows ?? true;
  updateShadows();
  setBackground(state.background ?? null);
  Object.entries(state.lights).forEach(([id, lightState]) => {
    const article = document.querySelector(`[data-light="${id}"]`);
    article.querySelector('.light-enabled').checked = lightState.enabled;
    article.querySelector('.light-intensity').value = lightState.intensity;
    article.querySelector('.light-color').value = lightState.color;
    article.querySelector('.light-position').value = lightState.position;
    const definition = lightDefinitions.find((light) => light.id === id);
    article.querySelector('.light-height').value = lightState.height ?? definition.position[1];
    article.querySelector('.light-depth').value = lightState.depth ?? definition.position[2];
    article.querySelector('.light-intensity').dispatchEvent(new Event('input', { bubbles: true }));
  });
  requestAnimationFrame(resizeViewport);
  isRestoringState = false;
  scheduleConfiguration();
  return true;
}

function setRangeValue(selector, value) {
  const input = document.querySelector(selector);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function resetStudio() {
  rememberState();
  await restoreState(createDefaultState(poseLibrary.defaultPose, lightDefinitions));
  announce('摄影棚已重置');
}

function announce(message) {
  statusMessage.textContent = message;
}

function updateShadows() {
  renderer.shadowMap.enabled = !document.querySelector('#remove-shadows').checked;
  renderer.shadowMap.needsUpdate = true;
  scene.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => { material.needsUpdate = true; });
  });
}

function updateRigVisibility() {
  const visible = document.querySelector('#show-rigs').checked;
  Object.values(lights).forEach((rig) => {
    rig.stand.visible = visible;
    rig.fixture.visible = visible;
    rig.panel.visible = visible;
  });
}

async function setBackground(data) {
  const version = ++backgroundLoadVersion;
  backgroundData = data;
  studio.photoBackdrop.visible = false;
  studio.photoBackdrop.material.map?.dispose();
  studio.photoBackdrop.material.map = null;
  studio.photoBackdrop.material.needsUpdate = true;
  if (!data) return;
  try {
    const texture = await new THREE.TextureLoader().loadAsync(data);
    if (version !== backgroundLoadVersion) { texture.dispose(); return; }
    texture.colorSpace = THREE.SRGBColorSpace;
    const aspect = texture.image.width / texture.image.height;
    studio.photoBackdrop.scale.x = Math.min(1, aspect / (16 / 9));
    studio.photoBackdrop.scale.y = Math.min(1, (16 / 9) / aspect);
    studio.photoBackdrop.material.map = texture;
    studio.photoBackdrop.material.needsUpdate = true;
    studio.photoBackdrop.visible = true;
  } catch (error) {
    if (version === backgroundLoadVersion) backgroundData = null;
    console.error(error);
    announce('背景图片无法解码，请选择 PNG、JPEG 或 WebP');
  }
}

async function importBackground(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
    announce('请选择 8 MB 以内的 PNG、JPEG 或 WebP');
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', async () => {
    rememberState();
    await setBackground(reader.result);
    if (backgroundData) announce('背景图片已导入');
  });
  reader.addEventListener('error', () => announce('读取背景图片失败'));
  reader.readAsDataURL(file);
}

function saveProject() {
  downloadJson({ version: 1, state: captureState() }, `studio-${Date.now()}.json`);
  announce('项目配置已导出，包含背景图片与摄影参数');
}

async function loadProject(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 13 * 1024 * 1024) throw new Error('Project too large');
    const project = JSON.parse(await file.text());
    if (!validProject(project, { poses, characters: CHARACTERS, lightDefinitions })) throw new Error('Invalid studio project');
    rememberState();
    if (await restoreState(project.state)) announce('项目已恢复');
  } catch (error) {
    console.error(error);
    announce('项目文件格式无效，当前场景未更改');
  }
}

function buildJointControls() {
  const select = document.querySelector('#joint-select');
  for (const [id, , label] of JOINTS) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = label;
    select.append(option);
  }
  select.value = star.selected;
  ['x', 'y', 'z'].forEach((axis, index) => {
    for (const suffix of ['', '-value']) {
      const input = document.querySelector(`#joint-${axis}${suffix}`);
      input.addEventListener('pointerdown', rememberState);
      input.addEventListener('focus', rememberState);
      input.addEventListener('input', () => {
        if (input.value === '' || !Number.isFinite(Number(input.value))) return;
        const angles = [...star.poseAngles[star.selected]];
        angles[index] = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(input.value), -180, 180));
        star.setJoint(star.selected, angles);
        onJointChange(star.selected);
      });
    }
  });
}

function syncPlacementControls() {
  document.querySelector('#auto-ground').checked = star.grounded;
  for (const selector of ['#character-height', '#character-height-value']) {
    const input = document.querySelector(selector);
    input.value = Number(star.height.toFixed(3));
    input.disabled = star.grounded;
  }
}

function syncJointControls() {
  const select = document.querySelector('#joint-select');
  if (!select) return;
  for (const option of select.options) {
    option.disabled = !star.isJointSelectable(option.value);
    option.hidden = false;
  }
  document.querySelector('#joint-reset').disabled = !star.joints[star.selected];
  select.value = star.selected;
  const angles = star.poseAngles[star.selected] ?? [0, 0, 0];
  ['x', 'y', 'z'].forEach((axis, index) => {
    const value = Number(THREE.MathUtils.radToDeg(angles[index]).toFixed(1));
    document.querySelector(`#joint-${axis}`).value = value;
    document.querySelector(`#joint-${axis}-value`).value = value;
    document.querySelector(`#joint-${axis}`).disabled = !star.joints[star.selected];
    document.querySelector(`#joint-${axis}-value`).disabled = !star.joints[star.selected];
  });
}

function onJointChange(id, edited = true) {
  if (edited) {
    poseCustomized = true;
    poseBrowser.setSelection(null);
    const entry = poseLibrary.poses.find((pose) => pose.id === poseSaveTarget);
    if (entry) poseBrowser.setCaption(`${entry.name} · 未保存`);
  }
  syncJointControls();
}

async function switchCharacter(id, recordHistory = true) {
  if (modelLoading || !Object.hasOwn(CHARACTERS, id)) return false;
  if (!['mannequin', 'mannequinFemale', 'quaternius'].includes(id)) id = 'mannequinFemale';
  if (star.vrm && star.id === id) return true;
  if (recordHistory) rememberState();
  modelLoading = true;
  document.querySelector('#character-controls').setAttribute('aria-busy', 'true');
  document.querySelector('#model-credit').textContent = '正在加载人偶…';
  const actions = ['#save-button', '#load-button', '#undo-button', '#reset-button', '#photo-button', '#record-button', '#pose-save', '#pose-save-as', '#shot-apply'];
  actions.forEach((selector) => { document.querySelector(selector).disabled = true; });
  try {
    await star.load(id);
    for (const option of document.querySelector('#joint-select').options) option.disabled = !star.joints[option.value];
    document.querySelectorAll('[data-character]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.character === id);
      button.setAttribute('aria-pressed', String(button.dataset.character === id));
    });
    document.querySelector('#model-credit').textContent = CHARACTERS[id].credit;
    syncJointControls();
    announce(`${CHARACTERS[id].name} · ${Object.keys(star.joints).length} 个可编辑关节`);
    return true;
  } catch (error) {
    document.querySelector('#model-credit').textContent = star.vrm ? CHARACTERS[star.id].credit : '人偶加载失败';
    announce(`人偶加载失败：${error.message}`);
    return false;
  } finally {
    modelLoading = false;
    document.querySelector('#character-controls').setAttribute('aria-busy', 'false');
    actions.forEach((selector) => { document.querySelector(selector).disabled = false; });
    poseSaving.update();
  }
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importPose(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 128 * 1024) throw new Error('姿势文件超过 128 KB');
    const pose = JSON.parse(await file.text());
    if (!validPose(pose)) throw new Error('请选择有效的 studio-pose JSON 文件');
    rememberState();
    star.restorePose(pose);
    setRangeValue('#star-rotation', THREE.MathUtils.radToDeg(pose.rotation));
    syncPlacementControls();
    poseSaveTarget = null;
    poseSaving.update();
    onJointChange(star.selected);
    announce('姿势已导入');
  } catch (error) {
    announce(`未导入：${error.message}，当前姿势已保留`);
  }
}