import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { LimbIK } from './pose-ik.js';
import { createMannequin } from './mannequin.js';

export const CHARACTERS = {
  pixiv: { name: '凛 · 人形模特', url: './assets/characters/pixiv.vrm', credit: 'pixiv Inc. · VRM Public License 1.0' },
  seed: { name: 'Seed · 风格模特', url: './assets/characters/seed.vrm', credit: 'Seed-san by VirtualCast, Inc. · VRM Public License 1.0' },
  mannequin: { name: '男性白模 · 健硕人形', url: './assets/characters/mannequin.glb', format: 'gltf', credit: 'Quaternius · Universal Base Characters · CC0' },
  mannequinFemale: { name: '女性白模 · 基础人形', url: './assets/characters/mannequin-female.glb', format: 'gltf', credit: 'Quaternius · Universal Base Characters · CC0' },
  vroidA: { name: 'VRoid A · 时装模特', url: './assets/characters/vroid-a.vrm', credit: 'VRoid / pixiv Inc. · VRoid 示例模型使用条件（非 CC0）' },
  vroidB: { name: 'VRoid B · 潮流模特', url: './assets/characters/vroid-b.vrm', credit: 'VRoid / pixiv Inc. · VRoid 示例模型使用条件（非 CC0）' },
  vroidC: { name: 'VRoid C · 造型模特', url: './assets/characters/vroid-c.vrm', credit: 'VRoid / pixiv Inc. · VRoid 示例模型使用条件（非 CC0）' },
};

export const JOINTS = [
  ['root', 'hips', '骨盆'], ['torso', 'spine', '腰部'], ['chest', 'chest', '胸部'],
  ['neck', 'neck', '颈部'], ['head', 'head', '头部'],
  ['leftShoulder', 'leftShoulder', '左肩'], ['leftUpperArm', 'leftUpperArm', '左上臂'],
  ['leftLowerArm', 'leftLowerArm', '左前臂'], ['leftHand', 'leftHand', '左手腕'],
  ['rightShoulder', 'rightShoulder', '右肩'], ['rightUpperArm', 'rightUpperArm', '右上臂'],
  ['rightLowerArm', 'rightLowerArm', '右前臂'], ['rightHand', 'rightHand', '右手腕'],
  ['leftUpperLeg', 'leftUpperLeg', '左大腿'], ['leftLowerLeg', 'leftLowerLeg', '左小腿'],
  ['leftFoot', 'leftFoot', '左脚踝'], ['leftToes', 'leftToes', '左脚尖'],
  ['rightUpperLeg', 'rightUpperLeg', '右大腿'], ['rightLowerLeg', 'rightLowerLeg', '右小腿'],
  ['rightFoot', 'rightFoot', '右脚踝'], ['rightToes', 'rightToes', '右脚尖'],
];

for (const [side, sideLabel] of [['left', '左'], ['right', '右']]) {
  for (const [finger, label] of [['Thumb', '拇指'], ['Index', '食指'], ['Middle', '中指'], ['Ring', '无名指'], ['Little', '小指']]) {
    const segments = finger === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
    segments.forEach((segment, index) => {
      const name = `${side}${finger}${segment}`;
      JOINTS.push([name, name, `${sideLabel}${label} ${index + 1}`]);
    });
  }
}

export function validPose(pose) {
  if (!pose || pose.format !== 'studio-pose' || pose.version !== 1 || pose.units !== 'radians') return false;
  if (typeof pose.rotation !== 'number' || !Number.isFinite(pose.rotation) || Math.abs(pose.rotation) > Math.PI) return false;
  if (pose.placement != null && (typeof pose.placement !== 'object' || Array.isArray(pose.placement)
    || typeof pose.placement.grounded !== 'boolean' || typeof pose.placement.height !== 'number'
    || !Number.isFinite(pose.placement.height) || Math.abs(pose.placement.height) > 1000)) return false;
  if (!pose.joints || typeof pose.joints !== 'object' || Array.isArray(pose.joints)) return false;
  const known = new Set(JOINTS.map(([id]) => id));
  const entries = Object.entries(pose.joints);
  return entries.length > 0 && entries.length <= JOINTS.length && entries.every(([id, values]) => known.has(id)
    && Array.isArray(values) && values.length === 3
    && values.every((value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Math.PI));
}

export function validateVrmBytes(bytes, requireVrm = true) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 20 || bytes.byteLength > 40 * 1024 * 1024) throw new Error('模型必须小于 40 MB');
  const header = new DataView(bytes);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(12, true) > bytes.byteLength - 20 || header.getUint32(16, true) !== 0x4e4f534a) throw new Error('不是有效的 VRM/GLB 文件');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, header.getUint32(12, true))));
  if (requireVrm && !json.extensions?.VRMC_vrm && !json.extensions?.VRM) throw new Error('该文件不包含 VRM 人形骨骼');
  for (const resource of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (resource.uri && !resource.uri.startsWith('data:')) throw new Error('请选择素材内嵌的独立 VRM 文件');
  }
  return json;
}

