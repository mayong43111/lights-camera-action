import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Character, CHARACTERS, JOINTS, validPose } from './character.js';

const viewport = document.querySelector('#viewport');
const viewportFrame = document.querySelector('#viewport-frame');
const statusMessage = document.querySelector('#status-message');

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

const lightDefinitions = [
  { id: 'key', name: '主光', index: 'A', intensity: 7, color: '#fff0d6', position: [-4.2, 4.5, 4.2] },
  { id: 'fill', name: '辅光', index: 'B', intensity: 3.2, color: '#d8e9ff', position: [4.5, 3.5, 3.3] },
  { id: 'rim', name: '轮廓光', index: 'C', intensity: 5.5, color: '#ffffff', position: [0.5, 4.8, -3.4] },
];

const lights = Object.fromEntries(lightDefinitions.map((definition) => {
  const rig = createStudioLight(definition);
  scene.add(rig.group);
  return [definition.id, rig];
}));

scene.add(new THREE.HemisphereLight('#ffffff', '#c8d7e0', 0.45));

const poses = {
  warrior: {
    root: [0, -0.2, 0], head: [0, 0.85, 0],
    leftUpperArm: [0, 0, 0.04], leftLowerArm: [0, -0.08, 0],
    rightUpperArm: [0, 0, -0.04], rightLowerArm: [0, 0.08, 0],
    leftUpperLeg: [-Math.PI / 2, Math.PI / 2 - 0.95, Math.PI / 2], leftLowerLeg: [0.95, 0, 0],
    rightUpperLeg: [-Math.PI / 2, -Math.PI / 2 + 0.66, -Math.PI / 2], rightFoot: [0.66, 0, 0],
  },
  triangle: {
    torso: [0, 0, -0.95], chest: [0, 0, -0.12], head: [0, -0.3, 0.35],
    leftUpperArm: [0, 0, -0.5], rightUpperArm: [0, 0, -0.5],
    leftUpperLeg: [0, 0, 0.52], leftFoot: [0, 0, -0.52],
    rightUpperLeg: [0, 0, -0.52], rightFoot: [0, 0, 0.52],
  },
  arabesque: {
    root: [0.35, -0.6, 0], torso: [0.28, 0, 0], head: [-0.35, 0.2, 0],
    leftUpperArm: [0, -1.05, 0.3], leftLowerArm: [0, -0.12, 0],
    rightUpperArm: [0, 0.25, -0.15], rightLowerArm: [0, 0.12, 0],
    leftUpperLeg: [-0.35, 0, 0], leftFoot: [0.05, 0, 0],
    rightUpperLeg: [1.2, 0, 0], rightLowerLeg: [0.04, 0, 0], rightFoot: [0.65, 0, 0],
  },
  grandJete: {
    root: [0, -0.65, 0], torso: [-0.1, 0, 0], head: [0.1, 0.3, 0],
    leftUpperArm: [0, -0.15, 0.65], leftLowerArm: [0, -0.12, 0],
    rightUpperArm: [0, 0.15, -0.65], rightLowerArm: [0, 0.12, 0],
    leftUpperLeg: [-1.45, 0, 0], leftLowerLeg: [0.06, 0, 0], leftFoot: [0.55, 0, 0],
    rightUpperLeg: [1.4, 0, 0], rightLowerLeg: [0.06, 0, 0], rightFoot: [0.55, 0, 0],
  },
  editorial: {
    root: [0, -0.12, 0], head: [0.04, 0.15, 0.05],
    leftUpperArm: [0.08, 0, -1.2], leftLowerArm: [0, -0.2, 0],
    rightUpperArm: [-0.05, 0, 1.35], rightLowerArm: [0, 0.35, 0],
    leftUpperLeg: [0.02, 0, -0.05], rightUpperLeg: [-0.08, 0, 0.12], rightLowerLeg: [0.18, 0, 0],
  },
  power: {
    root: [0, 0.06, 0], head: [-0.04, -0.05, 0],
    leftUpperArm: [0, 0, -0.85], leftLowerArm: [0, -1.25, -0.1],
    rightUpperArm: [0, 0, 0.85], rightLowerArm: [0, 1.25, 0.1],
    leftUpperLeg: [0, 0, -0.18], rightUpperLeg: [0, 0, 0.18],
  },
  wave: {
    root: [0, -0.18, 0], head: [0, 0.18, -0.08],
    leftUpperArm: [0, 0, -1.3], leftLowerArm: [0, -0.15, 0],
    rightUpperArm: [0, 0, -0.45], rightLowerArm: [0, 0, -1.2],
    leftUpperLeg: [0, 0, -0.08], rightUpperLeg: [0, 0, 0.12],
  },
  runway: {
    root: [0, -0.42, 0], head: [0.02, 0.42, -0.04],
    leftUpperArm: [-0.18, 0.12, -1.3], leftLowerArm: [0, -0.2, 0],
    rightUpperArm: [0.2, -0.1, 1.3], rightLowerArm: [0, 0.28, 0],
    leftUpperLeg: [-0.12, 0, -0.08], rightUpperLeg: [-0.35, 0, 0.12], rightLowerLeg: [0.48, 0, 0],
  },
  dance: {
    root: [0, 0.18, -0.06], head: [0, -0.2, 0.12],
    leftUpperArm: [0.2, 0, 0.25], leftLowerArm: [0, -0.7, 0.2],
    rightUpperArm: [-0.2, 0, -0.3], rightLowerArm: [0, 0.5, -0.7],
    leftUpperLeg: [-0.08, 0, -0.18], rightUpperLeg: [-0.5, 0, 0.22], rightLowerLeg: [0.75, 0, 0],
  },
  profile: {
    root: [0, -1.1, 0], head: [0.02, 0.65, 0.06],
    leftUpperArm: [-0.12, 0, -1.2], leftLowerArm: [0, -0.65, 0],
    rightUpperArm: [0.16, 0, 1.25], rightLowerArm: [0, 0.8, 0],
    leftUpperLeg: [0, 0, -0.08], rightUpperLeg: [-0.12, 0, 0.1],
  },
};

