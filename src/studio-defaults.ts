import type { LightId, Vector3Tuple } from './scene-types';

export interface LightDefinition {
  id: LightId;
  name: string;
  index: string;
  intensity: number;
  color: string;
  position: Vector3Tuple;
}

export const LIGHT_DEFINITIONS: LightDefinition[] = [
  { id: 'key', name: '主光', index: 'A', intensity: 7, color: '#fff0d6', position: [-4.2, 4.5, 4.2] },
  { id: 'fill', name: '辅光', index: 'B', intensity: 3.2, color: '#d8e9ff', position: [4.5, 3.5, 3.3] },
  { id: 'rim', name: '轮廓光', index: 'C', intensity: 5.5, color: '#ffffff', position: [0.5, 4.8, -3.4] },
];