export class Character {
  constructor(scene, camera, canvas, orbit, onChange, onStart, maxAnisotropy = 1) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Star';
    scene.add(this.group);
    this.joints = {};
    this.poseAngles = {};
    this.id = 'pixiv';
    this.version = 0;
    this.editing = false;
    this.editMode = 'fk';
    this.grounded = true;
    this.height = 0;
    this.ikDrag = null;
    this.canvas = canvas;
    this.orbit = orbit;
    this.selected = 'head';
    this.onChange = onChange;
    this.maxAnisotropy = Math.min(8, maxAnisotropy);
    this.loader = new GLTFLoader();
    this.loader.register((parser) => new VRMLoaderPlugin(parser));
    this.gizmo = new TransformControls(camera, canvas);
    this.gizmo.setMode('rotate');
    this.gizmo.setSpace('local');
    this.gizmo.setSize(0.7);
    this.helper = this.gizmo.getHelper();
    scene.add(this.helper);
    this.markers = new THREE.Group();
    scene.add(this.markers);
    this.gizmo.addEventListener('mouseDown', () => onStart());
    this.gizmo.addEventListener('dragging-changed', (event) => { orbit.enabled = !event.value; });
    this.gizmo.addEventListener('objectChange', () => {
      const joint = this.joints[this.selected];
      if (!joint) return;
      const angles = [joint.rotation.x, joint.rotation.y, joint.rotation.z].map((value) => Math.atan2(Math.sin(value), Math.cos(value)));
      this.setJoint(this.selected, angles);
      onChange(this.selected);
    });
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerStart;
    canvas.addEventListener('pointerdown', (event) => { pointerStart = [event.clientX, event.clientY]; });
    canvas.addEventListener('pointerup', (event) => {
      if (!this.editing || this.gizmo.axis || !pointerStart || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
      const rect = canvas.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(this.markers.children, false)[0];
      if (hit) { this.select(hit.object.userData.joint); onChange(this.selected, false); }
    });
    this.bindIKPointer(canvas, camera, onStart);
  }