let currentPose = 'warrior';
let currentAspect = 1.5;
let takeNumber = 1;
let recorder = null;
let recordingStartedAt = 0;
let recordingTimer = null;
let history = [];
let isRestoringState = false;
let backgroundData = null;
let backgroundLoadVersion = 0;
let previousFrameTime = 0;
let poseCustomized = false;
let editingBeforeRecording = false;
let modelLoading = false;

applyPose(currentPose, true);
buildLightControls();
buildJointControls();
bindInterface();
updateRigVisibility();
resizeViewport();
renderer.setAnimationLoop(render);
await switchCharacter('pixiv', false);
document.querySelector('#loading-state').classList.add('is-hidden');

function createStudio() {
  const group = new THREE.Group();
  const backdropMaterial = new THREE.MeshStandardMaterial({ color: '#edf4f6', roughness: 0.92, metalness: 0 });
  const profile = [{ height: 0, depth: 8, normalY: 1, normalZ: 0 }];
  for (let segment = 0; segment <= 64; segment++) {
    const angle = segment / 64 * Math.PI / 2;
    profile.push({ height: 1.2 * (1 - Math.cos(angle)), depth: -3.75 - 1.2 * Math.sin(angle), normalY: Math.cos(angle), normalZ: Math.sin(angle) });
  }
  profile.push({ height: 7, depth: -4.95, normalY: 0, normalZ: 1 });
  const positions = [];
  const normals = [];
  const indices = [];
  profile.forEach((point, row) => {
    positions.push(-7, point.height, point.depth, 7, point.height, point.depth);
    normals.push(0, point.normalY, point.normalZ, 0, point.normalY, point.normalZ);
    if (row < profile.length - 1) {
      const start = row * 2;
      indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
    }
  });
  const sweepGeometry = new THREE.BufferGeometry();
  sweepGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  sweepGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  sweepGeometry.setIndex(indices);
  const sweep = new THREE.Mesh(sweepGeometry, backdropMaterial);
  sweep.name = 'Cyclorama';
  sweep.receiveShadow = true;
  group.add(sweep);

  const markMaterial = new THREE.MeshBasicMaterial({ color: '#e65343', side: THREE.DoubleSide });
  for (let index = 0; index < 4; index += 1) {
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(index % 2 ? 0.05 : 0.65, index % 2 ? 0.65 : 0.05), markMaterial);
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(0, 0.006, 0);
    group.add(mark);
  }

  const photoBackdrop = new THREE.Mesh(new THREE.PlaneGeometry(12, 6.75), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  photoBackdrop.position.set(0, 3.375, -4.85);
  photoBackdrop.visible = false;
  group.add(photoBackdrop);
  return { group, material: backdropMaterial, photoBackdrop };
}

