import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createMannequin } from '../src/mannequin';
import { Character } from '../src/character';
import { JOINTS, validPose } from '../src/pose-schema';
import { validatePoseLibrary } from '../src/pose-library';

const sourceHash = '69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997';

const samples = [
  ['A_TPose', '标准 T 姿势', '基础站姿', 0],
  ['Idle_Loop', '自然站立', '基础站姿', 0.25, 'ual1Idle'],
  ['Idle_Talking_Loop', '交谈手势', '日常交流', 0.35, 'ual1Talking'],
  ['Idle_Torch_Loop', '手持火把', '日常交流', 0.3],
  ['Interact', '伸手交互', '日常交流', 0.55],
  ['PickUp_Table', '桌面取物', '日常交流', 0.5],
  ['Driving_Loop', '驾驶姿势', '日常交流', 0.3],
  ['Push_Loop', '双手推物', '日常交流', 0.35],
  ['Crouch_Fwd_Loop', '蹲姿前行', '坐姿蹲姿', 0.25],
  ['Crouch_Idle_Loop', '蹲姿停留', '坐姿蹲姿', 0.3],
  ['Fixing_Kneeling', '跪姿修理', '坐姿蹲姿', 0.4],
  ['Sitting_Enter', '落座瞬间', '坐姿蹲姿', 0.55],
  ['Sitting_Exit', '起身瞬间', '坐姿蹲姿', 0.45],
  ['Sitting_Idle_Loop', '放松坐姿', '坐姿蹲姿', 0.3, 'ual1Sitting'],
  ['Sitting_Talking_Loop', '坐姿交谈', '坐姿蹲姿', 0.35],
  ['Walk_Loop', '自然行走', '行走跑跳', 0.2],
  ['Walk_Formal_Loop', '正式行走', '行走跑跳', 0.2, 'ual1Walking'],
  ['Jog_Fwd_Loop', '向前慢跑', '行走跑跳', 0.25],
  ['Sprint_Loop', '冲刺定格', '行走跑跳', 0.25],
  ['Jump_Start', '起跳蓄力', '行走跑跳', 0.45],
  ['Jump_Loop', '腾空姿势', '行走跑跳', 0.35],
  ['Jump_Land', '落地缓冲', '行走跑跳', 0.25],
  ['Dance_Loop', '舞蹈定格', '舞蹈游泳', 0.35, 'ual1Dance'],
  ['Swim_Fwd_Loop', '向前游泳', '舞蹈游泳', 0.25],
  ['Swim_Idle_Loop', '原地踩水', '舞蹈游泳', 0.3],
  ['Punch_Cross', '交叉直拳', '格斗施法', 0.4],
  ['Punch_Jab', '刺拳定格', '格斗施法', 0.35],
  ['Sword_Attack', '挥剑定格', '格斗施法', 0.4],
  ['Sword_Idle', '持剑待机', '格斗施法', 0.3],
  ['Spell_Simple_Enter', '施法准备', '格斗施法', 0.65],
  ['Spell_Simple_Idle_Loop', '施法蓄势', '格斗施法', 0.3],
  ['Spell_Simple_Shoot', '施法释放', '格斗施法', 0.45],
  ['Spell_Simple_Exit', '施法收势', '格斗施法', 0.45],
  ['Pistol_Aim_Down', '向下瞄准', '持械瞄准', 0.5],
  ['Pistol_Aim_Neutral', '水平瞄准', '持械瞄准', 0.5],
  ['Pistol_Aim_Up', '向上瞄准', '持械瞄准', 0.5],
  ['Pistol_Idle_Loop', '持械待机', '持械瞄准', 0.3],
  ['Pistol_Reload', '换弹姿势', '持械瞄准', 0.45],
  ['Pistol_Shoot', '射击定格', '持械瞄准', 0.2],
  ['Death01', '仰卧倒地', '倒地翻滚', 0.95],
  ['Hit_Chest', '胸部受击', '倒地翻滚', 0.35],
  ['Hit_Head', '头部受击', '倒地翻滚', 0.35],
  ['Roll', '翻滚定格', '倒地翻滚', 0.5],
].map(([clip, name, category, phase, id]) => ({
  id: id ?? `ual1-${clip}`, name, folder: `Quaternius · ${category}`, clip, phase,
}));

