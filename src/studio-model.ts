import { LIGHT_DEFINITIONS } from './studio-defaults';
import type { LightId, Vector3Tuple } from './scene-types';
import type { CaptureState } from './capture';

export type ToolKey = 'cast' | 'shots' | 'poses' | 'props' | 'stage' | 'camera' | 'lights';
export type StudioOperation = 'save' | 'export' | 'undo' | 'reset' | 'photo' | 'record' | 'library' | 'retouch' | 'exportPose' | 'resetJoint' | 'clearBackground';
export type ImportKind = 'project' | 'pose' | 'background';
export interface CharacterSettings {
  id: string; credit: string; rotation: number; grounded: boolean; height: number;
  selected: string; angles: Vector3Tuple; selectable: string[]; jointAvailable: boolean;
  editing: boolean; mode: 'fk' | 'ik';
}
export interface LightSettings {
  enabled: boolean;
  intensity: number;
  color: string;
  position: number;
  height: number;
  depth: number;
}
export interface PhotographySettings {
  focal: number;
  exposure: number;
  dof: number;
  autoOrbit: boolean;
  showRigs: boolean;
  removeShadows: boolean;
  lights: Record<LightId, LightSettings>;
}
interface StudioSnapshot {
  character: CharacterSettings;
  stage: { backdrop: string; aspect: number };
  status: string;
  persistence: string;
  resolution: string;
  account: string | null;
  capture: CaptureState;
  photography: PhotographySettings;
  activeTool: ToolKey;
  ready: boolean;
  loading: boolean;
  busy: boolean;
  retouchBusy: boolean;
}
interface StudioCommands {
  run(operation: StudioOperation): void | Promise<void>;
  importFile(kind: ImportKind, file: File): void | Promise<void>;
  setCharacter(patch: Partial<CharacterSettings>): void | Promise<void>;
  setStage(patch: Partial<StudioSnapshot['stage']>): void;
  beginEdit(): void;
  setPhotography(patch: Partial<PhotographySettings>): void;
  frame(mode: string): void;
  selectTool(tool: ToolKey): void;
}

export function createStudioModel() {
  const listeners = new Set<() => void>();
  let commands: StudioCommands | undefined;
  let snapshot: StudioSnapshot = {
    character: { id: 'mannequinFemale', credit: '正在加载白模', rotation: 0, grounded: true, height: 0,
      selected: 'root', angles: [0, 0, 0], selectable: [], jointAvailable: false, editing: false, mode: 'fk' },
    stage: { backdrop: '#edf4f6', aspect: 1.5 }, status: '正在初始化摄影棚', persistence: '正在读取配置', resolution: '-- × --', account: null,
    capture: { takeNumber: 1, recording: false, stopping: false, elapsed: 0 },
    activeTool: 'shots', ready: false, loading: true, busy: false, retouchBusy: false,
    photography: {
      focal: 50, exposure: 0.5, dof: 0, autoOrbit: false, showRigs: false, removeShadows: true,
      lights: Object.fromEntries(LIGHT_DEFINITIONS.map(light => [light.id, {
        enabled: true, intensity: light.intensity, color: light.color,
        position: light.position[0], height: light.position[1], depth: light.position[2],
      }])) as Record<LightId, LightSettings>,
    },
  };
  function update(patch: Partial<StudioSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener());
  }
  function selectTool(activeTool: ToolKey) {
    update({ activeTool });
    commands?.selectTool(activeTool);
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setAvailability(patch: Partial<Pick<StudioSnapshot, 'ready' | 'loading' | 'busy'>>) { update(patch); },
    setRetouchBusy(retouchBusy: boolean) { update({ retouchBusy }); },
    setCapture(capture: CaptureState) { update({ capture }); },
    setCharacter(patch: Partial<CharacterSettings>) { update({ character: { ...snapshot.character, ...patch } }); },
    setStage(patch: Partial<StudioSnapshot['stage']>) { update({ stage: { ...snapshot.stage, ...patch } }); },
    setStatus(status: string) { update({ status }); },
    setPersistence(persistence: string) { update({ persistence }); },
    setResolution(resolution: string) { update({ resolution }); },
    setAccount(account: string | null) { update({ account }); },
    setPhotography(patch: Partial<PhotographySettings>) {
      update({ photography: { ...snapshot.photography, ...patch } });
    },
    selectTool,
    connect(next: StudioCommands) {
      commands = next;
      next.selectTool(snapshot.activeTool);
      return () => { if (commands === next) commands = undefined; };
    },
    actions: {
      run(operation: StudioOperation) {
        if (snapshot.capture.recording && ['photo', 'undo', 'reset', 'resetJoint'].includes(operation)) return;
        if (snapshot.busy && !['library', 'retouch'].includes(operation)) return;
        void commands?.run(operation);
      },
      importFile(kind: ImportKind, file: File) {
        if (!snapshot.loading && !snapshot.busy && !snapshot.capture.recording) void commands?.importFile(kind, file);
      },
      setCharacter(patch: Partial<CharacterSettings>) {
        if (!snapshot.ready || snapshot.busy) return;
        if (snapshot.capture.recording && (patch.id !== undefined || patch.editing !== undefined || patch.mode !== undefined)) return;
        void commands?.setCharacter(patch);
      },
      setStage(patch: Partial<StudioSnapshot['stage']>) {
        if (snapshot.ready && !snapshot.busy && (!snapshot.capture.recording || patch.aspect === undefined)) commands?.setStage(patch);
      },
      beginEdit() { if (snapshot.ready && !snapshot.busy) commands?.beginEdit(); },
      setPhotography(patch: Partial<PhotographySettings>) {
        if (snapshot.ready && !snapshot.busy) commands?.setPhotography(patch);
      },
      setLight(id: LightId, patch: Partial<LightSettings>) {
        if (snapshot.ready && !snapshot.busy) commands?.setPhotography({ lights: {
          ...snapshot.photography.lights, [id]: { ...snapshot.photography.lights[id], ...patch },
        } });
      },
      frame(mode: string) { if (snapshot.ready && !snapshot.busy) commands?.frame(mode); },
      selectTool,
    },
  };
}

export type StudioModel = ReturnType<typeof createStudioModel>;