import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { PROP_TYPES, MAX_PROPS, createPropState, validProps } from './prop-schema.js';

export function createPropModel(type, color) {
  if (!Object.hasOwn(PROP_TYPES, type)) throw new Error('未知道具类型');
  const group = new THREE.Group();
  const shape = new THREE.Group();
  group.add(shape);
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const metal = new THREE.MeshStandardMaterial({ color: '#d2d9dc', metalness: 0.75, roughness: 0.3 });
  const add = (geometry, material, position) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    shape.add(mesh);
    return mesh;
  };
  if (type === 'block') {
    add(new THREE.BoxGeometry(1, 1, 1), paint, [0, 0.5, 0]);
  } else if (type === 'sword') {
    const blade = new THREE.Shape();
    blade.moveTo(-0.055, 0.3);
    blade.lineTo(-0.055, 1.25);
    blade.lineTo(0, 1.48);
    blade.lineTo(0.055, 1.25);
    blade.lineTo(0.055, 0.3);
    blade.closePath();
    add(new THREE.ExtrudeGeometry(blade, { depth: 0.028, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1, steps: 1 }), metal, [0, 0, -0.014]);
    add(new THREE.BoxGeometry(0.34, 0.045, 0.075), metal, [0, 0.3, 0]);
    add(new THREE.CylinderGeometry(0.033, 0.04, 0.23, 12), paint, [0, 0.16, 0]);
    add(new THREE.SphereGeometry(0.045, 12, 8), metal, [0, 0.035, 0]);
  } else if (type === 'gun') {
    add(new THREE.BoxGeometry(0.56, 0.13, 0.14), paint, [0, 0.32, 0]);
    add(new THREE.BoxGeometry(0.14, 0.26, 0.12), paint, [-0.15, 0.14, 0]).rotation.z = -0.22;
    add(new THREE.BoxGeometry(0.34, 0.06, 0.1), metal, [0.04, 0.225, 0]);
    add(new THREE.TorusGeometry(0.065, 0.012, 8, 20), metal, [0.015, 0.165, 0]);
    const muzzle = new THREE.MeshStandardMaterial({ color: '#eab747', roughness: 0.6 });
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.07, 12), muzzle, [0.3, 0.32, 0]).rotation.z = Math.PI / 2;
  } else {
    const ceramic = new THREE.MeshStandardMaterial({ color: '#eef1ed', roughness: 0.28 });
    const green = new THREE.MeshStandardMaterial({ color: '#477a4c', roughness: 0.85 });
    const centerMaterial = new THREE.MeshStandardMaterial({ color: '#edc65b', roughness: 0.8 });
    add(new THREE.CylinderGeometry(0.105, 0.15, 0.28, 24), ceramic, [0, 0.14, 0]);
    const blossoms = [[0, 0.9, 0], [-0.19, 0.73, 0.06], [0.17, 0.77, 0.09], [-0.04, 0.72, -0.2], [0.05, 0.64, 0.2]];
    for (const position of blossoms) {
      const start = new THREE.Vector3(0, 0.19, 0);
      const end = new THREE.Vector3(...position);
      const direction = end.clone().sub(start);
      const stem = add(new THREE.CylinderGeometry(0.012, 0.016, direction.length(), 8), green, start.clone().add(end).multiplyScalar(0.5).toArray());
      stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      for (let petal = 0; petal < 7; petal++) {
        const angle = petal * Math.PI * 2 / 7;
        const mesh = add(new THREE.SphereGeometry(0.085, 12, 8), paint, [end.x + Math.cos(angle) * 0.075, end.y, end.z + Math.sin(angle) * 0.075]);
        mesh.scale.set(1, 0.4, 0.65);
        mesh.rotation.y = -angle;
      }
      add(new THREE.SphereGeometry(0.046, 12, 8), centerMaterial, [end.x, end.y + 0.023, end.z]);
      const leaf = add(new THREE.SphereGeometry(0.09, 12, 8), green, [end.x * 0.7 + 0.065, end.y * 0.62, end.z * 0.7]);
      leaf.scale.set(1.5, 0.18, 0.6);
      leaf.rotation.z = 0.4;
    }
  }
  const bounds = new THREE.Box3().setFromObject(shape);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  shape.scale.set(1 / size.x, 1 / size.y, 1 / size.z);
  shape.position.set(-center.x / size.x, -bounds.min.y / size.y, -center.z / size.z);
  group.userData.paint = paint;
  if (!shape.children.some(mesh => mesh.material === metal)) metal.dispose();
  return group;
}

