import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { MToonMaterial, VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import type { VRMHumanBoneName } from '@pixiv/three-vrm';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { JointPose, Vector3Tuple } from './scene-types';
import { isRecord } from './schema-utils';
import { LimbIK } from './pose-ik';
import { createMannequin } from './mannequin';
import { JOINTS, validPose } from './pose-schema';
export { JOINTS, validPose } from './pose-schema';

export const CHARACTERS: Record<string, { name: string; url: string; credit: string; format?: string; creator?: boolean }> = {
  humanFemale: { name: '女性人体', url: './assets/characters/human/female.glb', format: 'gltf', creator: true, credit: 'MakeHuman Community · CC0 · 女性人体' },
  humanMale: { name: '男性人体', url: './assets/characters/human/male.glb', format: 'gltf', creator: true, credit: 'MakeHuman Community · CC0 · 男性人体' },
  pixiv: { name: '凛 · 人形模特', url: './assets/characters/pixiv.vrm', credit: 'pixiv Inc. · VRM Public License 1.0' },
  seed: { name: 'Seed · 风格模特', url: './assets/characters/seed.vrm', credit: 'Seed-san by VirtualCast, Inc. · VRM Public License 1.0' },
  mannequin: { name: '男性白模 · 健硕人形', url: './assets/characters/mannequin.glb', format: 'gltf', credit: 'Quaternius · Universal Base Characters · CC0' },
  mannequinFemale: { name: '女性白模 · 基础人形', url: './assets/characters/mannequin-female.glb', format: 'gltf', credit: 'Quaternius · Universal Base Characters · CC0' },
  quaternius: { name: '动画原模 · Quaternius', url: './assets/characters/quaternius-original.glb', format: 'gltf', credit: 'Quaternius · Universal Animation Library Standard · CC0' },
  vroidA: { name: 'VRoid A · 时装模特', url: './assets/characters/vroid-a.vrm', credit: 'VRoid / pixiv Inc. · VRoid 示例模型使用条件（非 CC0）' },
  vroidB: { name: 'VRoid B · 潮流模特', url: './assets/characters/vroid-b.vrm', credit: 'VRoid / pixiv Inc. · VRoid 示例模型使用条件（非 CC0）' },
  vroidC: { name: 'VRoid C · 造型模特', url: './assets/characters/vroid-c.vrm', credit: 'VRoid / pixiv Inc. · VRoid 示例模型使用条件（非 CC0）' },
};

export function validateVrmBytes(bytes: unknown, requireVrm = true) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 20 || bytes.byteLength > 40 * 1024 * 1024) throw new Error('模型必须小于 40 MB');
  const header = new DataView(bytes);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(12, true) > bytes.byteLength - 20 || header.getUint32(16, true) !== 0x4e4f534a) throw new Error('不是有效的 VRM/GLB 文件');
  const json: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, header.getUint32(12, true))));
  if (!isRecord(json)) throw new Error('不是有效的 VRM/GLB 文件');
  const extensions = isRecord(json.extensions) ? json.extensions : {};
  if (requireVrm && !extensions.VRMC_vrm && !extensions.VRM) throw new Error('该文件不包含 VRM 人形骨骼');
  for (const resources of [json.buffers ?? [], json.images ?? []]) {
    if (!Array.isArray(resources)) throw new Error('不是有效的 VRM/GLB 文件');
    for (const resource of resources) {
      if (!isRecord(resource) || (resource.uri && (typeof resource.uri !== 'string' || !resource.uri.startsWith('data:')))) throw new Error('请选择素材内嵌的独立 VRM 文件');
    }
  }
  return json;
}

export class Character {
  scene: THREE.Scene;
  group: THREE.Group;
  joints: Record<string, THREE.Object3D>;
  poseAngles: Record<string, Vector3Tuple>;
  id: string;
  version: number;
  editing: boolean;
  editMode: 'fk' | 'ik';
  grounded: boolean;
  height: number;
  ikDrag: { pointerId: number; plane: THREE.Plane; offset: THREE.Vector3; orbitEnabled: boolean; autoRotate: boolean } | null;
  canvas: HTMLCanvasElement;
  orbit: Pick<OrbitControls, 'enabled' | 'autoRotate'>;
  selected: string;
  onChange: (id: string, modified?: boolean) => void;
  maxAnisotropy: number;
  loader: GLTFLoader;
  gizmo: TransformControls;
  helper: THREE.Object3D;
  markers: THREE.Group;
  vrm: VRM | null = null;
  ik: LimbIK | null = null;
  groundContacts: { mesh: THREE.Mesh; indices: number[] }[] = [];
  private readonly lifetime = new AbortController();

