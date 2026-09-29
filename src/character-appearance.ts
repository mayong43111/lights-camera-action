import * as THREE from 'three';
import { parsePartCatalog, validatePartSelection, type PartSelection } from './character-parts';
import creatorShapes from './creator-shapes.json';

export interface CharacterAppearance {
  height: number;
  width: number;
  colors: Record<string, string>;
  morphs: Record<string, number>;
  parts?: PartSelection;
}

export interface CharacterCreation {
  saving: boolean;
  kind?: 'human' | 'model';
  error?: string;
  appearance: CharacterAppearance;
  colors: { id: string; name: string; value: string; group?: 'body' | 'face' | 'style' }[];
  morphs: { id: string; name: string; value: number; key?: string; group?: 'body' | 'face' }[];
  meshes: string[];
}

export function createAppearanceEditor(root: THREE.Object3D) {
  const scale = root.scale.clone();
  const creator = root.userData.creator === true;
  const labels: Record<string, string> = {
    Skin: '肤色', Hair: '发色', Eyes: '眼睛', Outfit: '服装', Shoes: '鞋子', Eyebrows: '眉毛',
    FaceRound: '圆润脸型', FaceSquare: '方正脸型', NoseWidth: '鼻翼宽度', NoseDepth: '鼻梁高度',
    MouthWidth: '嘴形宽度', EyeSize: '眼睛大小', BodyWeight: '体脂增加', BodySlim: '体型纤细',
  };
  const colors: CharacterCreation['colors'] = [];
  const morphs: CharacterCreation['morphs'] = [];
  const materials = new Map<string, THREE.Color[]>();
  const colorIds = new Map<string, string>();
  const seen = new Set<THREE.Material>();
  const influences = new Map<string, { values: number[]; index: number }[]>();
  const linkedMorphs = new Map<string, string>();
  const meshObjects: THREE.Mesh[] = [];
  const visibility = new Map<THREE.Mesh, boolean>();
  let meshIndex = 0;
  let appearance: CharacterAppearance = { height: 1, width: 1, colors: {}, morphs: {} };
  root.traverse(object => {
    if (creator && object.userData.creatorParts) appearance.parts = structuredClone(object.userData.creatorParts as PartSelection);
    if (!(object instanceof THREE.Mesh)) return;
    meshObjects.push(object);
    visibility.set(object, object.visible);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (seen.has(material) || !material.visible || !('color' in material) || !(material.color instanceof THREE.Color)) continue;
      seen.add(material);
      const role = creator ? material.name.replace(/^(Hair|Outfit).*$/, '$1') : material.name;
      const id = (creator && colorIds.get(role)) || String(colors.length);
      const targets = materials.get(id) ?? [];
      targets.push(material.color);
      materials.set(id, targets);
      const modelName = /eyebrow/i.test(object.name) ? '眉毛' : /eye/i.test(object.name) ? '眼睛' : /body|superhero/i.test(object.name) ? '身体' : material.name;
      if (targets.length === 1) colors.push({ id,
        name: (creator && labels[role]) || (modelName === 'Porcelain' ? `表面 ${colors.length + 1}` : modelName) || `表面 ${colors.length + 1}`,
        value: `#${material.color.getHexString()}`,
        group: creator ? role === 'Skin' ? 'body' : ['Eyes', 'Eyebrows'].includes(role) ? 'face' : 'style' : 'body',
      });
      if (creator) colorIds.set(role, id);
    }
    if (object.morphTargetDictionary && object.morphTargetInfluences) {
      for (const [name, index] of Object.entries(object.morphTargetDictionary)) {
        const id = (creator && linkedMorphs.get(name)) || `${meshIndex}:${index}`;
        const targets = influences.get(id) ?? [];
        targets.push({ values: object.morphTargetInfluences, index });
        influences.set(id, targets);
        const definition = creatorShapes.find(shape => shape.key === name || `${shape.key}Negative` === name);
        if (targets.length === 1) morphs.push({ id, key: name, name: (creator && (labels[name] || definition?.label)) || name,
          value: object.morphTargetInfluences[index], group: creator && name.startsWith('Body') ? 'body' : 'face' });
        if (creator) linkedMorphs.set(name, id);
      }
    }
    meshIndex++;
  });
  function update() {
    for (const [id, value] of Object.entries(appearance.morphs)) {
      for (const target of influences.get(id) ?? []) target.values[target.index] = value;
    }
  }
  function apply(next: CharacterAppearance) {
    const controlled = new Map<THREE.Mesh, boolean>();
    if (next.parts) {
      const catalog = parsePartCatalog(next.parts.catalog);
      validatePartSelection({ catalog, selected: next.parts.selected });
      for (const group of catalog.groups) for (const option of group.options) for (const name of option.meshes) {
        const matches = meshObjects.filter(mesh => mesh.name === name);
        if (matches.length !== 1) throw new Error(`部件网格不存在或重名：${name}`);
        controlled.set(matches[0], next.parts.selected[group.id] === option.id);
      }
      for (const mesh of controlled.keys()) {
        for (let parent = mesh.parent; parent; parent = parent.parent) {
          if (parent instanceof THREE.Mesh && controlled.has(parent)) throw new Error('部件网格不能互相嵌套');
        }
      }
    }
    appearance = structuredClone(next);
    for (const mesh of meshObjects) mesh.visible = controlled.get(mesh) ?? visibility.get(mesh)!;
    root.scale.copy(scale).multiply(new THREE.Vector3(next.width, next.height, next.width));
    for (const color of colors) for (const target of materials.get(color.id)!) target.set(next.colors[color.id] ?? color.value);
    for (const morph of morphs) {
      for (const target of influences.get(morph.id)!) target.values[target.index] = next.morphs[morph.id] ?? morph.value;
    }
    update();
    root.updateMatrixWorld(true);
  }
  if (appearance.parts) apply(appearance);
  return { kind: creator ? 'human' as const : 'model' as const, colors, morphs, meshes: meshObjects.map(mesh => mesh.name).filter(Boolean), apply, update, capture: () => structuredClone(appearance) };
}