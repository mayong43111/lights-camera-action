import { MathUtils, Vector3, type Box3, type PerspectiveCamera } from 'three';
import type { Vector3Tuple } from './scene-types';

export interface FramingShot { direction: Vector3Tuple; offset?: number }

interface FramingOptions {
  bounds: Box3;
  camera: Pick<PerspectiveCamera, 'position' | 'up' | 'fov' | 'aspect'>;
  target: Vector3;
  minDistance: number;
  lowAngle: boolean;
  shot: FramingShot | null;
}

export function calculateFraming({ bounds, camera, target, minDistance, lowAngle, shot }: FramingOptions) {
  const center = bounds.getCenter(new Vector3());
  const direction = shot ? new Vector3(...shot.direction).normalize() : camera.position.clone().sub(target).normalize();
  if (lowAngle) {
    direction.y = -0.16;
    direction.normalize();
  }
  const right = new Vector3().crossVectors(camera.up, direction).normalize();
  const up = new Vector3().crossVectors(direction, right);
  const verticalSlope = Math.tan(MathUtils.degToRad(camera.fov) / 2);
  const horizontalSlope = verticalSlope * camera.aspect;
  let distance = minDistance;
  for (const horizontal of [bounds.min.x, bounds.max.x]) {
    for (const vertical of [bounds.min.y, bounds.max.y]) {
      for (const depth of [bounds.min.z, bounds.max.z]) {
        const offset = new Vector3(horizontal, vertical, depth).sub(center);
        const clearance = Math.max(Math.abs(offset.dot(right)) / (horizontalSlope * (1 - Math.abs(shot?.offset ?? 0))), Math.abs(offset.dot(up)) / verticalSlope);
        distance = Math.max(distance, offset.dot(direction) + clearance * 1.12);
      }
    }
  }
  center.addScaledVector(right, (shot?.offset ?? 0) * distance * horizontalSlope);
  return { target: center, position: center.clone().addScaledVector(direction, distance) };
}