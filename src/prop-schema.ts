import { isColor, isRecord, isVector } from './schema-utils';
import type { PropType, SceneProp, Vector3Tuple } from './scene-types';

export const PROP_TYPES: Record<PropType, { name: string; size: Vector3Tuple; color: string }> = {
  flowers: { name: '鲜花', size: [0.65, 1.05, 0.65], color: '#d85c83' },
  sword: { name: '剑', size: [0.36, 1.5, 0.09], color: '#44776d' },
  gun: { name: '枪', size: [0.75, 0.45, 0.16], color: '#557786' },
  block: { name: '方块', size: [1, 1, 1], color: '#b6c3c8' },
};

export const MAX_PROPS = 16;
export const isPropType = (type: unknown): type is PropType => typeof type === 'string' && Object.hasOwn(PROP_TYPES, type);

export function validProps(props: unknown): props is SceneProp[] {
  if (!Array.isArray(props) || props.length > MAX_PROPS) return false;
  const entries: unknown[] = props;
  return new Set(entries.map(prop => isRecord(prop) ? prop.id : undefined)).size === entries.length
    && entries.every(prop => isRecord(prop) && typeof prop.id === 'string' && /^prop-[a-zA-Z0-9-]{1,64}$/.test(prop.id)
      && isPropType(prop.type) && isVector(prop.position, -20, 20)
      && isVector(prop.rotation, -Math.PI, Math.PI) && isVector(prop.size, 0.02, 10) && isColor(prop.color));
}

export function createPropState(type: string): SceneProp {
  if (!isPropType(type)) throw new Error('未知道具类型');
  return { id: `prop-${crypto.randomUUID()}`, type, position: [1.4, 0, 0], rotation: [0, 0, 0],
    size: [...PROP_TYPES[type].size], color: PROP_TYPES[type].color };
}