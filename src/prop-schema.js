export const PROP_TYPES = {
  flowers: { name: '鲜花', size: [0.65, 1.05, 0.65], color: '#d85c83' },
  sword: { name: '剑', size: [0.36, 1.5, 0.09], color: '#44776d' },
  gun: { name: '枪', size: [0.75, 0.45, 0.16], color: '#557786' },
  block: { name: '方块', size: [1, 1, 1], color: '#b6c3c8' },
};

export const MAX_PROPS = 16;

export function validProps(props) {
  const vector = (value, min, max) => Array.isArray(value) && value.length === 3
    && value.every(number => typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max);
  return Array.isArray(props) && props.length <= MAX_PROPS && new Set(props.map(prop => prop?.id)).size === props.length
    && props.every(prop => prop && typeof prop.id === 'string' && /^prop-[a-zA-Z0-9-]{1,64}$/.test(prop.id)
      && Object.hasOwn(PROP_TYPES, prop.type) && vector(prop.position, -20, 20)
      && vector(prop.rotation, -Math.PI, Math.PI) && vector(prop.size, 0.02, 10)
      && typeof prop.color === 'string' && /^#[0-9a-f]{6}$/i.test(prop.color));
}

export function createPropState(type) {
  if (!Object.hasOwn(PROP_TYPES, type)) throw new Error('未知道具类型');
  return {
    id: `prop-${crypto.randomUUID()}`, type,
    position: [1.4, 0, 0], rotation: [0, 0, 0],
    size: [...PROP_TYPES[type].size], color: PROP_TYPES[type].color,
  };
}