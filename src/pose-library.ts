import { validPose } from './pose-schema';
import { isRecord } from './schema-utils';
import type { PoseEntry, PoseLibrary } from './scene-types';

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 80;
function isEntry(pose: unknown): pose is PoseEntry {
  return isRecord(pose) && typeof pose.id === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(pose.id)
    && !['constructor', 'prototype', '__proto__'].includes(pose.id) && text(pose.name) && text(pose.folder)
    && (pose.icon == null || typeof pose.icon === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(pose.icon))
    && validPose({ format: 'studio-pose', version: 1, units: 'radians', rotation: pose.rotation ?? 0, placement: pose.placement, joints: pose.joints });
}

export function validatePoseLibrary(data: unknown): PoseLibrary {
  if (!isRecord(data) || data.version !== 1 || data.units !== 'radians' || !Array.isArray(data.poses)
    || !data.poses.length || data.poses.length > 2000) throw new Error('姿势库格式无效');
  const identifiers = new Set<string>();
  const poses: PoseEntry[] = [];
  for (const pose of data.poses) {
    if (!isEntry(pose) || identifiers.has(pose.id)) {
      throw new Error(`姿势库条目无效或 ID 重复：${isRecord(pose) && typeof pose.id === 'string' ? pose.id : '未命名'}`);
    }
    identifiers.add(pose.id);
    poses.push(pose);
  }
  if (typeof data.defaultPose !== 'string' || !identifiers.has(data.defaultPose)) throw new Error('姿势库默认姿势不存在');
  return { version: 1, units: 'radians', defaultPose: data.defaultPose, poses };
}

export async function loadPoseLibrary(): Promise<PoseLibrary> {
  try {
    const response = await fetch(new URL('../assets/poses/library.json', import.meta.url), {
      cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const content = await response.text();
    if (content.length > 2 * 1024 * 1024) throw new Error('姿势库超过 2 MB');
    return validatePoseLibrary(JSON.parse(content));
  } catch (error) {
    throw new Error(`无法加载姿势库 assets/poses/library.json：${error instanceof Error ? error.message : '未知错误'}`);
  }
}