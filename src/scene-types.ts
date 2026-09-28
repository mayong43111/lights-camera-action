export type Vector3Tuple = [number, number, number];
export type LightId = 'key' | 'fill' | 'rim';
export type ShotCategory = '时尚封面' | '写真集' | '肖像' | '其他';
export type Aspect = '1.5' | '1.333333' | '1' | '0.5625';
export type PropType = 'flowers' | 'sword' | 'gun' | 'block';

export interface JointPose {
  format: 'studio-pose';
  version: 1;
  units: 'radians';
  rotation: number;
  placement?: { grounded: boolean; height: number } | null;
  joints: Record<string, Vector3Tuple>;
}

export interface SceneProp {
  id: string;
  type: PropType;
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  size: Vector3Tuple;
  color: string;
}

export interface ShotLight {
  enabled: boolean;
  intensity: number;
  color: string;
  position: number;
  height: number;
  depth: number;
}

export interface ShotScene {
  jointPose: JointPose & { placement: { grounded: boolean; height: number } };
  cameraPosition: Vector3Tuple;
  target: Vector3Tuple;
  focal: number;
  aspect: Aspect;
  exposure: number;
  backdrop: string;
  props: Omit<SceneProp, 'id'>[];
  lights: Record<LightId, ShotLight>;
}

export interface ShotPreset {
  id: string;
  name: string;
  category: ShotCategory;
  notes: string;
  sourceName: string;
  thumbnail: string;
  scene: ShotScene;
}

export interface ShotLibrary { version: 1; items: ShotPreset[] }

export interface PoseEntry {
  id: string;
  name: string;
  folder: string;
  icon?: string | null;
  rotation?: number | null;
  placement?: JointPose['placement'];
  joints: JointPose['joints'];
}

export interface PoseLibrary {
  version: 1;
  units: 'radians';
  defaultPose: string;
  poses: PoseEntry[];
}

export type NumericInput = number | string;
export interface ProjectLight {
  enabled: boolean;
  color: string;
  intensity: NumericInput;
  position: NumericInput;
  height?: NumericInput;
  depth?: NumericInput;
}

export interface ProjectState {
  pose: string;
  backdrop: string;
  aspect: Aspect | number;
  cameraPosition: Vector3Tuple;
  target: Vector3Tuple;
  focal: NumericInput;
  exposure: NumericInput;
  dof: NumericInput;
  lights: Record<string, ProjectLight>;
  props?: SceneProp[];
  character?: string | null;
  jointPose?: JointPose | null;
  poseCustomized?: boolean | null;
  poseSaveTarget?: string | null;
  rotation?: NumericInput;
  leftArm?: NumericInput;
  rightArm?: NumericInput;
  removeShadows?: boolean | null;
  background?: string | null;
  autoOrbit?: boolean | null;
  showRigs?: boolean | null;
}

export interface StudioProject { version: 1; state: ProjectState }