export function buildCatalog(base, trial) {
  const existing = base.poses.filter(pose => pose.source?.pack !== 'Universal Animation Library Standard');
  const entries = trial.poses.map(({ id, name, folder, clip, time, pose }) => ({
    id, name, folder, icon: 'accessibility', joints: pose.joints, rotation: pose.rotation,
    placement: pose.placement,
    source: { author: 'Quaternius', license: 'CC0-1.0', pack: 'Universal Animation Library Standard',
      clip, time, sha256: sourceHash },
  }));
  return validatePoseLibrary({ ...base, poses: [...existing, ...entries] });
}

export async function createTrial() {
  const response = await fetch('/tests/quaternius-source.glb');
  if (!response.ok) throw new Error(`Source download failed: ${response.status}`);
  const bytes = await response.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== sourceHash) throw new Error('Source differs from the verified official Standard GLB');
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  const expected = new Set(samples.map(entry => entry.clip));
  if (expected.size !== samples.length || gltf.animations.length !== samples.length
    || gltf.animations.some(clip => !expected.has(clip.name))) throw new Error('Official clip coverage mismatch');
  const source = createMannequin(gltf.scene);
  source.scene.updateMatrixWorld(true);
  const mapped = JOINTS.map(([id, name]) => ({ id, node: source.humanoid.getRawBoneNode(name) }));
  const mappedNodes = new Set(mapped.map(entry => entry.node));
  const rest = new Map(mapped.map(({ node }) => [node, node.getWorldQuaternion(new THREE.Quaternion())]));
  const mixer = new THREE.AnimationMixer(gltf.scene);

  function sample(clipName, time) {
    const clip = gltf.animations.find(entry => entry.name === clipName);
    if (!clip || time < 0 || time > clip.duration) throw new Error(`Invalid sample: ${clipName} at ${time}`);
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset().setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    mixer.setTime(time);
    source.scene.updateMatrixWorld(true);
    const deltas = new Map(mapped.map(({ node }) => [node,
      node.getWorldQuaternion(new THREE.Quaternion()).multiply(rest.get(node).clone().invert()),
    ]));
    const joints = Object.fromEntries(mapped.map(({ id, node }) => {
      let parent = node.parent;
      while (parent && !mappedNodes.has(parent)) parent = parent.parent;
      const rotation = parent ? deltas.get(parent).clone().invert().multiply(deltas.get(node)) : deltas.get(node);
      const euler = new THREE.Euler().setFromQuaternion(rotation, 'XYZ');
      return [id, [euler.x, euler.y, euler.z]];
    }));
    const pose = { format: 'studio-pose', version: 1, units: 'radians', rotation: 0,
      placement: { grounded: true, height: 0 }, joints };
    if (!validPose(pose)) throw new Error(`Invalid converted pose: ${clipName}`);
    return pose;
  }

  const poses = samples.map(entry => {
    const clip = gltf.animations.find(clip => clip.name === entry.clip);
    if (!clip) throw new Error(`Missing official clip: ${entry.clip}`);
    const time = clip.duration * entry.phase;
    return { ...entry, time, duration: clip.duration, pose: sample(entry.clip, time) };
  });
  for (const entry of poses.filter(entry => ['Swim_Fwd_Loop', 'Swim_Idle_Loop', 'Jump_Loop'].includes(entry.clip))) {
    entry.pose.placement = { grounded: false, height: 0.6 };
  }
  const floorPoses = poses.filter(entry => ['Death01', 'Roll'].includes(entry.clip));
  const heights = new Map(floorPoses.map(entry => [entry.id, -Infinity]));
  const calibration = new Character(new THREE.Scene(), new THREE.PerspectiveCamera(),
    document.createElement('canvas'), { enabled: true }, () => {}, () => {});
  for (const model of ['quaternius', 'mannequin', 'mannequinFemale']) {
    await calibration.load(model);
    for (const entry of floorPoses) {
      calibration.restorePose({ ...entry.pose, placement: { grounded: false, height: 0 } });
      heights.set(entry.id, Math.max(heights.get(entry.id), 0.008 - calibration.getFramingBounds('full').min.y));
    }
  }
  calibration.ik.dispose();
  calibration.gizmo.dispose();
  for (const entry of floorPoses) entry.pose.placement = { grounded: false, height: heights.get(entry.id) };
  return { source, gltf, sample, poses, clipCount: gltf.animations.length, sourceHash };
}