  constructor(scene: THREE.Scene, camera: THREE.Camera, canvas: HTMLCanvasElement, orbit: Pick<OrbitControls, 'enabled' | 'autoRotate'>, onChange: (id: string, modified?: boolean) => void, onStart: () => void, maxAnisotropy = 1) {
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
      const angles = normalizeAngles(joint.rotation);
      this.setJoint(this.selected, angles);
      onChange(this.selected);
    });
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerStart: [number, number] | undefined;
    canvas.addEventListener('pointerdown', (event) => { pointerStart = [event.clientX, event.clientY]; }, { signal: this.lifetime.signal });
    canvas.addEventListener('pointerup', (event) => {
      if (!this.editing || this.gizmo.axis || !pointerStart || Math.hypot(event.clientX - pointerStart[0], event.clientY - pointerStart[1]) > 5) return;
      const rect = canvas.getBoundingClientRect();
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(this.markers.children, false)[0];
      if (hit) { this.select(hit.object.userData.joint); onChange(this.selected, false); }
    }, { signal: this.lifetime.signal });
    this.bindIKPointer(canvas, camera, onStart);
  }

  async load(id: string, bytes?: ArrayBuffer) {
    this.lifetime.signal.throwIfAborted();
    const definition = Object.hasOwn(CHARACTERS, id) ? CHARACTERS[id] : undefined;
    if (!definition && !bytes) throw new Error('找不到自定义人偶文件');
    const version = ++this.version;
    if (!bytes) {
      const response = await fetch(definition!.url, { signal: this.lifetime.signal });
      if (!response.ok) throw new Error(`模型下载失败 (${response.status})`);
      bytes = await response.arrayBuffer();
    }
    validateVrmBytes(bytes, definition?.format !== 'gltf');
    const gltf = await this.loader.parseAsync(bytes, '');
    let vrm: VRM | null | undefined;
    try {
      if (definition?.creator) {
        const materials = new Set<THREE.MeshStandardMaterial>();
        gltf.scene.traverse(object => {
          if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (material instanceof THREE.MeshStandardMaterial && typeof material.userData.creatorTexture === 'string') materials.add(material);
          }
        });
        for (const material of materials) {
          const path = material.userData.creatorTexture as string;
          if (!path.startsWith('system/') || path.includes('..') || path.includes(':')) throw new Error('人物贴图路径无效');
          const texture = await new THREE.TextureLoader().loadAsync(`./assets/characters/human/${path}`);
          material.map = texture;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = this.maxAnisotropy;
          material.needsUpdate = true;
          this.lifetime.signal.throwIfAborted();
        }
      }
      vrm = gltf.userData.vrm ?? (definition?.format === 'gltf' ? createMannequin(gltf.scene) : null);
    } catch (error) {
      VRMUtils.deepDispose(gltf.scene);
      throw error;
    }
    if (!vrm) { VRMUtils.deepDispose(gltf.scene); throw new Error('无法读取 VRM 人偶'); }
    if (version !== this.version) { VRMUtils.deepDispose(vrm.scene); return false; }
    const joints: Record<string, THREE.Object3D> = {};
    for (const [id, bone] of JOINTS) {
      const node = vrm.humanoid.getNormalizedBoneNode(bone as VRMHumanBoneName);
      if (node) joints[id] = node;
    }
    if (!joints.root || !joints.head || !joints.leftFoot || !joints.rightFoot) { VRMUtils.deepDispose(vrm.scene); throw new Error('人偶缺少必要的骨骼'); }
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const height = box.max.y - box.min.y;
    if (!Number.isFinite(height) || height < 0.01) { VRMUtils.deepDispose(vrm.scene); throw new Error('模型尺寸无效'); }
    vrm.scene.scale.multiplyScalar(3.2 / height);
    const surfaces = new Map<MToonMaterial, THREE.MeshPhysicalMaterial>();
    for (const material of vrm.materials ?? []) {
      if (!(material instanceof MToonMaterial)) continue;
      material.shadingToonyFactor = 0;
      material.giEqualizationFactor = 0;
      material.shadeColorFactor.multiplyScalar(0.65);
      material.outlineWidthFactor = 0;
      if (material.isOutline) material.visible = false;
      material.toneMapped = true;
      material.needsUpdate = true;
    }
    vrm.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.every((material: THREE.Material) => material instanceof MToonMaterial && material.isOutline)) {
          object.visible = false;
          object.castShadow = false;
          return;
        }
        const replacements = materials.map((material: THREE.Material) => {
          if (!(material instanceof MToonMaterial) || material.isOutline) return material;
          if (!surfaces.has(material)) surfaces.set(material, createPortraitMaterial(material, this.maxAnisotropy));
          return surfaces.get(material)!;
        });
        object.material = Array.isArray(object.material) ? replacements : replacements[0];
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;
      }
    });
    this.releaseModel();
    this.vrm = vrm;
    this.id = id;
    this.joints = joints;
    this.group.add(vrm.scene);
    const contactBones = new Set<THREE.Object3D>();
    for (const name of ['leftLowerLeg', 'rightLowerLeg'] as const) {
      vrm.humanoid.getRawBoneNode(name)?.traverse((bone) => contactBones.add(bone));
    }
    this.groundContacts = [];
    vrm.scene.traverse((mesh) => {
      if (!(mesh instanceof THREE.Mesh) || !mesh.visible) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!materials.some((material: THREE.Material) => material.visible && !(material instanceof MToonMaterial && material.isOutline))) return;
      const indices: number[] = [];
      const weights = mesh.geometry.getAttribute('skinWeight');
      const bones = mesh.geometry.getAttribute('skinIndex');
      let attachedToFoot = false;
      for (let parent: THREE.Object3D | null = mesh; parent; parent = parent.parent) {
        if (contactBones.has(parent)) attachedToFoot = true;
      }
      for (let index = 0; index < mesh.geometry.getAttribute('position').count; index++) {
        let contact = attachedToFoot;
        if (mesh instanceof THREE.SkinnedMesh && weights && bones) {
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
    for (const marker of this.jointMarkers) { marker.geometry.dispose(); marker.material.dispose(); this.markers.remove(marker); }
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

  get jointMarkers() {
    return this.markers.children.filter((marker): marker is THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> => marker instanceof THREE.Mesh && marker.material instanceof THREE.MeshBasicMaterial);
  }

  private releaseModel() {
    this.gizmo.detach();
    this.finishIKDrag();
    this.ik?.dispose();
    this.ik = null;
    if (this.vrm) {
      this.group.remove(this.vrm.scene);
      for (const material of this.vrm.materials ?? []) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
      VRMUtils.deepDispose(this.vrm.scene);
    }
    this.vrm = null;
    this.groundContacts = [];
  }

  dispose() {
    if (this.lifetime.signal.aborted) return;
    this.version++;
    this.lifetime.abort();
    this.releaseModel();
    this.gizmo.dispose();
    for (const marker of this.jointMarkers) { marker.geometry.dispose(); marker.material.dispose(); }
    this.markers.clear();
    this.joints = {};
    this.scene.remove(this.group, this.helper, this.markers);
  }

  applyAngles(angles: Record<string, Vector3Tuple>) {
    this.finishIKDrag();
    this.poseAngles = Object.fromEntries(JOINTS.map(([id]) => [id, [...(angles[id] ?? [0, 0, 0])]]));
    for (const [id, joint] of Object.entries(this.joints)) {
      joint.rotation.set(...this.poseAngles[id]);
    }
  }

  setJoint(id: string, angles: Vector3Tuple) {
    if (!this.poseAngles[id]) return;
    this.poseAngles[id] = [...angles];
    this.joints[id]?.rotation.set(...angles);
  }

  select(id: string) {
    this.selected = this.joints[id] ? id : 'head';
    const rotate = this.editMode === 'fk' || !this.ik?.chains.has(this.selected);
    this.gizmo.enabled = this.editing && rotate;
    if (this.editing && rotate && this.joints[this.selected]) this.gizmo.attach(this.joints[this.selected]);
    else this.gizmo.detach();
    this.jointMarkers.forEach((marker) => {
      marker.visible = true;
      marker.scale.setScalar(this.editMode === 'ik' && this.ik?.chains.has(marker.userData.joint) ? 2 : 1);
      marker.material.color.set(marker.userData.joint === this.selected ? '#e35433' : '#228e94');
    });
  }

  setEditing(value: boolean) {
    if (!value) this.finishIKDrag();
    this.editing = value;
    this.markers.visible = value;
    this.gizmo.enabled = value && this.editMode === 'fk';
    this.select(this.selected);
  }

  setEditMode(mode: string) {
    if (mode !== 'fk' && mode !== 'ik') return;
    this.finishIKDrag();
    this.editMode = mode;
    this.setEditing(this.editing);
  }

  isJointSelectable(id: string) {
    return !!this.joints[id];
  }

  solveIK(id: string, target: THREE.Vector3) {
    for (const jointId of this.ik?.solve(id, target) ?? []) {
      const joint = this.joints[jointId];
      this.poseAngles[jointId] = normalizeAngles(joint.rotation);
    }
    this.onChange(this.selected);
  }

  bindIKPointer(canvas: HTMLCanvasElement, camera: THREE.Camera, onStart: () => void) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pointOnPlane = (event: PointerEvent, plane: THREE.Plane) => {
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
    }, { capture: true, signal: this.lifetime.signal });
    canvas.addEventListener('pointermove', (event) => {
      if (!this.ikDrag || event.pointerId !== this.ikDrag.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = pointOnPlane(event, this.ikDrag.plane);
      if (point) this.solveIK(this.selected, point.add(this.ikDrag.offset));
    }, { capture: true, signal: this.lifetime.signal });
    const finish = (event: PointerEvent) => {
      if (!this.ikDrag || event.pointerId !== this.ikDrag.pointerId) return;
      event.stopImmediatePropagation();
      this.finishIKDrag();
    };
    canvas.addEventListener('pointerup', finish, { capture: true, signal: this.lifetime.signal });
    canvas.addEventListener('pointercancel', finish, { capture: true, signal: this.lifetime.signal });
    canvas.addEventListener('lostpointercapture', finish, { signal: this.lifetime.signal });
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

  capturePose(): JointPose {
    return { format: 'studio-pose', version: 1, units: 'radians', rotation: this.group.rotation.y, placement: { grounded: this.grounded, height: this.height }, joints: structuredClone(this.poseAngles) };
  }

  setGrounded(value: boolean) {
    this.finishIKDrag();
    if (!value && this.grounded) this.height = this.group.position.y;
    if (value) this.height = 0;
    this.grounded = value;
    this.update(0);
  }

  setHeight(value: number) {
    if (!Number.isFinite(value)) return;
    this.finishIKDrag();
    this.grounded = false;
    this.height = THREE.MathUtils.clamp(value, -1000, 1000);
    this.update(0);
  }

  getFramingBounds(mode: string) {
    if (!this.vrm) return null;
    this.update(0);
    const bounds = new THREE.Box3();
    this.vrm.scene.traverse((mesh) => {
      if (!(mesh instanceof THREE.Mesh) || !mesh.visible) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (!materials.some((material: THREE.Material) => material.visible && !(material instanceof MToonMaterial && material.isOutline))) return;
      if (mesh instanceof THREE.SkinnedMesh) mesh.computeBoundingBox();
      else if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const box = mesh instanceof THREE.SkinnedMesh ? mesh.boundingBox : mesh.geometry.boundingBox;
      if (box) bounds.union(box.clone().applyMatrix4(mesh.matrixWorld));
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

  restorePose(pose: unknown) {
    if (!validPose(pose)) throw new Error('姿势格式无效');
    this.group.rotation.y = pose.rotation;
    this.applyAngles(pose.joints);
    this.grounded = pose.placement?.grounded ?? true;
    this.height = pose.placement?.height ?? 0;
    this.update(0);
  }

  update(delta: number) {
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

function normalizeAngles(rotation: THREE.Euler): Vector3Tuple {
  const normalize = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));
  return [normalize(rotation.x), normalize(rotation.y), normalize(rotation.z)];
}

function createPortraitMaterial(source: MToonMaterial, anisotropy: number) {
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
    alphaMap: 'alphaMap' in source && source.alphaMap instanceof THREE.Texture ? source.alphaMap : null,
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
    if (!(value instanceof THREE.Texture)) continue;
    value.anisotropy = anisotropy;
    value.needsUpdate = true;
  }
  return material;
}