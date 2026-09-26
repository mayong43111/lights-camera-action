import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CHARACTERS } from './character.js';
import { PROP_MODELS, validSceneObjects } from './project-schema.js';

export function createProp(model) {
  if (!Object.hasOwn(PROP_MODELS, model)) throw new Error('未知道具');
  const group = new THREE.Group();
  const upholstery = new THREE.MeshStandardMaterial({ color: '#ac4c48', roughness: 0.85 });
  const metal = new THREE.MeshStandardMaterial({ color: '#aeb9bc', metalness: 0.65, roughness: 0.32 });
  const porcelain = new THREE.MeshStandardMaterial({ color: '#e8ece9', roughness: 0.55 });
  const add = (geometry, material, position) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  if (model === 'plinth') {
    add(new THREE.BoxGeometry(1.2, 1, 1.2), porcelain, [0, 0.5, 0]);
  } else {
    for (const horizontal of [-0.42, 0.42]) for (const depth of [-0.38, 0.38]) {
      add(new THREE.CylinderGeometry(0.035, 0.045, 0.9, 12), metal, [horizontal, 0.45, depth]);
    }
    add(model === 'chair' ? new THREE.BoxGeometry(1.12, 0.16, 1.05) : new THREE.CylinderGeometry(0.62, 0.62, 0.16, 40), upholstery, [0, 0.98, 0]);
    if (model === 'chair') {
      for (const horizontal of [-0.47, 0.47]) add(new THREE.CylinderGeometry(0.035, 0.035, 1, 12), metal, [horizontal, 1.47, -0.43]);
      add(new THREE.BoxGeometry(1.12, 0.65, 0.14), upholstery, [0, 1.69, -0.44]);
    }
  }
  group.userData.materials = [upholstery, metal, porcelain];
  return group;
}

function disposeEntry(entry) {
  if (entry.character) entry.character.dispose();
  else {
    entry.group.traverse(object => object.geometry?.dispose());
    entry.group.userData.materials.forEach(material => material.dispose());
    entry.group.removeFromParent();
  }
}