function createStar() {
  const group = new THREE.Group();
  group.position.y = 0.29;
  const joints = {};
  const skin = new THREE.MeshStandardMaterial({ color: '#b97857', roughness: 0.68 });
  const suit = new THREE.MeshPhysicalMaterial({ color: '#20272b', roughness: 0.35, metalness: 0.08, clearcoat: 0.25 });
  const accent = new THREE.MeshStandardMaterial({ color: '#d33f32', roughness: 0.48 });
  const dark = new THREE.MeshStandardMaterial({ color: '#101111', roughness: 0.55 });
  const hair = new THREE.MeshStandardMaterial({ color: '#291e1a', roughness: 0.88 });

  const hips = joint('root', group, [0, 1.23, 0]);
  addMesh(hips, new THREE.CapsuleGeometry(0.28, 0.28, 6, 12), suit, [0, 0.16, 0], [1.05, 1, 0.8]);
  const torso = joint('torso', hips, [0, 0.38, 0]);
  addMesh(torso, new THREE.CapsuleGeometry(0.34, 0.62, 8, 16), suit, [0, 0.38, 0], [1.15, 1, 0.72]);
  addMesh(torso, new THREE.BoxGeometry(0.08, 0.62, 0.03), accent, [0, 0.45, 0.25], [1, 1, 1]);

  const neck = joint('neck', torso, [0, 0.84, 0]);
  addMesh(neck, new THREE.CylinderGeometry(0.105, 0.12, 0.22, 12), skin, [0, 0.08, 0]);
  const head = joint('head', neck, [0, 0.23, 0]);
  addMesh(head, new THREE.SphereGeometry(0.25, 24, 18), skin, [0, 0.18, 0], [0.88, 1.08, 0.9]);
  const hairCap = addMesh(head, new THREE.SphereGeometry(0.255, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), hair, [0, 0.23, -0.01], [0.92, 1, 0.94]);
  hairCap.rotation.x = -0.12;
  addMesh(head, new THREE.SphereGeometry(0.018, 10, 8), dark, [-0.09, 0.2, 0.22]);
  addMesh(head, new THREE.SphereGeometry(0.018, 10, 8), dark, [0.09, 0.2, 0.22]);
  addMesh(head, new THREE.BoxGeometry(0.09, 0.015, 0.018), accent, [0, 0.08, 0.23]);

  createArm('left', torso, -1, skin, suit, joints);
  createArm('right', torso, 1, skin, suit, joints);
  createLeg('left', hips, -1, skin, suit, dark, joints);
  createLeg('right', hips, 1, skin, suit, dark, joints);

  group.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  function joint(name, parent, position) {
    const node = new THREE.Group();
    node.position.set(...position);
    node.userData.basePosition = node.position.clone();
    parent.add(node);
    joints[name] = node;
    return node;
  }

  function createArm(side, parent, direction, skinMaterial, clothingMaterial, jointMap) {
    const upper = joint(`${side}UpperArm`, parent, [0.43 * direction, 0.72, 0]);
    addMesh(upper, new THREE.CapsuleGeometry(0.105, 0.38, 6, 10), clothingMaterial, [0, -0.26, 0]);
    const lower = joint(`${side}LowerArm`, upper, [0, -0.57, 0]);
    addMesh(lower, new THREE.CapsuleGeometry(0.085, 0.34, 6, 10), skinMaterial, [0, -0.24, 0]);
    addMesh(lower, new THREE.SphereGeometry(0.105, 12, 10), skinMaterial, [0, -0.51, 0], [0.8, 1.2, 0.55]);
    jointMap[`${side}UpperArm`] = upper;
    jointMap[`${side}LowerArm`] = lower;
  }

  function createLeg(side, parent, direction, skinMaterial, clothingMaterial, shoeMaterial, jointMap) {
    const upper = joint(`${side}UpperLeg`, parent, [0.2 * direction, 0.02, 0]);
    addMesh(upper, new THREE.CapsuleGeometry(0.145, 0.52, 6, 12), clothingMaterial, [0, -0.33, 0]);
    const lower = joint(`${side}LowerLeg`, upper, [0, -0.72, 0]);
    addMesh(lower, new THREE.CapsuleGeometry(0.115, 0.5, 6, 12), clothingMaterial, [0, -0.31, 0], [0.9, 1, 0.9]);
    addMesh(lower, new THREE.CapsuleGeometry(0.13, 0.22, 5, 10), shoeMaterial, [0, -0.66, 0.09], [1, 0.72, 1.65]);
    jointMap[`${side}UpperLeg`] = upper;
    jointMap[`${side}LowerLeg`] = lower;
  }

  return { group, joints };
}