export async function verifyTrial(trial) {
  const segments = [
    ['leftUpperArm', 'leftLowerArm'], ['leftLowerArm', 'leftHand'],
    ['rightUpperArm', 'rightLowerArm'], ['rightLowerArm', 'rightHand'],
    ['leftUpperLeg', 'leftLowerLeg'], ['leftLowerLeg', 'leftFoot'],
    ['rightUpperLeg', 'rightLowerLeg'], ['rightLowerLeg', 'rightFoot'],
  ];
  const results = [];
  const ikResults = [];
  const targets = [];
  const reference = trial.sample('A_TPose', 0);
  const referenceError = THREE.MathUtils.radToDeg(Math.max(...Object.values(reference.joints).flat().map(Math.abs)));
  if (referenceError > 2.1) throw new Error(`Reference calibration drift: ${referenceError}`);
  for (const id of ['mannequin', 'mannequinFemale', 'quaternius']) {
    const target = new Character(new THREE.Scene(), new THREE.PerspectiveCamera(),
      document.createElement('canvas'), { enabled: true }, () => {}, () => {});
    await target.load(id);
    targets.push(target);
    for (const entry of trial.poses) {
      trial.sample(entry.clip, entry.time);
      target.restorePose(entry.pose);
      const errors = segments.map(([start, end]) => {
        const direction = rig => rig.getRawBoneNode(end).getWorldPosition(new THREE.Vector3())
          .sub(rig.getRawBoneNode(start).getWorldPosition(new THREE.Vector3())).normalize();
        return THREE.MathUtils.radToDeg(direction(trial.source.humanoid).angleTo(direction(target.vrm.humanoid)));
      });
      const directionError = Math.max(...errors);
      const bounds = target.getFramingBounds('full');
      const invalidHeight = entry.pose.placement.grounded
        ? Math.abs(bounds.min.y - 0.008) > 0.0001 : bounds.min.y < 0.0078;
      if (directionError > 4 || invalidHeight) {
        throw new Error(`Retarget/grounding failed: ${id}, ${entry.id}`);
      }
      if (JSON.stringify(target.capturePose()) !== JSON.stringify(entry.pose)) {
        throw new Error(`Pose roundtrip failed: ${id}, ${entry.id}`);
      }
      results.push({ model: id, pose: entry.id, directionError, groundY: bounds.min.y });
    }
    for (const joint of ['leftHand', 'rightHand', 'leftFoot', 'rightFoot']) {
      target.restorePose({ format: 'studio-pose', version: 1, units: 'radians', rotation: 0,
        placement: { grounded: false, height: 1.25 }, joints: { head: [0, 0, 0] } });
      const start = target.joints[joint].getWorldPosition(new THREE.Vector3());
      const upper = target.joints[joint.replace('Hand', 'UpperArm').replace('Foot', 'UpperLeg')]
        .getWorldPosition(new THREE.Vector3());
      const desired = start.clone().lerp(upper, 0.08).add(new THREE.Vector3(0, 0, 0.03));
      target.solveIK(joint, desired);
      target.update(0);
      const error = target.joints[joint].getWorldPosition(new THREE.Vector3()).distanceTo(desired);
      if (error > 0.0001) throw new Error(`Neutral IK failed: ${id}, ${joint}, ${error}`);
      ikResults.push({ model: id, joint, error });
    }
  }
  return { results, ikResults, targets, referenceError };
}