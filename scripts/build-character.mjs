import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { posix } from 'node:path';
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import creatorShapes from '../src/creator-shapes.json' with { type: 'json' };

const directory = fileURLToPath(new URL('../assets/characters/human/', import.meta.url));
const text = filename => readFile(`${directory}/${filename}`, 'utf8');
const rig = JSON.parse(await text('rig.json'));
const weights = JSON.parse(await text('weights.json'));
if (rig.license !== 'CC0' || weights.license !== 'CC0') throw new Error('Expected CC0 rig data');
const objText = await text('base.obj');
const sourceVertices = objText.split('\n').filter(line => line.startsWith('v ')).map(line => line.trim().split(/\s+/).slice(1).map(Number));
const key = position => position.map(Math.fround).join(',');
const vertexIds = new Map(sourceVertices.map((position, index) => [key(position), index]));
const body = new OBJLoader().parse(objText).getObjectByName('body');
if (!(body instanceof THREE.Mesh)) throw new Error('Missing body mesh');
body.geometry.deleteAttribute('normal');
const baseGeometry = mergeVertices(body.geometry);
const basePosition = baseGeometry.getAttribute('position');
const sourceIds = Array.from({ length: basePosition.count }, (_, index) => {
  const identifier = vertexIds.get(key([basePosition.getX(index), basePosition.getY(index), basePosition.getZ(index)]));
  if (identifier === undefined) throw new Error(`Unmapped body vertex ${index}`);
  return identifier;
});
async function target(filename) {
  const values = new Map();
  for (const line of (await text(`targets/${filename}.target`)).split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [index, ...delta] = line.trim().split(/\s+/).map(Number);
    if (delta.length !== 3 || ![index, ...delta].every(Number.isFinite)) throw new Error(`Invalid target ${filename}`);
    values.set(index, delta);
  }
  return values;
}
const shapes = [
  ['FaceRound', ['head_head-round']], ['FaceSquare', ['head_head-square']],
  ['NoseWidth', ['nose_nose-scale-horiz-incr']], ['NoseDepth', ['nose_nose-scale-depth-incr']],
  ['MouthWidth', ['mouth_mouth-scale-horiz-incr']], ['EyeSize', ['eyes_l-eye-scale-incr', 'eyes_r-eye-scale-incr']],
];
const shapeTargets = await Promise.all(shapes.map(async ([name, paths]) => {
  const combined = new Map();
  for (const path of paths) for (const [identifier, delta] of await target(path)) {
    const previous = combined.get(identifier) ?? [0, 0, 0];
    combined.set(identifier, delta.map((value, axis) => value + previous[axis]));
  }
  return { name, values: combined };
}));
const extendedTargets = await Promise.all(creatorShapes.flatMap(shape => [
  ...(!shape.existing ? [{ name: shape.key, paths: shape.positive }] : []),
  { name: `${shape.key}Negative`, paths: shape.negative },
]).map(async ({ name, paths }) => {
  const values = new Map();
  for (const path of paths) for (const [identifier, delta] of await target(path.replaceAll('/', '_'))) {
    const previous = values.get(identifier) ?? [0, 0, 0];
    values.set(identifier, delta.map((value, axis) => value + previous[axis]));
  }
  return { name, values };
}));
const boneNames = Object.keys(rig.bones);
const vertexWeights = sourceVertices.map(() => []);
for (const [name, entries] of Object.entries(weights.weights)) {
  const boneIndex = boneNames.indexOf(name);
  if (boneIndex < 0) throw new Error(`Unknown bone ${name}`);
  for (const [identifier, weight] of entries) if (weight > 0) vertexWeights[identifier].push([boneIndex, weight]);
}
const humanoid = {
  hips: 'root', spine: 'spine05', chest: 'spine03', upperChest: 'spine01', neck: 'neck01', head: 'head',
  leftEye: 'eye.L', rightEye: 'eye.R', jaw: 'jaw',
};
for (const [side, suffix] of [['left', 'L'], ['right', 'R']]) {
  for (const [joint, name] of Object.entries({ Shoulder: 'clavicle', UpperArm: 'upperarm01', LowerArm: 'lowerarm01', Hand: 'wrist', UpperLeg: 'upperleg01', LowerLeg: 'lowerleg01', Foot: 'foot', Toes: 'toe1-1' })) humanoid[`${side}${joint}`] = `${name}.${suffix}`;
  for (const [fingerIndex, finger] of ['Thumb', 'Index', 'Middle', 'Ring', 'Little'].entries()) {
    const segments = finger === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
    segments.forEach((segment, index) => { humanoid[`${side}${finger}${segment}`] = `finger${fingerIndex + 1}-${index + 1}.${suffix}`; });
  }
}
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }); }
};
function bindWeights(geometry, entriesByVertex) {
  const indices = [], values = [];
  for (const weights of entriesByVertex) {
    const entries = [...weights].filter(([, value]) => value > 0).sort((first, second) => second[1] - first[1]).slice(0, 4);
    const total = entries.reduce((sum, entry) => sum + entry[1], 0);
    if (!(total > 0)) throw new Error('Unweighted wearable vertex');
    for (let slot = 0; slot < 4; slot++) { indices.push(entries[slot]?.[0] ?? 0); values.push((entries[slot]?.[1] ?? 0) / total); }
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(values, 4));
}
async function wearable(path, bodyVertices, targets, skeleton, materialName) {
  const folder = `system/${path}`;
  const name = posix.basename(path);
  const lines = (await text(`${folder}/${name}.mhclo`)).split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const header = new Map(lines.filter(line => /^[a-z_]+\s/i.test(line)).map(line => {
    const [keyword, ...values] = line.split(/\s+/); return [keyword, values];
  }));
  const mappings = [], removed = new Set();
  let section = '';
  for (const line of lines) {
    if (line.startsWith('verts ')) { section = 'verts'; continue; }
    if (line === 'delete_verts') { section = 'delete'; continue; }
    if (/^[a-z]/i.test(line)) continue;
    if (section === 'verts') {
      const values = line.split(/\s+/).map(Number);
      if (values.length === 1) mappings.push({ refs: [values[0]], weights: [1], offset: [0, 0, 0] });
      else if (values.length === 9) mappings.push({ refs: values.slice(0, 3), weights: values.slice(3, 6), offset: values.slice(6) });
      else throw new Error(`Invalid proxy mapping: ${path}`);
    } else if (section === 'delete') {
      for (const match of line.matchAll(/(\d+)(?:\s*-\s*(\d+))?/g)) {
        for (let index = Number(match[1]); index <= Number(match[2] ?? match[1]); index++) removed.add(index);
      }
    }
  }
  const fit = vertices => {
    const scale = ['x', 'y', 'z'].map((axis, index) => {
      const values = header.get(`${axis}_scale`)?.map(Number);
      return values ? Math.abs(vertices[values[0]][index] - vertices[values[1]][index]) / values[2] : 1;
    });
    return mappings.map(mapping => mapping.offset.map((offset, axis) => offset * scale[axis]
      + mapping.refs.reduce((sum, identifier, index) => sum + vertices[identifier][axis] * mapping.weights[index], 0)));
  };
  const proxyText = await text(`${folder}/${header.get('obj_file')[0]}`);
  const original = proxyText.split('\n').filter(line => line.startsWith('v ')).map(line => line.trim().split(/\s+/).slice(1).map(Number));
  if (original.length !== mappings.length) throw new Error(`Proxy vertex count mismatch: ${path}`);
  const lookup = new Map(original.map((position, index) => [key(position), index]));
  const geometries = [];
  new OBJLoader().parse(proxyText).traverse(object => {
    if (object instanceof THREE.Mesh) { object.geometry.deleteAttribute('normal'); geometries.push(object.geometry); }
  });
  const geometry = mergeVertices(mergeGeometries(geometries));
  const attribute = geometry.getAttribute('position');
  const identifiers = Array.from({ length: attribute.count }, (_, index) => {
    const identifier = lookup.get(key([attribute.getX(index), attribute.getY(index), attribute.getZ(index)]));
    if (identifier === undefined) throw new Error(`Unmapped proxy vertex: ${path}`);
    return identifier;
  });
  const fitted = fit(bodyVertices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(identifiers.flatMap(identifier => fitted[identifier]), 3));
  geometry.computeVertexNormals();
  bindWeights(geometry, identifiers.map(identifier => {
    const mapping = mappings[identifier], combined = new Map();
    mapping.refs.forEach((ref, slot) => {
      for (const [bone, weight] of vertexWeights[ref]) combined.set(bone, (combined.get(bone) ?? 0) + weight * mapping.weights[slot]);
    });
    return combined;
  }));
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = targets.map(target => {
    const changed = fit(bodyVertices.map((position, index) => position.map((value, axis) => value + (target.values.get(index)?.[axis] ?? 0))));
    const attribute = new THREE.Float32BufferAttribute(identifiers.flatMap(identifier => changed[identifier].map((value, axis) => value - fitted[identifier][axis])), 3);
    attribute.name = target.name;
    return attribute;
  });
  const materialPath = posix.join(folder, header.get('material')[0]);
  const materialText = await text(materialPath);
  const texture = materialText.match(/^diffuseTexture\s+(.+)$/m)?.[1].trim();
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: materialName === 'Eyes' ? 0.25 : 0.85, side: THREE.DoubleSide });
  material.name = materialName;
  if (texture) material.userData.creatorTexture = posix.join(posix.dirname(materialPath), texture);
  if (materialText.includes('transparent True')) material.alphaTest = 0.4;
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = name;
  mesh.bind(skeleton, new THREE.Matrix4());
  return { mesh, removed };
}
for (const gender of ['female', 'male']) {
  const basis = await target(`macrodetails_asian-${gender}-young`);
  const vertices = sourceVertices.map((position, index) => position.map((value, axis) => value + (basis.get(index)?.[axis] ?? 0)));
  const activeTargets = [...shapeTargets,
    { name: 'BodyWeight', values: await target(`macrodetails_universal-${gender}-young-averagemuscle-maxweight`) },
    { name: 'BodySlim', values: await target(`macrodetails_universal-${gender}-young-averagemuscle-minweight`) },
    ...extendedTargets,
  ];
  const geometry = baseGeometry.clone();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(sourceIds.flatMap(identifier => vertices[identifier]), 3));
  geometry.computeVertexNormals();
  const skinIndices = [], skinWeights = [];
  for (const identifier of sourceIds) {
    const entries = vertexWeights[identifier].sort((first, second) => second[1] - first[1]).slice(0, 4);
    const total = entries.reduce((sum, entry) => sum + entry[1], 0);
    if (total <= 0) throw new Error(`Unweighted body vertex ${identifier}`);
    for (let slot = 0; slot < 4; slot++) {
      skinIndices.push(entries[slot]?.[0] ?? 0);
      skinWeights.push((entries[slot]?.[1] ?? 0) / total);
    }
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = activeTargets.map(shape => {
    const attribute = new THREE.Float32BufferAttribute(sourceIds.flatMap(identifier => shape.values.get(identifier) ?? [0, 0, 0]), 3);
    attribute.name = shape.name;
    return attribute;
  });
  const scene = new THREE.Group();
  scene.name = `Human_${gender}`;
  scene.userData.humanoid = Object.fromEntries(Object.entries(humanoid).map(([joint, name]) => [joint, THREE.PropertyBinding.sanitizeNodeName(name)]));
  scene.userData.creator = true;
  const bones = new Map(boneNames.map(name => { const bone = new THREE.Bone(); bone.name = THREE.PropertyBinding.sanitizeNodeName(name); return [name, bone]; }));
  const centers = new Map(boneNames.map(name => {
    const anchors = rig.joints[rig.bones[name].head];
    if (!anchors?.length) throw new Error(`Missing bone anchors ${name}`);
    return [name, anchors.reduce((position, index) => position.add(new THREE.Vector3(...vertices[index])), new THREE.Vector3()).divideScalar(anchors.length)];
  }));
  for (const [name, bone] of bones) {
    const parentName = rig.bones[name].parent;
    bone.position.copy(centers.get(name));
    if (parentName) { bone.position.sub(centers.get(parentName)); bones.get(parentName).add(bone); }
    else scene.add(bone);
  }
  const material = new THREE.MeshStandardMaterial({ color: '#cfa58e', roughness: 0.82 });
  material.name = 'Skin';
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = 'HumanBody';
  scene.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton([...bones.values()]);
  mesh.bind(skeleton);
  const shoes = await wearable('clothes/shoes01', vertices, activeTargets, skeleton, 'Shoes');
  scene.add(shoes.mesh);
  const outfits = [];
  for (const suffix of ['01', '02']) {
    const outfit = await wearable(`clothes/${gender}_casualsuit${suffix}`, vertices, activeTargets, skeleton, `Outfit${suffix}`);
    const visibleBody = geometry.clone();
    const indices = [];
    const removed = new Set([...outfit.removed, ...shoes.removed]);
    for (let index = 0; index < geometry.index.count; index += 3) {
      const triangle = [0, 1, 2].map(offset => geometry.index.getX(index + offset));
      if (!triangle.every(vertex => removed.has(sourceIds[vertex]))) indices.push(...triangle);
    }
    visibleBody.setIndex(indices);
    const bodyMesh = new THREE.SkinnedMesh(visibleBody, material);
    bodyMesh.name = `Body${suffix}`;
    bodyMesh.bind(skeleton, new THREE.Matrix4());
    scene.add(bodyMesh, outfit.mesh);
    outfits.push({ id: `outfit${suffix}`, name: suffix === '01' ? '日常装' : '休闲装', meshes: [bodyMesh.name, outfit.mesh.name], excludes: [] });
  }
  const hairOptions = [];
  for (const [name, label] of [['short01', '短发'], ['bob01', '波波头'], ['long01', '长发']]) {
    const hair = await wearable(`hair/${name}`, vertices, activeTargets, skeleton, `Hair${name}`);
    scene.add(hair.mesh);
    hairOptions.push({ id: name, name: label, meshes: [hair.mesh.name], excludes: [] });
  }
  for (const [path, name] of [['eyes/high-poly', 'Eyes'], ['eyebrows/eyebrow001', 'Eyebrows']]) {
    scene.add((await wearable(path, vertices, activeTargets, skeleton, name)).mesh);
  }
  scene.userData.creatorParts = { catalog: { version: 1, groups: [
    { id: 'outfit', name: '服装', required: true, options: outfits },
    { id: 'hair', name: '发型', required: false, options: hairOptions },
  ] }, selected: { outfit: 'outfit01', hair: 'short01' } };
  const bytes = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false });
  if (!(bytes instanceof ArrayBuffer)) throw new Error('Invalid GLB output');
  await writeFile(`${directory}/${gender}.glb`, new Uint8Array(bytes));
  console.log(`${gender}: ${basePosition.count} body vertices, ${bones.size} bones, ${activeTargets.length} shapes, ${bytes.byteLength} bytes`);
}