  async load(id, bytes) {
    const version = ++this.version;
    if (!bytes) {
      const response = await fetch(CHARACTERS[id].url);
      if (!response.ok) throw new Error(`模型下载失败 (${response.status})`);
      bytes = await response.arrayBuffer();
    }
    validateVrmBytes(bytes, CHARACTERS[id].format !== 'gltf');
    const gltf = await this.loader.parseAsync(bytes, '');
    let vrm;
    try {
      vrm = gltf.userData.vrm ?? (CHARACTERS[id].format === 'gltf' ? createMannequin(gltf.scene) : null);
    } catch (error) {
      VRMUtils.deepDispose(gltf.scene);
      throw error;
    }
    if (!vrm) { VRMUtils.deepDispose(gltf.scene); throw new Error('无法读取 VRM 人偶'); }
    if (version !== this.version) { VRMUtils.deepDispose(vrm.scene); return false; }
    const joints = {};
    for (const [id, bone] of JOINTS) {
      const node = vrm.humanoid.getNormalizedBoneNode(bone);
      if (node) joints[id] = node;
    }
    if (!joints.root || !joints.head || !joints.leftFoot || !joints.rightFoot) { VRMUtils.deepDispose(vrm.scene); throw new Error('人偶缺少必要的骨骼'); }
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const height = box.max.y - box.min.y;
    if (!Number.isFinite(height) || height < 0.01) { VRMUtils.deepDispose(vrm.scene); throw new Error('模型尺寸无效'); }
    vrm.scene.scale.multiplyScalar(3.2 / height);
    const surfaces = new Map();
    for (const material of vrm.materials ?? []) {
      if (!material.isMToonMaterial) continue;
      material.shadingToonyFactor = 0;
      material.giEqualizationFactor = 0;
      material.shadeColorFactor.multiplyScalar(0.65);
      material.outlineWidthFactor = 0;
      if (material.isOutline) material.visible = false;
      material.toneMapped = true;
      material.needsUpdate = true;
    }
    vrm.scene.traverse((object) => {
      if (object.isMesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.every((material) => material.isMToonMaterial && material.isOutline)) {
          object.visible = false;
          object.castShadow = false;
          return;
        }
        const replacements = materials.map((material) => {
          if (!material.isMToonMaterial || material.isOutline) return material;
          if (!surfaces.has(material)) surfaces.set(material, createPortraitMaterial(material, this.maxAnisotropy));
          return surfaces.get(material);
        });
        object.material = Array.isArray(object.material) ? replacements : replacements[0];
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;
      }
    });
    this.gizmo.detach();
    this.finishIKDrag();
    this.ik?.dispose();
    if (this.vrm) {
      this.group.remove(this.vrm.scene);
      for (const material of this.vrm.materials ?? []) {
        for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
        material.dispose();
      }
      VRMUtils.deepDispose(this.vrm.scene);
    }
    this.vrm = vrm;
    this.id = id;
    this.joints = joints;
    this.group.add(vrm.scene);
    const contactBones = new Set();
    for (const name of ['leftLowerLeg', 'rightLowerLeg']) {
      vrm.humanoid.getRawBoneNode(name)?.traverse((bone) => contactBones.add(bone));
    }
    this.groundContacts = [];
    vrm.scene.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.visible) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!materials.some((material) => material.visible && !material.isOutline)) return;
      const indices = [];
      const weights = mesh.geometry.getAttribute('skinWeight');
      const bones = mesh.geometry.getAttribute('skinIndex');
      let attachedToFoot = false;
      for (let parent = mesh; parent; parent = parent.parent) {
        if (contactBones.has(parent)) attachedToFoot = true;
      }
      for (let index = 0; index < mesh.geometry.getAttribute('position').count; index++) {
        let contact = attachedToFoot;
        if (mesh.isSkinnedMesh && weights && bones) {
          for (let component = 0; component < weights.itemSize; component++) {
            if (weights.getComponent(index, component) > 0
              && contactBones.has(mesh.skeleton.bones[bones.getComponent(index, component)])) contact = true;
          }
        }
        if (contact) indices.push(index);
      }
      if (indices.length) this.groundContacts.push({ mesh, indices });
    });
    this.applyAngles(this.poseAngles);
    this.ik = new LimbIK(joints, this.scene);
    for (const marker of [...this.markers.children]) { marker.geometry.dispose(); marker.material.dispose(); this.markers.remove(marker); }
    for (const [id] of JOINTS.slice(0, 21)) {
      if (!joints[id]) continue;
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.047, 12, 8), new THREE.MeshBasicMaterial({ color: '#228e94', depthTest: false, transparent: true, opacity: 0.85 }));
      marker.userData.joint = id;
      marker.renderOrder = 1000;
      this.markers.add(marker);
    }
    this.select(this.selected);
    this.setEditing(this.editing);
    return true;
  }

  applyAngles(angles) {
    this.finishIKDrag();
    this.poseAngles = Object.fromEntries(JOINTS.map(([id]) => [id, [...(angles[id] ?? [0, 0, 0])]]));
    for (const [id, joint] of Object.entries(this.joints)) {
      joint.rotation.set(...this.poseAngles[id]);
    }
  }

  setJoint(id, angles) {
    if (!this.poseAngles[id]) return;
    this.poseAngles[id] = [...angles];
    this.joints[id]?.rotation.set(...angles);
  }

  select(id) {
    this.selected = this.joints[id] ? id : 'head';
    const rotate = this.editMode === 'fk' || !this.ik?.chains.has(this.selected);
    this.gizmo.enabled = this.editing && rotate;
    if (this.editing && rotate && this.joints[this.selected]) this.gizmo.attach(this.joints[this.selected]);
    else this.gizmo.detach();
    this.markers.children.forEach((marker) => {
      marker.visible = true;
      marker.scale.setScalar(this.editMode === 'ik' && this.ik?.chains.has(marker.userData.joint) ? 2 : 1);
      marker.material.color.set(marker.userData.joint === this.selected ? '#e35433' : '#228e94');
    });
  }

  setEditing(value) {
    if (!value) this.finishIKDrag();
    this.editing = value;
    this.markers.visible = value;
    this.gizmo.enabled = value && this.editMode === 'fk';
    this.select(this.selected);
  }

  setEditMode(mode) {
    if (!['fk', 'ik'].includes(mode)) return;
    this.finishIKDrag();
    this.editMode = mode;
    this.setEditing(this.editing);
  }

  isJointSelectable(id) {
    return !!this.joints[id];
  }

  solveIK(id, target) {
    for (const jointId of this.ik?.solve(id, target) ?? []) {
      const joint = this.joints[jointId];
      this.poseAngles[jointId] = [joint.rotation.x, joint.rotation.y, joint.rotation.z].map((value) => Math.atan2(Math.sin(value), Math.cos(value)));
    }
    this.onChange(this.selected);
  }

  bindIKPointer(canvas, camera, onStart) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pointOnPlane = (event, plane) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    };
    canvas.addEventListener('pointerdown', (event) => {
      if (!this.editing || this.editMode !== 'ik' || event.button !== 0 || this.ikDrag) return;
      const rect = canvas.getBoundingClientRect();
      let nearest = event.pointerType === 'touch' ? 26 : 18;
      let selected;
      for (const marker of this.markers.children) {
        if (!marker.visible || !this.ik?.chains.has(marker.userData.joint)) continue;
        const projected = marker.position.clone().project(camera);
        if (projected.z < -1 || projected.z > 1) continue;
        const distance = Math.hypot(rect.left + (projected.x + 1) * rect.width / 2 - event.clientX, rect.top + (1 - projected.y) * rect.height / 2 - event.clientY);
        if (distance < nearest) { nearest = distance; selected = marker; }
      }
      if (!selected) return;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), selected.position);
      const point = pointOnPlane(event, plane);
      if (!point) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onStart();
      this.select(selected.userData.joint);
      this.ikDrag = { pointerId: event.pointerId, plane, offset: selected.position.clone().sub(point), orbitEnabled: this.orbit.enabled, autoRotate: this.orbit.autoRotate };
      this.orbit.enabled = false;
      this.orbit.autoRotate = false;
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = 'grabbing';
      this.onChange(this.selected, false);
    }, true);
    canvas.addEventListener('pointermove', (event) => {
      if (!this.ikDrag || event.pointerId !== this.ikDrag.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = pointOnPlane(event, this.ikDrag.plane);
      if (point) this.solveIK(this.selected, point.add(this.ikDrag.offset));
    }, true);
    const finish = (event) => {
      if (!this.ikDrag || event.pointerId !== this.ikDrag.pointerId) return;
      event.stopImmediatePropagation();
      this.finishIKDrag();
    };
    canvas.addEventListener('pointerup', finish, true);
    canvas.addEventListener('pointercancel', finish, true);
    canvas.addEventListener('lostpointercapture', finish);
  }

  finishIKDrag() {
    if (!this.ikDrag) return;
    const drag = this.ikDrag;
    this.ikDrag = null;
    this.orbit.enabled = drag.orbitEnabled;
    this.orbit.autoRotate = drag.autoRotate;
    this.canvas.style.cursor = '';
    if (this.canvas.hasPointerCapture(drag.pointerId)) this.canvas.releasePointerCapture(drag.pointerId);
  }

  capturePose() {
    return { format: 'studio-pose', version: 1, units: 'radians', rotation: this.group.rotation.y, placement: { grounded: this.grounded, height: this.height }, joints: structuredClone(this.poseAngles) };
  }

  setGrounded(value) {
    this.finishIKDrag();
    if (!value && this.grounded) this.height = this.group.position.y;
    if (value) this.height = 0;
    this.grounded = value;
    this.update(0);
  }

  setHeight(value) {
    if (!Number.isFinite(value)) return;
    this.finishIKDrag();
    this.grounded = false;
    this.height = THREE.MathUtils.clamp(value, -1000, 1000);
    this.update(0);
  }

  getFramingBounds(mode) {
    if (!this.vrm) return null;
    this.update(0);
    const bounds = new THREE.Box3();
    this.vrm.scene.traverse((mesh) => {
      if (!mesh.isMesh || !mesh.visible) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!materials.some((material) => material.visible && !material.isOutline)) return;
      if (mesh.isSkinnedMesh) mesh.computeBoundingBox();
      else if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      bounds.union((mesh.boundingBox ?? mesh.geometry.boundingBox).clone().applyMatrix4(mesh.matrixWorld));
    });
    if (bounds.isEmpty()) return null;
    const height = bounds.max.y - bounds.min.y;
    if (mode === 'half') bounds.min.y = bounds.max.y - height * 0.6;
    if (mode === 'face') {
      const center = this.joints.head.getWorldPosition(new THREE.Vector3());
      center.y += height * 0.065;
      bounds.setFromCenterAndSize(center, new THREE.Vector3(height * 0.3, height * 0.32, height * 0.3));
    }
    return bounds;
  }

  restorePose(pose) {
    if (!validPose(pose)) throw new Error('姿势格式无效');
    this.group.rotation.y = pose.rotation;
    this.applyAngles(pose.joints);
    this.grounded = pose.placement?.grounded ?? true;
    this.height = pose.placement?.height ?? 0;
    this.update(0);
  }

  update(delta) {
    if (!this.vrm) return;
    this.vrm.update(delta);
    if (this.grounded && !this.ikDrag) {
      this.group.position.y = 0;
      this.group.updateMatrixWorld(true);
      const vertex = new THREE.Vector3();
      let soleHeight = Infinity;
      for (const { mesh, indices } of this.groundContacts) {
        for (const index of indices) {
          mesh.getVertexPosition(index, vertex).applyMatrix4(mesh.matrixWorld);
          soleHeight = Math.min(soleHeight, vertex.y);
        }
      }
      if (Number.isFinite(soleHeight)) this.group.position.y = 0.008 - soleHeight;
    } else if (!this.grounded) {
      this.group.position.y = this.height;
    }
    this.group.updateMatrixWorld(true);
    for (const marker of this.markers.children) this.joints[marker.userData.joint].getWorldPosition(marker.position);
  }
}