function addMesh(parent, geometry, material, position = [0, 0, 0], scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

function createStudioLight(definition) {
  const group = new THREE.Group();
  const light = new THREE.SpotLight(definition.color, definition.intensity * 8, 18, 0.62, 0.72, 1.25);
  light.position.set(...definition.position);
  light.castShadow = true;
  light.shadow.mapSize.set(window.innerWidth < 700 ? 1024 : 2048, window.innerWidth < 700 ? 1024 : 2048);
  light.shadow.bias = -0.00025;
  light.shadow.normalBias = 0.015;
  light.shadow.camera.near = 0.3;
  light.shadow.camera.far = 18;
  light.target.position.set(0, 1.6, 0);
  group.add(light, light.target);

  const standMaterial = new THREE.MeshStandardMaterial({ color: '#272727', metalness: 0.75, roughness: 0.3 });
  const glowMaterial = new THREE.MeshBasicMaterial({ color: definition.color });
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 3.1, 8), standMaterial);
  stand.position.set(definition.position[0], 1.55, definition.position[2]);
  group.add(stand);
  const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.58, 0.13), standMaterial);
  fixture.position.copy(light.position);
  fixture.lookAt(light.target.position);
  group.add(fixture);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.42), glowMaterial);
  panel.position.copy(light.position);
  panel.lookAt(light.target.position);
  panel.translateZ(0.071);
  group.add(panel);
  return { group, light, stand, fixture, panel, glowMaterial, enabled: true };
}

function applyPose(name) {
  currentPose = name;
  star.applyAngles(poses[name]);
  poseCustomized = false;
  syncJointControls();
  document.querySelectorAll('[data-pose]').forEach((button) => {
    const selected = button.dataset.pose === name;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
    if (selected) document.querySelector('#pose-state').textContent = button.querySelector('b').textContent;
  });
}

function buildLightControls() {
  const container = document.querySelector('#light-controls');
  const template = document.querySelector('#light-control-template');
  lightDefinitions.forEach((definition) => {
    const fragment = template.content.cloneNode(true);
    const article = fragment.querySelector('.light-control');
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
    container.append(fragment);
  });
}

