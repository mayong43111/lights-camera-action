import * as THREE from 'three';

export const LIGHT_DEFINITIONS = [
  { id: 'key', name: '主光', index: 'A', intensity: 7, color: '#fff0d6', position: [-4.2, 4.5, 4.2] },
  { id: 'fill', name: '辅光', index: 'B', intensity: 3.2, color: '#d8e9ff', position: [4.5, 3.5, 3.3] },
  { id: 'rim', name: '轮廓光', index: 'C', intensity: 5.5, color: '#ffffff', position: [0.5, 4.8, -3.4] },
];

export function createStudio() {
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
  const floorMarks = new THREE.Group();
  floorMarks.name = 'FloorPositionMarks';
  group.add(floorMarks);
  for (let index = 0; index < 4; index += 1) {
    const mark = new THREE.Mesh(new THREE.PlaneGeometry(index % 2 ? 0.05 : 0.65, index % 2 ? 0.65 : 0.05), markMaterial);
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(0, 0.006, 0);
    floorMarks.add(mark);
  }

  const photoBackdrop = new THREE.Mesh(new THREE.PlaneGeometry(12, 6.75), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  photoBackdrop.position.set(0, 3.375, -4.85);
  photoBackdrop.visible = false;
  group.add(photoBackdrop);
  return { group, material: backdropMaterial, photoBackdrop, floorMarks };
}

export function createStudioLight(definition, shadowMapSize = 2048) {
  const group = new THREE.Group();
  const light = new THREE.SpotLight(definition.color, definition.intensity * 8, 18, 0.62, 0.72, 1.25);
  light.position.set(...definition.position);
  light.castShadow = true;
  light.shadow.mapSize.set(shadowMapSize, shadowMapSize);
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