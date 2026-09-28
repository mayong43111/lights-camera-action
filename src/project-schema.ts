import { validPose } from './pose-schema';
import { validProps } from './prop-schema';
import { finiteRange, isColor, isRecord, isVector } from './schema-utils';
import type { ProjectState, StudioProject } from './scene-types';

interface LightDefinition { id: string; intensity: number; color: string; position: number[] }
interface ProjectCatalogs { poses: object; characters: object; lightDefinitions: { id: string }[] }

export function createDefaultState(defaultPose: string, lightDefinitions: LightDefinition[]): ProjectState {
  return {
    props: [], pose: defaultPose, backdrop: '#edf4f6', aspect: '1.5',
    cameraPosition: [0.8, 2.1, 7.5], target: [0, 1.65, 0], focal: '50', exposure: '0.5', dof: '0',
    lights: Object.fromEntries(lightDefinitions.map(light => [light.id, {
      enabled: true, intensity: String(light.intensity), color: light.color,
      position: String(light.position[0]), height: String(light.position[1]), depth: String(light.position[2]),
    }])),
  };
}

export function validProject(project: unknown, { poses, characters, lightDefinitions }: ProjectCatalogs): project is StudioProject {
  if (!isRecord(project) || project.version !== 1 || !isRecord(project.state)) return false;
  const state = project.state;
  if (typeof state.pose !== 'string' || !isColor(state.backdrop)) return false;
  if (state.props !== undefined && !validProps(state.props)) return false;
  if (!Object.hasOwn(poses, state.pose) && (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(state.pose) || !validPose(state.jointPose))) return false;
  if (state.character != null && (typeof state.character !== 'string' || !Object.hasOwn(characters, state.character))) return false;
  if (state.jointPose != null && !validPose(state.jointPose)) return false;
  if (state.poseCustomized != null && typeof state.poseCustomized !== 'boolean') return false;
  if (state.poseSaveTarget != null && state.poseSaveTarget !== state.pose) return false;
  if (state.removeShadows != null && typeof state.removeShadows !== 'boolean') return false;
  if (!['1.5', '1.333333', '1', '0.5625'].includes(String(state.aspect)) || !isVector(state.cameraPosition) || !isVector(state.target)) return false;
  if (!finiteRange(state.focal, 24, 100) || !finiteRange(state.exposure, 0.125, 2) || !finiteRange(state.dof, 0, 100)) return false;
  if (!finiteRange(state.rotation ?? 0, -180, 180) || !finiteRange(state.leftArm ?? 0, -90, 90) || !finiteRange(state.rightArm ?? 0, -90, 90)) return false;
  if (state.background != null && (typeof state.background !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(state.background) || state.background.length > 12 * 1024 * 1024)) return false;
  if (state.autoOrbit != null && typeof state.autoOrbit !== 'boolean' || state.showRigs != null && typeof state.showRigs !== 'boolean') return false;
  const lights = state.lights;
  return isRecord(lights) && Object.keys(lights).length === lightDefinitions.length && lightDefinitions.every(({ id }) => {
    const light = lights[id];
    return isRecord(light) && typeof light.enabled === 'boolean' && isColor(light.color) && finiteRange(light.intensity, 0, 12)
      && finiteRange(light.position, -6, 6) && finiteRange(light.height ?? 3, 1, 6) && finiteRange(light.depth ?? 0, -4, 6);
  });
}