function bindInterface() {
  document.querySelector('#framing-controls').addEventListener('click', (event) => {
    const button = event.target.closest('[data-framing]');
    if (button && !modelLoading) frameCharacter(button.dataset.framing);
  });
  document.querySelector('#character-controls').addEventListener('click', (event) => {
    const button = event.target.closest('[data-character]');
    if (button && !modelLoading && !recorder) switchCharacter(button.dataset.character);
  });
  document.querySelector('#joint-select').addEventListener('change', (event) => { star.select(event.target.value); syncJointControls(); });
  document.querySelector('#edit-joints').addEventListener('change', (event) => star.setEditing(event.target.checked));
  document.querySelector('#auto-ground').addEventListener('change', (event) => {
    rememberState();
    star.setGrounded(event.target.checked);
    syncPlacementControls();
  });
  for (const selector of ['#character-height', '#character-height-value']) {
    const input = document.querySelector(selector);
    input.addEventListener('pointerdown', rememberState);
    input.addEventListener('focus', rememberState);
    input.addEventListener('input', () => {
      if (input.value === '' || !Number.isFinite(Number(input.value))) return;
      star.setHeight(Number(input.value));
      syncPlacementControls();
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
  bindPoseLibrary();
  document.querySelector('#pose-controls').addEventListener('click', (event) => {
    const button = event.target.closest('[data-pose]');
    if (!button) return;
    rememberState();
    applyPose(button.dataset.pose);
    document.querySelector('#pose-dialog').close();
    announce(`已切换为${button.querySelector('b').textContent}`);
  });

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
  document.querySelector('#record-button').addEventListener('click', () => {
    try { toggleRecording(); } catch (error) {
      console.error(error);
      stopRecordingUi();
      announce('录制失败，当前浏览器或设备不支持此编码');
    }
  });
  document.querySelector('#reset-button').addEventListener('click', resetStudio);
  document.querySelector('#undo-button').addEventListener('click', undo);
  window.addEventListener('resize', resizeViewport);
  new ResizeObserver(resizeViewport).observe(viewportFrame);
  controls.addEventListener('start', rememberState);
}

function frameCharacter(mode) {
  const bounds = star.getFramingBounds(mode);
  if (!bounds) return;
  rememberState();
  controls.autoRotate = false;
  document.querySelector('#auto-orbit').checked = false;
  controls.enableDamping = false;
  controls.update();
  const center = bounds.getCenter(new THREE.Vector3());
  const direction = camera.position.clone().sub(controls.target).normalize();
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
        const clearance = Math.max(Math.abs(offset.dot(right)) / horizontalSlope, Math.abs(offset.dot(up)) / verticalSlope);
        distance = Math.max(distance, offset.dot(direction) + clearance * 1.12);
      }
    }
  }
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, distance);
  controls.update();
  controls.enableDamping = true;
  announce(`已切换为${{ full: '全身取景', half: '半身取景', face: '面部特写', low: '低机位仰拍' }[mode]}`);
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
  if (recorder) return;
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

function takePhoto() {
  if (recorder && recorder.state !== 'inactive') {
    announce('请先停止录制再导出图片');
    return;
  }
  const width = currentAspect >= 1 ? 1920 : Math.round(1920 * currentAspect);
  const height = currentAspect >= 1 ? Math.round(1920 / currentAspect) : 1920;
  const previousSize = renderer.getSize(new THREE.Vector2());
  const previousRatio = renderer.getPixelRatio();
  const previousAspect = camera.aspect;
  const overlay = document.querySelector('.viewfinder');
  overlay.hidden = true;
  const wasEditing = star.editing;
  star.setEditing(false);

  try {
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  composer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  composer.render();
  const dataUrl = renderer.domElement.toDataURL('image/png');

  const link = document.createElement('a');
  link.download = `lights-camera-take-${String(takeNumber).padStart(2, '0')}.png`;
  link.href = dataUrl;
  link.click();
  takeNumber += 1;
  document.querySelector('#take-number').textContent = String(takeNumber).padStart(2, '0');

  announce(`图片已导出：${width} × ${height}`);
  } finally {
  renderer.setPixelRatio(previousRatio);
  renderer.setSize(previousSize.x, previousSize.y, false);
  composer.setSize(previousSize.x, previousSize.y);
  camera.aspect = previousAspect;
  camera.updateProjectionMatrix();
  overlay.hidden = false;
  star.setEditing(wasEditing);
  }
}

