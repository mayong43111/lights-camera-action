import { isRecord, isVector } from './schema-utils';
import type { JointPose } from './scene-types';

export const JOINTS: [string, string, string][] = [
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

const knownJoints = new Set(JOINTS.map(([id]) => id));

export function validPose(pose: unknown): pose is JointPose {
  if (!isRecord(pose) || pose.format !== 'studio-pose' || pose.version !== 1 || pose.units !== 'radians') return false;
  if (typeof pose.rotation !== 'number' || !Number.isFinite(pose.rotation) || Math.abs(pose.rotation) > Math.PI) return false;
  if (pose.placement != null && (!isRecord(pose.placement)
    || typeof pose.placement.grounded !== 'boolean' || typeof pose.placement.height !== 'number'
    || !Number.isFinite(pose.placement.height) || Math.abs(pose.placement.height) > 1000)) return false;
  if (!isRecord(pose.joints)) return false;
  const entries = Object.entries(pose.joints);
  return entries.length > 0 && entries.length <= JOINTS.length
    && entries.every(([id, values]) => knownJoints.has(id) && isVector(values, -Math.PI, Math.PI));
}