function createPortraitMaterial(source, anisotropy) {
  const skin = /SKIN/i.test(source.name);
  const hair = /HAIR/i.test(source.name);
  const eye = /EyeIris|EyeWhite|EyeHighlight/i.test(source.name);
  const cloth = /CLOTH/i.test(source.name) && !/Shoes/i.test(source.name);
  const material = new THREE.MeshPhysicalMaterial({
    name: source.name,
    color: source.color.clone(),
    map: source.map,
    normalMap: source.normalMap,
    normalScale: source.normalScale.clone(),
    emissive: source.emissive.clone(),
    emissiveMap: source.emissiveMap,
    emissiveIntensity: Math.min(source.emissiveIntensity, 0.15),
    alphaMap: source.alphaMap ?? null,
    alphaTest: source.alphaTest,
    opacity: source.opacity,
    transparent: source.transparent,
    side: source.side,
    depthWrite: source.depthWrite,
    metalness: 0,
    roughness: eye ? 0.22 : skin ? 0.56 : hair ? 0.46 : cloth ? 0.88 : 0.65,
    specularIntensity: skin ? 0.35 : cloth ? 0.2 : 0.5,
    clearcoat: eye ? 0.8 : hair ? 0.2 : 0,
    clearcoatRoughness: eye ? 0.16 : 0.38,
    sheen: cloth ? 0.25 : 0,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color('#b8b8b8'),
  });
  for (const value of Object.values(material)) {
    if (!value?.isTexture) continue;
    value.anisotropy = anisotropy;
    value.needsUpdate = true;
  }
  return material;
}