function toggleRecording() {
  if (recorder?.state === 'recording') {
    document.querySelector('#record-button').disabled = true;
    recorder.stop();
    return;
  }
  if (recorder) return;
  if (!renderer.domElement.captureStream || !window.MediaRecorder) {
    announce('当前浏览器不支持视频录制，请使用最新版 Chrome 或 Edge');
    return;
  }

  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) {
    announce('当前浏览器不支持 WebM 编码，请使用 Chrome 或 Edge');
    return;
  }
  const chunks = [];
  startRecordingUi();
  composer.render();
  const stream = renderer.domElement.captureStream(30);
  try {
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    recorder = null;
    throw error;
  }
  const activeRecorder = recorder;
  recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
  recorder.addEventListener('stop', () => {
    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(chunks, { type: activeRecorder.mimeType });
    recorder = null;
    if (!blob.size) {
      stopRecordingUi();
      announce('未捕获到视频，请延长录制时间后重试');
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `lights-camera-recording-${Date.now()}.webm`;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    stopRecordingUi();
    announce('视频已导出为 WebM');
  });
  recorder.addEventListener('error', () => {
    stream.getTracks().forEach((track) => track.stop());
    recorder = null;
    stopRecordingUi();
    announce('视频录制出错，请重试');
  });
  try { recorder.start(1000); } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    recorder = null;
    throw error;
  }
  announce('正在录制，可继续调整镜头、姿势和灯光');
}

function startRecordingUi() {
  editingBeforeRecording = star.editing;
  star.setEditing(false);
  document.querySelector('#edit-joints').disabled = true;
  document.querySelector('#pose-mode').disabled = true;
  document.querySelectorAll('[data-character]').forEach((button) => { button.disabled = true; });
  recordingStartedAt = Date.now();
  document.querySelector('#record-button').classList.add('is-recording');
  document.querySelector('#record-label').textContent = '停止录制';
  document.querySelector('#record-button').setAttribute('aria-label', '停止录制');
  document.querySelector('#record-button').title = '停止录制';
  document.querySelector('#photo-button').disabled = true;
  document.querySelector('#reset-button').disabled = true;
  document.querySelector('#load-button').disabled = true;
  document.querySelector('#undo-button').disabled = true;
  document.querySelectorAll('[data-aspect]').forEach((button) => { button.disabled = true; });
  document.querySelector('#record-time').textContent = '00:00';
  document.querySelector('#recording-indicator').hidden = false;
  recordingTimer = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordingStartedAt) / 1000);
    document.querySelector('#record-time').textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  }, 250);
}

function stopRecordingUi() {
  star.setEditing(editingBeforeRecording);
  document.querySelector('#edit-joints').disabled = false;
  document.querySelector('#pose-mode').disabled = false;
  document.querySelectorAll('[data-character]').forEach((button) => { button.disabled = false; });
  clearInterval(recordingTimer);
  document.querySelector('#record-button').disabled = false;
  document.querySelector('#record-button').classList.remove('is-recording');
  document.querySelector('#record-label').textContent = '录制视频';
  document.querySelector('#record-button').setAttribute('aria-label', '录制视频');
  document.querySelector('#record-button').title = '录制视频';
  document.querySelector('#photo-button').disabled = false;
  document.querySelector('#reset-button').disabled = false;
  document.querySelector('#load-button').disabled = false;
  document.querySelector('#undo-button').disabled = false;
  document.querySelectorAll('[data-aspect]').forEach((button) => { button.disabled = false; });
  resizeViewport();
  document.querySelector('#recording-indicator').hidden = true;
}