function disposeModel(group) {
  const materials = new Set();
  group.traverse(object => {
    object.geometry?.dispose();
    if (object.material) materials.add(object.material);
  });
  materials.forEach(material => material.dispose());
}

export function createPropsController({ scene, root, camera, canvas, orbit, onSelect = () => {}, canPick = () => true, onBeforeChange, onChange, onFrame, isAvailable, announce }) {
  const group = new THREE.Group();
  group.name = 'Props';
  scene.add(group);
  let items = [];
  let selected = null;
  let editing = false;
  let helpersVisible = true;
  let pointerStart = null;
  let orbitState = null;
  const gizmo = camera && canvas ? new TransformControls(camera, canvas) : null;
  const outline = gizmo ? new THREE.Box3Helper(new THREE.Box3(), '#d34e38') : null;
  if (gizmo) {
    gizmo.setSize(0.75);
    gizmo.enabled = false;
    outline.visible = false;
    scene.add(gizmo.getHelper(), outline);
  }
  root.innerHTML = `
    <div class="shot-controls"><select id="prop-type" aria-label="添加道具类型"></select><button class="icon-button" id="prop-add" type="button" title="添加道具" aria-label="添加道具"><i data-lucide="plus"></i></button></div>
    <div class="prop-toolbar"><output id="prop-count"></output><button class="icon-button" id="prop-frame" type="button" title="人物与全部道具取景" aria-label="全部取景"><i data-lucide="scan"></i></button><button class="icon-button" id="prop-copy" type="button" title="复制选中道具" aria-label="复制道具"><i data-lucide="copy-plus"></i></button><button class="icon-button" id="prop-delete" type="button" title="删除选中道具" aria-label="删除道具"><i data-lucide="trash-2"></i></button></div>
    <select id="prop-list" size="4" aria-label="场景道具列表"></select>
    <div class="prop-transform" role="group" aria-label="道具变换模式">${[['translate', 'move-3d', '移动'], ['rotate', 'rotate-3d', '旋转'], ['scale', 'scaling', '缩放']].map(([mode, icon, label]) => `<button class="icon-button" type="button" data-prop-mode="${mode}" title="${label}道具" aria-label="${label}道具" aria-pressed="${mode === 'translate'}"><i data-lucide="${icon}"></i></button>`).join('')}</div>
    <fieldset id="prop-fields"><legend>道具参数</legend>
    ${[['position', '位置', -20, 20], ['rotation', '旋转角度', -180, 180], ['size', '尺寸', 0.02, 10]].map(([key, name, min, max]) => `<div class="prop-vector"><span>${name}</span><div>${['X', 'Y', 'Z'].map((axis, index) => `<label>${axis}<input type="number" data-prop-field="${key}" data-axis="${index}" min="${min}" max="${max}" step="any" aria-label="道具${name} ${axis}"></label>`).join('')}</div></div>`).join('')}
    <label class="prop-color">颜色<input id="prop-color" type="color" aria-label="道具颜色"></label></fieldset>`;
  const typeSelect = root.querySelector('#prop-type');
  Object.entries(PROP_TYPES).forEach(([type, definition]) => typeSelect.add(new Option(definition.name, type)));
  const list = root.querySelector('#prop-list');
  const current = () => items.find(item => item.id === selected);
  const apply = item => {
    const model = group.children.find(child => child.name === item.id);
    model.position.fromArray(item.position);
    model.rotation.set(...item.rotation);
    model.scale.fromArray(item.size);
    model.userData.paint.color.set(item.color);
    group.updateMatrixWorld(true);
    updateHelpers();
  };
  function updateHelpers() {
    if (!gizmo) return;
    const model = group.children.find(child => child.name === selected);
    const visible = !!model && editing && helpersVisible;
    gizmo.enabled = visible;
    if (visible) {
      gizmo.attach(model);
      outline.box.setFromObject(model);
    } else gizmo.detach();
    outline.visible = visible;
  }
  function finishDrag() {
    if (!orbitState) return;
    orbit.enabled = orbitState.enabled;
    orbit.autoRotate = orbitState.autoRotate;
    orbitState = null;
  }
  gizmo?.addEventListener('mouseDown', () => {
    if (!isAvailable()) return;
    onBeforeChange();
    if (orbit) {
      orbitState = { enabled: orbit.enabled, autoRotate: orbit.autoRotate };
      orbit.enabled = false;
      orbit.autoRotate = false;
    }
  });
  gizmo?.addEventListener('mouseUp', finishDrag);
  gizmo?.addEventListener('objectChange', () => {
    const item = current();
    if (!item) return;
    const model = gizmo.object;
    if (isAvailable()) {
      item.position = model.position.toArray().map(value => THREE.MathUtils.clamp(value, -20, 20));
      item.rotation = [model.rotation.x, model.rotation.y, model.rotation.z].map(value => Math.atan2(Math.sin(value), Math.cos(value)));
      item.size = model.scale.toArray().map(value => THREE.MathUtils.clamp(value, 0.02, 10));
    }
    apply(item);
    sync();
    onChange();
  });
  const pointerDown = event => {
    pointerStart = event.button === 0 ? [event.clientX, event.clientY] : null;
  };
  const pointerUp = event => {
    const start = pointerStart;
    pointerStart = null;
    if (!start || !isAvailable() || !canPick() || gizmo?.axis || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 5) return;
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    let model = raycaster.intersectObject(group, true)[0]?.object;
    while (model && model.parent !== group) model = model.parent;
    selected = model?.name ?? null;
    if (selected) onSelect();
    sync();
  };
  const cancelPointer = () => { pointerStart = null; finishDrag(); };
  if (gizmo) {
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointerup', pointerUp);
    canvas.addEventListener('pointercancel', cancelPointer);
    canvas.addEventListener('lostpointercapture', finishDrag);
  }
  root.querySelectorAll('[data-prop-mode]').forEach(button => button.addEventListener('click', () => {
    if (!isAvailable()) return;
    gizmo?.setMode(button.dataset.propMode);
    gizmo?.setSpace(button.dataset.propMode === 'translate' ? 'world' : 'local');
    root.querySelectorAll('[data-prop-mode]').forEach(option => option.setAttribute('aria-pressed', String(option === button)));
  }));
  function sync() {
    const item = current();
    list.replaceChildren(...items.map((entry, index) => new Option(`${String(index + 1).padStart(2, '0')} · ${PROP_TYPES[entry.type].name}`, entry.id)));
    list.value = selected ?? '';
    root.querySelector('#prop-count').value = `${items.length} / ${MAX_PROPS}`;
    root.querySelector('#prop-add').disabled = items.length >= MAX_PROPS;
    root.querySelector('#prop-copy').disabled = !item || items.length >= MAX_PROPS;
    root.querySelector('#prop-delete').disabled = !item;
    root.querySelector('#prop-fields').disabled = !item;
    root.querySelectorAll('[data-prop-field]').forEach(input => {
      const value = item?.[input.dataset.propField][Number(input.dataset.axis)] ?? 0;
      input.value = Number((input.dataset.propField === 'rotation' ? THREE.MathUtils.radToDeg(value) : value).toFixed(3));
      input.setCustomValidity('');
    });
    root.querySelector('#prop-color').value = item?.color ?? '#b6c3c8';
    root.querySelectorAll('[data-prop-mode]').forEach(button => { button.disabled = !item; });
    updateHelpers();
  }
  function insert(item) {
    if (!isAvailable() || items.length >= MAX_PROPS) return;
    const model = createPropModel(item.type, item.color);
    onBeforeChange();
    model.name = item.id;
    group.add(model);
    items.push(item);
    selected = item.id;
    apply(item);
    sync();
    onChange();
    announce(`已添加${PROP_TYPES[item.type].name}`);
  }
  root.querySelector('#prop-add').addEventListener('click', () => {
    const item = createPropState(typeSelect.value);
    item.position = [1.4 + (items.length % 4) * 1.25, 0, -Math.floor(items.length / 4) * 1.25];
    insert(item);
  });
  root.querySelector('#prop-copy').addEventListener('click', () => {
    const item = current();
    if (!item) return;
    const copy = { ...structuredClone(item), id: createPropState(item.type).id };
    copy.position[0] = Math.min(20, copy.position[0] + 0.25);
    insert(copy);
  });
  root.querySelector('#prop-delete').addEventListener('click', () => {
    if (!current() || !isAvailable()) return;
    onBeforeChange();
    const model = group.children.find(child => child.name === selected);
    group.remove(model);
    disposeModel(model);
    items = items.filter(item => item.id !== selected);
    selected = items.at(-1)?.id ?? null;
    sync();
    onChange();
    announce('道具已删除，可撤销');
  });
  root.querySelector('#prop-frame').addEventListener('click', () => { if (isAvailable()) onFrame(); });
  list.addEventListener('change', () => { selected = list.value; sync(); });
  root.querySelectorAll('#prop-fields input').forEach(input => {
    input.addEventListener('focus', () => { if (isAvailable()) onBeforeChange(); });
    input.addEventListener('input', () => {
      const item = current();
      if (!item || !isAvailable()) return;
      const next = structuredClone(item);
      if (input.id === 'prop-color') next.color = input.value;
      else {
        const value = input.value === '' ? NaN : Number(input.value);
        next[input.dataset.propField][Number(input.dataset.axis)] = input.dataset.propField === 'rotation' ? THREE.MathUtils.degToRad(value) : value;
      }
      if (!validProps([next])) { input.setCustomValidity('请输入范围内的数值'); return; }
      input.setCustomValidity('');
      Object.assign(item, next);
      apply(item);
      onChange();
    });
    input.addEventListener('change', sync);
  });
  sync();
  return {
    group,
    gizmo,
    setEditing(value) { finishDrag(); editing = value; updateHelpers(); },
    setHelpersVisible(value) { finishDrag(); helpersVisible = value; updateHelpers(); },
    capture: () => structuredClone(items),
    getBounds: () => new THREE.Box3().setFromObject(group),
    restore(snapshot) {
      if (!validProps(snapshot)) throw new Error('道具配置无效');
      const next = structuredClone(snapshot);
      const models = next.map(item => { const model = createPropModel(item.type, item.color); model.name = item.id; return model; });
      group.children.forEach(disposeModel);
      group.clear();
      if (models.length) group.add(...models);
      items = next;
      selected = items.some(item => item.id === selected) ? selected : items[0]?.id ?? null;
      items.forEach(apply);
      sync();
    },
    dispose() {
      finishDrag();
      if (gizmo) {
        canvas.removeEventListener('pointerdown', pointerDown);
        canvas.removeEventListener('pointerup', pointerUp);
        canvas.removeEventListener('pointercancel', cancelPointer);
        canvas.removeEventListener('lostpointercapture', finishDrag);
        scene.remove(gizmo.getHelper(), outline);
        gizmo.dispose();
        outline.dispose();
      }
      group.children.forEach(disposeModel); group.clear(); scene.remove(group);
    },
  };
}