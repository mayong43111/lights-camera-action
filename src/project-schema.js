import { validPose } from './pose-schema.js';

export const PROP_MODELS = { chair: { name: '摄影椅' }, stool: { name: '圆凳' }, plinth: { name: '展示台' } };

export function validSceneObjects(objects, selected, characters) {
  if (!Array.isArray(objects) || !objects.length || objects.length > 16) return false;
  const ids = new Set();
  let people = 0;
  const vector = value => Array.isArray(value) && value.length === 3 && value.every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1000);
  for (const object of objects) {
    if (!object || typeof object.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(object.id) || ids.has(object.id)) return false;
    ids.add(object.id);
    if (typeof object.name !== 'string' || !object.name.trim() || object.name.length > 80 || !vector(object.position)
      || typeof object.visible !== 'boolean' || typeof object.locked !== 'boolean') return false;
    if (object.kind === 'character') {
      people++;
      if (!Object.hasOwn(characters, object.model) || !validPose(object.jointPose) || object.position[1] !== 0
        || typeof object.pose !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(object.pose)
        || typeof object.poseCustomized !== 'boolean' || object.poseSaveTarget !== null && object.poseSaveTarget !== object.pose) return false;
    } else if (object.kind === 'prop') {
      if (!Object.hasOwn(PROP_MODELS, object.model) || !vector(object.rotation)
        || typeof object.scale !== 'number' || !Number.isFinite(object.scale) || object.scale < 0.1 || object.scale > 5) return false;
    } else return false;
  }
  return people >= 1 && people <= 4 && ids.has(selected);
}

export function createDefaultState(defaultPose, lightDefinitions) {
  return {
    pose: defaultPose, backdrop: '#edf4f6', aspect: '1.5',
    cameraPosition: [0.8, 2.1, 7.5], target: [0, 1.65, 0], focal: '50', exposure: '0.5', dof: '0',
    lights: Object.fromEntries(lightDefinitions.map((light) => [light.id, {
      enabled: true, intensity: String(light.intensity), color: light.color,
      position: String(light.position[0]), height: String(light.position[1]), depth: String(light.position[2]),
    }])),
  };
}

export function validProject(project, { poses, characters, lightDefinitions }) {
  const state = project?.state;
  const finiteRange = (value, min, max) => (typeof value === 'number' || typeof value === 'string') && value !== '' && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;
  const vector = (value) => Array.isArray(value) && value.length === 3 && value.every((number) => typeof number === 'number' && Number.isFinite(number));
  const color = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  if (![1, 2].includes(project?.version) || !state || typeof state.pose !== 'string' || !color(state.backdrop)) return false;
  if ((project.version === 2 || state.objects != null) && !validSceneObjects(state.objects, state.selectedObject, characters)) return false;
  if (!Object.hasOwn(poses, state.pose) && (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(state.pose) || !validPose(state.jointPose))) return false;
  if (state.character != null && !Object.hasOwn(characters, state.character)) return false;
  if (state.jointPose != null && !validPose(state.jointPose)) return false;
  if (state.poseCustomized != null && typeof state.poseCustomized !== 'boolean') return false;
  if (state.poseSaveTarget != null && state.poseSaveTarget !== state.pose) return false;
  if (state.removeShadows != null && typeof state.removeShadows !== 'boolean') return false;
  if (!['1.5', '1.333333', '1', '0.5625'].includes(String(state.aspect)) || !vector(state.cameraPosition) || !vector(state.target)) return false;
  if (!finiteRange(state.focal, 24, 100) || !finiteRange(state.exposure, 0.125, 2) || !finiteRange(state.dof, 0, 100)) return false;
  if (!finiteRange(state.rotation ?? 0, -180, 180) || !finiteRange(state.leftArm ?? 0, -90, 90) || !finiteRange(state.rightArm ?? 0, -90, 90)) return false;
  if (state.background != null && (typeof state.background !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(state.background) || state.background.length > 12 * 1024 * 1024)) return false;
  if (state.autoOrbit != null && typeof state.autoOrbit !== 'boolean' || state.showRigs != null && typeof state.showRigs !== 'boolean') return false;
  return !!state.lights && Object.keys(state.lights).length === lightDefinitions.length && lightDefinitions.every(({ id }) => {
    const light = state.lights[id];
    return light && typeof light.enabled === 'boolean' && color(light.color) && finiteRange(light.intensity, 0, 12) && finiteRange(light.position, -6, 6) && finiteRange(light.height ?? 3, 1, 6) && finiteRange(light.depth ?? 0, -4, 6);
  });
}