function captureState() {
  return {
    pose: currentPose,
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
  currentPose = state.pose;
  applyPose(state.pose);
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
    star.restorePose(state.jointPose);
    setRangeValue('#star-rotation', THREE.MathUtils.radToDeg(state.jointPose.rotation));
  } else {
    star.setGrounded(true);
    for (const side of ['left', 'right']) {
      const angles = [...star.poseAngles[`${side}UpperArm`]];
      angles[2] += THREE.MathUtils.degToRad(Number(state[`${side}Arm`] ?? 0));
      star.setJoint(`${side}UpperArm`, angles);
    }
  }
  if (state.poseCustomized) onJointChange(star.selected);
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
  return true;
}

function setRangeValue(selector, value) {
  const input = document.querySelector(selector);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function resetStudio() {
  rememberState();
  const defaults = {
    pose: 'warrior', backdrop: '#edf4f6', aspect: '1.5',
    cameraPosition: [0.8, 2.1, 7.5], target: [0, 1.65, 0], focal: '50', exposure: '0.5', dof: '0',
    lights: Object.fromEntries(lightDefinitions.map((light) => [light.id, { enabled: true, intensity: String(light.intensity), color: light.color, position: String(light.position[0]) }])),
  };
  await restoreState(defaults);
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
  const blob = new Blob([JSON.stringify({ version: 1, state: captureState() }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `studio-${Date.now()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce('项目已保存，包含背景图片与摄影参数');
}

function validProject(project) {
  const state = project?.state;
  const finiteRange = (value, min, max) => (typeof value === 'number' || typeof value === 'string') && value !== '' && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;
  const vector = (value) => Array.isArray(value) && value.length === 3 && value.every((number) => typeof number === 'number' && Number.isFinite(number));
  const color = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  if (project?.version !== 1 || !state || !Object.hasOwn(poses, state.pose) || !color(state.backdrop)) return false;
  if (state.character != null && !Object.hasOwn(CHARACTERS, state.character)) return false;
  if (state.jointPose != null && !validPose(state.jointPose)) return false;
  if (state.poseCustomized != null && typeof state.poseCustomized !== 'boolean') return false;
  if (state.removeShadows != null && typeof state.removeShadows !== 'boolean') return false;
  if (!['1.5', '1.333333', '1', '0.5625'].includes(String(state.aspect)) || !vector(state.cameraPosition) || !vector(state.target)) return false;
  if (!finiteRange(state.focal, 24, 100) || !finiteRange(state.exposure, 0.125, 2) || !finiteRange(state.dof, 0, 100)) return false;
  if (!finiteRange(state.rotation ?? 0, -180, 180) || !finiteRange(state.leftArm ?? 0, -90, 90) || !finiteRange(state.rightArm ?? 0, -90, 90)) return false;
  if (state.background != null && (typeof state.background !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(state.background) || state.background.length > 12 * 1024 * 1024)) return false;
  if (state.autoOrbit != null && typeof state.autoOrbit !== 'boolean' || state.showRigs != null && typeof state.showRigs !== 'boolean') return false;
  return state.lights && Object.keys(state.lights).length === 3 && lightDefinitions.every(({ id }) => {
    const light = state.lights[id];
    return light && typeof light.enabled === 'boolean' && color(light.color) && finiteRange(light.intensity, 0, 12) && finiteRange(light.position, -6, 6) && finiteRange(light.height ?? 3, 1, 6) && finiteRange(light.depth ?? 0, -4, 6);
  });
}

async function loadProject(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 13 * 1024 * 1024) throw new Error('Project too large');
    const project = JSON.parse(await file.text());
    if (!validProject(project)) throw new Error('Invalid studio project');
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

function bindPoseLibrary() {
  const library = document.querySelector('#pose-library');
  const folderSelect = document.querySelector('#pose-folder');
  const folderNav = document.querySelector('#pose-folders');
  const search = document.querySelector('#pose-search');
  const clear = document.querySelector('#pose-search-clear');
  const results = document.querySelector('#pose-controls');
  const buttons = [...results.querySelectorAll('[data-pose]')];
  const folders = new Map([['', buttons.length]]);
  const dialog = document.querySelector('#pose-dialog');
  const expand = document.querySelector('#pose-expand');
  for (const button of buttons) {
    folders.set(button.dataset.folder, (folders.get(button.dataset.folder) ?? 0) + 1);
    button.setAttribute('aria-pressed', String(button.classList.contains('is-active')));
    const check = document.createElement('i');
    check.dataset.lucide = 'check';
    check.className = 'pose-check';
    check.setAttribute('aria-hidden', 'true');
    button.append(check);
  }
  folderSelect.replaceChildren();
  for (const [folder, count] of folders) {
    const label = folder || '全部姿势';
    folderSelect.add(new Option(`${label} (${count})`, folder));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pose-folder-button';
    button.dataset.folder = folder;
    const icon = document.createElement('i');
    icon.dataset.lucide = folder ? 'folder' : 'layers';
    icon.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.textContent = label;
    const total = document.createElement('small');
    total.textContent = count;
    button.append(icon, name, total);
    button.addEventListener('click', () => {
      folderSelect.value = folder;
      updateResults();
    });
    folderNav.append(button);
  }
  function updateResults() {
    const query = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const button of buttons) {
      const matchesFolder = !folderSelect.value || button.dataset.folder === folderSelect.value;
      const matchesSearch = `${button.querySelector('b').textContent} ${button.dataset.folder}`.toLocaleLowerCase().includes(query);
      button.hidden = !matchesFolder || !matchesSearch;
      if (!button.hidden) visible++;
    }
    folderNav.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.folder === folderSelect.value)));
    document.querySelector('#pose-count').textContent = `${folderSelect.value || '全部姿势'} · ${visible} / ${folders.get(folderSelect.value)}`;
    document.querySelector('#pose-empty').hidden = visible > 0;
    clear.hidden = !search.value;
    results.scrollTop = 0;
  }
  folderSelect.addEventListener('change', updateResults);
  search.addEventListener('input', updateResults);
  clear.addEventListener('click', () => {
    search.value = '';
    updateResults();
    search.focus();
  });
  expand.addEventListener('click', () => {
    document.querySelector('#pose-dialog-body').append(library);
    dialog.showModal();
    search.focus();
  });
  document.querySelector('#pose-dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.querySelector('#pose-library-home').append(library);
    expand.focus({ preventScroll: true });
  });
  dialog.addEventListener('click', (event) => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  updateResults();
  window.lucide?.createIcons();
}

function onJointChange(id, edited = true) {
  if (edited) {
    poseCustomized = true;
    document.querySelectorAll('[data-pose]').forEach((button) => {
      button.classList.remove('is-active');
      button.setAttribute('aria-pressed', 'false');
    });
    document.querySelector('#pose-state').textContent = '自定义姿势';
  }
  syncJointControls();
}

async function switchCharacter(id, recordHistory = true) {
  if (modelLoading || !Object.hasOwn(CHARACTERS, id)) return false;
  if (star.vrm && star.id === id) return true;
  if (recordHistory) rememberState();
  modelLoading = true;
  document.querySelector('#character-controls').setAttribute('aria-busy', 'true');
  document.querySelector('#model-credit').textContent = '正在加载人偶…';
  const actions = ['#save-button', '#load-button', '#undo-button', '#reset-button', '#photo-button', '#record-button'];
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
    onJointChange(star.selected);
    announce('姿势已导入');
  } catch (error) {
    announce(`未导入：${error.message}，当前姿势已保留`);
  }
}