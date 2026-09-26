import { validPose } from './pose-schema.js';

export function validatePoseLibrary(data) {
  if (data?.version !== 1 || data.units !== 'radians' || !Array.isArray(data.poses)
    || !data.poses.length || data.poses.length > 2000) throw new Error('姿势库格式无效');
  const identifiers = new Set();
  const text = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 80;
  for (const pose of data.poses) {
    if (!pose || typeof pose.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(pose.id)
      || ['constructor', 'prototype', '__proto__'].includes(pose.id) || identifiers.has(pose.id)
      || !text(pose.name) || !text(pose.folder)
      || (pose.icon != null && (typeof pose.icon !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(pose.icon)))
      || !validPose({ format: 'studio-pose', version: 1, units: data.units, rotation: pose.rotation ?? 0, placement: pose.placement, joints: pose.joints })) {
      throw new Error(`姿势库条目无效或 ID 重复：${typeof pose?.id === 'string' ? pose.id : '未命名'}`);
    }
    identifiers.add(pose.id);
  }
  if (!identifiers.has(data.defaultPose)) throw new Error('姿势库默认姿势不存在');
  return data;
}

export async function loadPoseLibrary() {
  try {
    const response = await fetch(new URL('../assets/poses/library.json', import.meta.url), {
      cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) throw new Error('姿势库超过 2 MB');
    return validatePoseLibrary(JSON.parse(text));
  } catch (error) {
    throw new Error(`无法加载姿势库 assets/poses/library.json：${error.message}`);
  }
}