export class SceneObjects {
  constructor({ scene, camera, canvas, controls, createCharacter, onBeforeSelect = () => {}, onSelect = () => {}, onChange = () => {}, onStart = () => {}, isBlocked = () => false }) {
    Object.assign(this, { scene, camera, canvas, controls, createCharacter, onBeforeSelect, onSelect, onChange, onStart, isBlocked });
    this.entries = [];
    this.activeId = null;
    this.editing = true;
    this.jointEditing = false;
    this.busy = false;
    this.listeners = new AbortController();
    this.box = new THREE.Box3Helper(new THREE.Box3(), '#27806a');
    this.box.visible = false;
    this.box.material.depthTest = false;
    this.box.renderOrder = 999;
    scene.add(this.box);
    this.gizmo = new TransformControls(camera, canvas);
    this.gizmo.setMode('translate');
    this.gizmo.setSpace('world');
    this.gizmo.setSize(0.65);
    this.helper = this.gizmo.getHelper();
    scene.add(this.helper);
    this.gizmo.addEventListener('mouseDown', () => this.onStart());
    this.gizmo.addEventListener('dragging-changed', event => { controls.enabled = !event.value; });
    this.gizmo.addEventListener('objectChange', () => {
      const entry = this.active;
      if (!entry) return;
      for (const axis of ['x', 'y', 'z']) entry.group.position[axis] = THREE.MathUtils.clamp(entry.group.position[axis], -1000, 1000);
      if (entry.character) {
        entry.group.rotation.x = 0;
        entry.group.rotation.z = 0;
      } else {
        const scale = THREE.MathUtils.clamp(entry.group.scale.x, 0.1, 5);
        entry.group.scale.setScalar(scale);
      }
      this.onChange();
    });
    const raycaster = new THREE.Raycaster();
    let start;
    canvas.addEventListener('pointerdown', event => { start = [event.clientX, event.clientY]; }, { signal: this.listeners.signal });
    canvas.addEventListener('pointerup', event => {
      if (this.busy || this.isBlocked() || !this.editing || this.gizmo.axis || this.jointEditing && this.active?.character
        || event.button !== 0 || !start || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 5) return;
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera);
      let hit = raycaster.intersectObjects(this.entries.filter(entry => entry.visible).map(entry => entry.group), true)[0]?.object;
      while (hit && !hit.userData.studioObjectId) hit = hit.parent;
      if (hit) this.select(hit.userData.studioObjectId);
    }, { signal: this.listeners.signal });
  }

  get active() { return this.entries.find(entry => entry.id === this.activeId); }
  get vrm() { return this.entries.find(entry => entry.character?.vrm)?.character.vrm; }
  get people() { return this.entries.filter(entry => entry.character); }

  register(character, metadata) {
    const entry = { ...metadata, id: `object-${crypto.randomUUID()}`, kind: 'character', name: '人物 1', visible: true, locked: false, character, group: character.group };
    entry.group.userData.studioObjectId = entry.id;
    this.entries.push(entry);
    this.activeId = entry.id;
    return entry;
  }

  snapshot(entry) {
    const base = { id: entry.id, kind: entry.kind, name: entry.name, visible: entry.visible, locked: entry.locked };
    if (entry.character) return { ...base, model: entry.character.id, position: [entry.group.position.x, 0, entry.group.position.z],
      jointPose: entry.character.capturePose(), pose: entry.pose, poseSaveTarget: entry.poseSaveTarget, poseCustomized: entry.poseCustomized };
    return { ...base, model: entry.model, position: entry.group.position.toArray(), rotation: entry.group.rotation.toArray().slice(0, 3), scale: entry.group.scale.x };
  }

  capture() { return this.entries.map(entry => this.snapshot(entry)); }

  async makeEntry(snapshot) {
    const entry = structuredClone(snapshot);
    if (entry.kind === 'character') {
      entry.character = this.createCharacter();
      entry.group = entry.character.group;
    } else {
      entry.group = createProp(entry.model);
      this.scene.add(entry.group);
    }
    entry.group.visible = false;
    try {
      if (entry.character) {
        if (!await entry.character.load(entry.model)) throw new Error('人物加载已取消');
        entry.character.restorePose(entry.jointPose);
        entry.group.position.x = entry.position[0];
        entry.group.position.z = entry.position[2];
      } else {
        entry.group.position.fromArray(entry.position);
        entry.group.rotation.set(...entry.rotation);
        entry.group.scale.setScalar(entry.scale);
      }
      entry.group.userData.studioObjectId = entry.id;
      return entry;
    } catch (error) { disposeEntry(entry); throw error; }
  }

  async add(snapshot) {
    if (this.busy || this.isBlocked()) return null;
    const next = { ...structuredClone(snapshot), id: `object-${crypto.randomUUID()}`, visible: true, locked: false };
    if (!validSceneObjects([...this.capture(), next], next.id, CHARACTERS)) throw new Error('场景最多支持 4 个人物、16 个对象；请检查对象参数。');
    this.busy = true;
    this.onStart();
    try {
      const entry = await this.makeEntry(next);
      this.entries.push(entry);
      entry.group.visible = true;
      this.select(entry.id, true);
      this.onChange();
      return entry;
    } finally { this.busy = false; this.refreshEditors(); }
  }

  async restore(snapshots, selected) {
    if (this.busy) throw new Error('场景正在加载');
    if (!validSceneObjects(snapshots, selected, CHARACTERS)) throw new Error('场景对象数据无效');
    this.busy = true;
    const staged = [];
    try {
      for (const snapshot of snapshots) {
        const existing = this.entries.find(entry => entry.id === snapshot.id && entry.kind === snapshot.kind && (entry.character?.id ?? entry.model) === snapshot.model);
        staged.push(existing ?? await this.makeEntry(snapshot));
      }
      this.gizmo.detach();
      this.entries.filter(entry => !staged.includes(entry)).forEach(disposeEntry);
      this.entries = staged;
      staged.forEach((entry, index) => {
        Object.assign(entry, structuredClone(snapshots[index]));
        if (entry.character) {
          entry.character.restorePose(entry.jointPose);
          entry.group.position.x = entry.position[0];
          entry.group.position.z = entry.position[2];
        } else {
          entry.group.position.fromArray(entry.position);
          entry.group.rotation.set(...entry.rotation);
          entry.group.scale.setScalar(entry.scale);
        }
        entry.group.visible = entry.visible;
      });
      this.activeId = null;
      this.select(selected, true);
    } catch (error) {
      if (this.entries !== staged) staged.filter(entry => !this.entries.includes(entry)).forEach(disposeEntry);
      throw error;
    } finally { this.busy = false; this.refreshEditors(); }
  }

  select(id, force = false) {
    if (!force && (this.busy || this.isBlocked()) || !this.entries.some(entry => entry.id === id) || this.activeId === id) return;
    this.onBeforeSelect();
    this.activeId = id;
    this.refreshEditors();
    this.onSelect(this.active);
  }

  removeSelected() {
    const entry = this.active;
    if (!entry || entry.locked || this.busy || this.isBlocked()) return;
    if (entry.character && this.people.length === 1) throw new Error('场景至少保留一个人物');
    this.onStart();
    this.gizmo.detach();
    this.entries = this.entries.filter(item => item !== entry);
    disposeEntry(entry);
    this.select(this.people[0].id, true);
    this.onChange();
  }

  setJointEditing(value) { this.jointEditing = value; this.refreshEditors(); }
  setEditing(value) { this.editing = value; this.refreshEditors(); }

  refreshEditors() {
    const active = this.active;
    const enabled = this.editing && !this.busy && !this.isBlocked() && active?.visible && !active.locked;
    for (const entry of this.people) entry.character.setEditing(!!enabled && entry === active && this.jointEditing);
    this.gizmo.detach();
    this.gizmo.enabled = !!enabled && (!active.character || !this.jointEditing);
    const rotating = this.gizmo.getMode() === 'rotate';
    this.gizmo.showX = !active?.character || !rotating;
    this.gizmo.showY = !active?.character || rotating;
    this.gizmo.showZ = !active?.character || !rotating;
    if (this.gizmo.enabled) this.gizmo.attach(active.group);
    this.box.visible = !!active?.visible && this.editing && !this.busy;
  }

  bounds(entry, mode = 'full') {
    if (!entry?.visible) return null;
    return entry.character ? entry.character.getFramingBounds(mode) : new THREE.Box3().setFromObject(entry.group);
  }

  framingBounds(mode) {
    if (mode !== 'all') return this.bounds(this.active, mode);
    const bounds = new THREE.Box3();
    for (const entry of this.entries) { const part = this.bounds(entry); if (part) bounds.union(part); }
    return bounds.isEmpty() ? null : bounds;
  }

  update(delta) {
    for (const entry of this.people) entry.character.update(delta);
    if (this.box.visible) {
      const bounds = this.bounds(this.active);
      if (bounds) this.box.box.copy(bounds);
      else this.box.visible = false;
    }
  }

  dispose() {
    this.listeners.abort();
    this.gizmo.dispose();
    this.helper.removeFromParent();
    this.box.geometry.dispose();
    this.box.material.dispose();
    this.box.removeFromParent();
    this.entries.forEach(disposeEntry);
    this.entries = [];
  }
}