import * as THREE from 'three';
import { VRM, VRMHumanoid } from '@pixiv/three-vrm';

export function createMannequin(scene) {
  const names = {
    hips: 'pelvis', spine: 'spine_01', chest: 'spine_02', upperChest: 'spine_03',
    neck: 'neck_01', head: 'Head',
  };
  for (const [side, suffix] of [['left', 'l'], ['right', 'r']]) {
    for (const [joint, source] of Object.entries({ Shoulder: 'clavicle', UpperArm: 'upperarm', LowerArm: 'lowerarm', Hand: 'hand', UpperLeg: 'thigh', LowerLeg: 'calf', Foot: 'foot', Toes: 'ball' })) {
      names[`${side}${joint}`] = `${source}_${suffix}`;
    }
    for (const [finger, source] of [['Thumb', 'thumb'], ['Index', 'index'], ['Middle', 'middle'], ['Ring', 'ring'], ['Little', 'pinky']]) {
      const segments = finger === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'];
      segments.forEach((segment, index) => { names[`${side}${finger}${segment}`] = `${source}_0${index + 1}_${suffix}`; });
    }
  }
  const bones = Object.fromEntries(Object.entries(names).map(([name, source]) => {
    const node = scene.getObjectByName(source);
    if (!node?.isBone) throw new Error(`白模缺少骨骼：${source}`);
    return [name, { node }];
  }));
  const root = new THREE.Group();
  root.add(scene);
  root.updateMatrixWorld(true);
  const left = bones.leftUpperArm.node.getWorldPosition(new THREE.Vector3());
  const right = bones.rightUpperArm.node.getWorldPosition(new THREE.Vector3());
  if (left.x < right.x) scene.rotation.y += Math.PI;
  root.updateMatrixWorld(true);
  for (const side of ['left', 'right']) {
    const direction = new THREE.Vector3(side === 'left' ? 1 : -1, 0, 0);
    for (const [joint, child] of [['UpperArm', 'LowerArm'], ['LowerArm', 'Hand']]) {
      const bone = bones[`${side}${joint}`].node;
      const endpoint = bones[`${side}${child}`].node;
      const current = endpoint.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
      const rotation = new THREE.Quaternion().setFromUnitVectors(current, direction).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
      bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
      root.updateMatrixWorld(true);
    }
  }
  const humanoid = new VRMHumanoid(bones);
  root.add(humanoid.normalizedHumanBonesRoot);
  return new VRM({
    scene: root,
    humanoid,
    meta: { metaVersion: '1', name: 'White Mannequin', authors: ['Quaternius'], licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  });
}