import * as THREE from 'three';
import { createStudioRuntime } from './studio-runtime';
import { calculateFraming, type FramingShot } from './camera-framing';
import type { PhotographySettings, LightSettings, StudioModel, CharacterSettings, StudioOperation, ImportKind } from './studio-model';
import type { ViewHost } from './react-view';
import { Character, CHARACTERS } from './character';
import { JOINTS, validPose } from './pose-schema';
import { createDefaultState, normalizeProjectState, validProject } from './project-schema';
import { createProjectSession } from './project-session';
import { createRetouch } from './retouch';
import { loadPoseLibrary } from './pose-library';
import { createPoseBrowser } from './pose-browser';
import { createStudio, createStudioLight, LIGHT_DEFINITIONS as lightDefinitions } from './studio-scene';
import { createCaptureController } from './capture';
import { createPoseStore } from './pose-store';
import { createPoseSaveControls } from './pose-save';
import { createLibraryClient } from './library-client';
import { createLibrary } from './library';
import { createShotProject, loadBuiltInShots } from './shot-presets';
import { createShotBrowser } from './shot-browser';
import { createPropsController } from './props';
import { requiredElement as element } from './dom';
import { createLifetime } from './lifetime';
import type { JointPose, ProjectState, Vector3Tuple } from './scene-types';

export async function createStudioController(signal: AbortSignal | undefined, model: StudioModel, views: ViewHost) {
const lifetime = createLifetime(signal);
try {
    lifetime.signal.throwIfAborted();
    model.setAvailability({ ready: false, loading: true, busy: false });
    model.setCapture({ takeNumber: 1, recording: false, stopping: false, elapsed: 0 });
    const builtInPoseLibrary = await loadPoseLibrary();
    lifetime.signal.throwIfAborted();
    const builtInShotPresets = await loadBuiltInShots(builtInPoseLibrary);
    lifetime.signal.throwIfAborted();
    const poseStore = createPoseStore(builtInPoseLibrary);
    let poseLibrary = poseStore.catalog;
    let poses = Object.fromEntries(poseLibrary.poses.map((pose) => [pose.id, pose.joints]));
    const poseBrowser = createPoseBrowser(poseLibrary, (pose) => {
      rememberState();
      applyPose(pose.id);
      announce(`已切换为${pose.name}`);
      scheduleConfiguration();
    }, views);
    lifetime.defer(() => poseBrowser.dispose());

    const viewport = element<HTMLElement>('#viewport');
    const libraryClient = createLibraryClient();
    const library: ReturnType<typeof createLibrary> = createLibrary({ client: libraryClient, announce, views,
      onUse: (asset, image) => retouch.useAsset(asset, image),
      onDelete: id => retouch.removeAsset(id),
    });
    lifetime.defer(() => library.dispose());
    const retouch: ReturnType<typeof createRetouch> = createRetouch(() => takePhoto({ archive: false }), {
      client: libraryClient, library, views, onBusyChange: model.setRetouchBusy,
    });
    lifetime.defer(() => retouch.dispose());

    const runtime = createStudioRuntime({
      viewport, pixelRatio: Math.min(window.devicePixelRatio, 2),
      update: delta => star.update(delta),
      canResize: () => !capture.isRecording,
      onResize: (width, height) => model.setResolution(`${width} × ${height}`),
    });
    lifetime.defer(runtime.dispose);
    const { scene, camera, renderer, composer, controls } = runtime;

    const studio = createStudio();
    scene.add(studio.group);

    const star = new Character(scene, camera, renderer.domElement, controls, onJointChange, rememberState, renderer.capabilities.getMaxAnisotropy());
    lifetime.defer(() => star.dispose());

    const lights = Object.fromEntries(lightDefinitions.map((definition) => {
      const rig = createStudioLight(definition, window.innerWidth < 700 ? 1024 : 2048);
      scene.add(rig.group);
      return [definition.id, rig];
    }));

    scene.add(new THREE.HemisphereLight('#ffffff', '#c8d7e0', 0.45));

    let currentPose = poseLibrary.defaultPose;
    let poseSaveTarget: string | null = currentPose;
    let backgroundData: string | null = null;
    let backgroundLoadVersion = 0;
    let poseCustomized = false;
    let modelLoading = false;
    lifetime.defer(() => { backgroundLoadVersion++; });
    const project = createProjectSession({
      capture: captureState,
      apply: applyProjectState,
      save: state => libraryClient.saveSettings('scene', { version: 1, state }),
      isBusy: () => modelLoading,
      onError: error => announce(error instanceof Error ? error.message : String(error)),
    });
    lifetime.defer(project.dispose);
    lifetime.defer(project.subscribe(() => {
      const state = project.getSnapshot();
      model.setAvailability({ ready: state.ready, busy: modelLoading || state.restoring });
      props.refresh();
      poseSaving.update();
      model.setPersistence({
        loading: '正在读取配置', 'load-error': '配置读取失败', unsaved: '配置尚未保存',
        restored: '已恢复本地配置', pending: '配置待保存', saving: '正在保存配置',
        saved: '配置已保存到本机', 'save-error': '配置保存失败',
      }[state.status]);
    }));

    const capture: ReturnType<typeof createCaptureController> = createCaptureController({
      renderer, composer, camera, character: star, floorMarks: studio.floorMarks,
      getAspect: () => model.getSnapshot().stage.aspect,
      isLoading: () => modelLoading || project.getSnapshot().restoring,
      setHelpersVisible: visible => props.setHelpersVisible(visible),
      onPhoto: async (image, name) => {
        retouch.setPhoto(image, name);
        announce('正在保存到拍摄相册…');
        await library.save('photo', image, name);
        announce('已存入拍摄相册');
      },
      onResize: () => { resizeViewport(); poseSaving.update(); },
      onStateChange: state => {
        const previous = model.getSnapshot().capture;
        model.setCapture(state);
        if (previous.recording !== state.recording || previous.takeNumber !== state.takeNumber) {
          poseSaving.update();
          props.refresh();
          syncJointControls();
        }
      },
      announce,
    });
    const { takePhoto, toggleRecording } = capture;
    const poseSaving = createPoseSaveControls({
      views,
      getEntry: () => poseLibrary.poses.find((pose) => pose.id === poseSaveTarget),
      getFolders: () => [...new Set(poseLibrary.poses.map((pose) => pose.folder))],
      capturePose: () => star.capturePose(),
      isAvailable: () => !modelLoading && !project.getSnapshot().restoring && !!star.vrm && !capture.isRecording,
      save: (snapshot) => saveLibraryPose(snapshot),
      saveAs: (details, snapshot) => saveLibraryPose(snapshot, details),
      announce,
    });
    lifetime.defer(() => poseSaving.dispose());
    const props: ReturnType<typeof createPropsController> = createPropsController({
      views,
      scene, camera, canvas: renderer.domElement, orbit: controls, root: element<HTMLElement>('#prop-controls'),
      canPick: () => !star.editing,
      onSelect: () => model.selectTool('props'),
      onBeforeChange: rememberState, onChange: scheduleConfiguration,
      onFrame: () => frameCharacter('scene'),
      isAvailable: () => !modelLoading && !project.getSnapshot().restoring && !capture.isRecording,
      announce,
    });
    lifetime.defer(() => props.dispose());
    lifetime.defer(() => capture.dispose());

    const shotBrowser = createShotBrowser({
      views,
      root: element<HTMLElement>('#panel-shots'), client: libraryClient,
      builtIns: builtInShotPresets,
      isAvailable: () => project.getSnapshot().ready && !modelLoading && !project.getSnapshot().restoring && !capture.isRecording,
      apply: async preset => {
        rememberState();
        if (!await restoreState(createShotProject(preset).state)) throw new Error('预设未恢复，请检查人物和背景资源');
        announce(`已应用预设“${preset.name}”，可微调或撤销`);
      },
    });
    lifetime.defer(() => shotBrowser.dispose());
    lifetime.defer(model.connect({
      run: runOperation,
      importFile,
      setCharacter: changeCharacter,
      setStage: patch => {
        rememberState();
        model.setStage(patch);
        if (patch.backdrop !== undefined) { studio.material.color.set(patch.backdrop); void setBackground(null); }
        if (patch.aspect !== undefined) lifetime.frame(resizeViewport);
        scheduleConfiguration();
      },
      beginEdit: rememberState,
      setPhotography: patch => { applyPhotography(patch); scheduleConfiguration(); },
      frame: mode => frameCharacter(mode),
      selectTool: panel => {
        props.setEditing(panel === 'props');
        if (panel !== 'poses') {
          star.setEditing(false);
          syncJointControls();
        }
      },
    }));

    applyPose(currentPose);
    applyPhotography(model.getSnapshot().photography);
    syncJointControls();
    controls.addEventListener('start', rememberState);
    lifetime.defer(() => controls.removeEventListener('start', rememberState));
    updateRigVisibility();
    resizeViewport();
    runtime.start();
    await switchCharacter('mannequinFemale', false);
    lifetime.signal.throwIfAborted();
    model.setAvailability({ loading: false });
    if (poseStore.warning) announce(poseStore.warning);
    try {
      const saved = await libraryClient.settings('scene');
      lifetime.signal.throwIfAborted();
      if (saved) {
        if (!validProject(saved, { poses, characters: CHARACTERS, lightDefinitions })) throw new Error('已存配置无效，未覆盖原始数据。');
        if (!await restoreState(saved.state)) throw new Error('配置中的人物或背景加载失败，未覆盖已存配置。');
      }
      lifetime.signal.throwIfAborted();
      project.activate(Boolean(saved));
    } catch (error) {
      lifetime.signal.throwIfAborted();
      project.failLoading();
      announce(error instanceof Error ? error.message : String(error));
    }
    controls.addEventListener('end', scheduleConfiguration);
    lifetime.defer(() => controls.removeEventListener('end', scheduleConfiguration));
    window.addEventListener('beforeunload', event => {
      const state = project.getSnapshot();
      if (state.dirty || state.saving || retouch.hasPendingChanges || library.hasPending) {
        event.preventDefault();
        event.returnValue = '';
      }
    }, { signal: lifetime.signal });
    return { dispose: lifetime.dispose };

    function scheduleConfiguration() {
      if (!lifetime.signal.aborted) project.changed();
    }

    function applyPose(name: string) {
      currentPose = name;
      poseSaveTarget = name;
      const entry = poseLibrary.poses.find((pose) => pose.id === name);
      if (!entry) throw new Error('姿势不存在');
      star.restorePose({
        format: 'studio-pose', version: 1, units: 'radians', joints: poses[name],
        rotation: entry.rotation ?? star.group.rotation.y,
        placement: entry.placement ?? { grounded: star.grounded, height: star.height },
      });
      syncPlacementControls();
      poseCustomized = false;
      syncJointControls();
      poseBrowser.setSelection(name);
      poseSaving.update();
    }

    function saveLibraryPose(snapshot: JointPose, details: { name: string; folder: string } | null = null) {
      const saved = details ? poseStore.saveAs(details, snapshot) : poseStore.save(poseSaveTarget ?? '', snapshot);
      rememberState();
      poseLibrary = poseStore.catalog;
      poses = Object.fromEntries(poseLibrary.poses.map((pose) => [pose.id, pose.joints]));
      poseBrowser.updateCatalog(poseLibrary, details ? { reveal: saved.id } : {});
      currentPose = saved.id;
      poseSaveTarget = saved.id;
      poseCustomized = false;
      poseBrowser.setSelection(saved.id);
      poseSaving.update();
      announce(`${details ? '已另存' : '已保存'}“${saved.name}”到本机姿势库`);
      scheduleConfiguration();
    }

    async function runOperation(operation: StudioOperation) {
      try {
        switch (operation) {
          case 'save': await project.save(); break;
          case 'export': saveProject(); break;
          case 'undo': await undo(); break;
          case 'reset': await resetStudio(); break;
          case 'photo': takePhoto(); break;
          case 'record': toggleRecording(); break;
          case 'library': library.open('photo'); break;
          case 'retouch': await retouch.open(); break;
          case 'exportPose': downloadJson(star.capturePose(), 'studio-pose.json'); break;
          case 'clearBackground': rememberState(); await setBackground(null); break;
          case 'resetJoint': rememberState(); star.setJoint(star.selected, poses[currentPose][star.selected] ?? [0, 0, 0]); onJointChange(star.selected); break;
        }
      } catch (error) { announce(error instanceof Error ? error.message : String(error)); }
    }

    async function importFile(kind: ImportKind, file: File) {
      if (kind === 'project') await loadProject(file);
      else if (kind === 'pose') await importPose(file);
      else await importBackground(file);
    }

    async function changeCharacter(patch: Partial<CharacterSettings>) {
      if (patch.id !== undefined) { await switchCharacter(patch.id); return; }
      if (patch.selected !== undefined) star.select(patch.selected);
      if (patch.mode !== undefined) { star.setEditMode(patch.mode); star.setEditing(true); model.setCharacter({ mode: patch.mode }); }
      if (patch.editing !== undefined) star.setEditing(patch.editing);
      if (patch.grounded !== undefined) { rememberState(); star.setGrounded(patch.grounded); }
      if (patch.rotation !== undefined) star.group.rotation.y = THREE.MathUtils.degToRad(patch.rotation);
      if (patch.height !== undefined) star.setHeight(patch.height);
      if (patch.angles) star.setJoint(star.selected, patch.angles.map(angle => THREE.MathUtils.degToRad(THREE.MathUtils.clamp(angle, -180, 180))) as Vector3Tuple);
      const edited = patch.grounded !== undefined || patch.rotation !== undefined || patch.height !== undefined || !!patch.angles;
      onJointChange(star.selected, edited);
    }

    function frameCharacter(mode: string, shot: FramingShot | null = null) {
      const bounds = star.getFramingBounds(mode);
      if (!bounds) return;
      if (mode === 'scene') bounds.union(props.getBounds());
      if (!shot) rememberState();
      applyPhotography({ autoOrbit: false });
      controls.enableDamping = false;
      controls.update();
      const frame = calculateFraming({ bounds, camera, target: controls.target, minDistance: controls.minDistance, lowAngle: mode === 'low', shot });
      controls.target.copy(frame.target);
      camera.position.copy(frame.position);
      controls.update();
      controls.enableDamping = true;
      const names: Record<string, string> = { full: '全身取景', half: '半身取景', face: '面部特写', low: '低机位仰拍', scene: '人物与全部道具取景' };
      scheduleConfiguration();
      announce(`已切换为${names[mode] ?? mode}`);
    }

    function applyPhotography(patch: Partial<PhotographySettings>) {
      model.setPhotography(patch);
      if (patch.focal !== undefined) camera.setFocalLength(patch.focal);
      if (patch.exposure !== undefined) renderer.toneMappingExposure = patch.exposure;
      if (patch.dof !== undefined) runtime.setDepthOfField(patch.dof);
      if (patch.autoOrbit !== undefined) { controls.autoRotate = patch.autoOrbit; controls.autoRotateSpeed = 0.6; }
      if (patch.removeShadows !== undefined) updateShadows();
      if (patch.showRigs !== undefined) updateRigVisibility();
      if (patch.lights) for (const [id, light] of Object.entries(patch.lights)) updateLight(id, light);
    }

    function updateLight(id: string, { enabled, intensity, color, position, height, depth }: LightSettings) {
      const rig = lights[id];
      rig.enabled = enabled;
      rig.light.intensity = enabled ? intensity * 8 : 0;
      rig.light.color.set(color);
      rig.glowMaterial.color.set(enabled ? color : '#222222');
      rig.light.position.set(position, height, depth);
      rig.stand.position.set(position, height / 2, depth);
      rig.stand.scale.y = height / 3.1;
      rig.fixture.position.copy(rig.light.position);
      rig.panel.position.copy(rig.light.position);
      rig.fixture.lookAt(rig.light.target.position);
      rig.panel.lookAt(rig.light.target.position);
      rig.panel.translateZ(0.071);
    }

    function resizeViewport() {
      if (lifetime.signal.aborted) return;
      runtime.resize();
    }

    function captureState(): ProjectState {
      return {
        ...model.getSnapshot().photography,
        props: props.capture(),
        pose: currentPose,
        poseSaveTarget,
        backdrop: `#${studio.material.color.getHexString()}`,
        aspect: model.getSnapshot().stage.aspect,
        cameraPosition: camera.position.toArray(),
        target: controls.target.toArray(),
        rotation: THREE.MathUtils.radToDeg(star.group.rotation.y),
        character: star.id,
        jointPose: star.capturePose(),
        poseCustomized,
        background: backgroundData,
      };
    }

    function rememberState() {
      if (!lifetime.signal.aborted) project.remember();
    }

    async function undo() {
      try {
        announce(await project.undo() ? '已撤销上一步' : '没有可撤销的操作');
      } catch (error) {
        announce(error instanceof Error ? error.message : String(error));
      }
    }

    function restoreState(state: ProjectState) {
      return project.restore(state);
    }

    async function applyProjectState(input: ProjectState) {
      const state = normalizeProjectState(input, lightDefinitions);
      const version = ++backgroundLoadVersion;
      let texture: THREE.Texture | null;
      try {
        texture = await loadBackground(state.background);
      } catch {
        if (version === backgroundLoadVersion) announce('背景图片无法解码，项目未恢复');
        return false;
      }
      if (lifetime.signal.aborted || version !== backgroundLoadVersion) { texture?.dispose(); return false; }
      if (state.character && state.character !== star.id && !await switchCharacter(state.character, false)) { texture?.dispose(); return false; }
      if (lifetime.signal.aborted || version !== backgroundLoadVersion) { texture?.dispose(); return false; }
      installBackground(state.background, texture);
      props.restore(state.props);
      const knownPose = Object.hasOwn(poses, state.pose);
      applyPose(knownPose ? state.pose : poseLibrary.defaultPose);
      studio.material.color.set(state.backdrop);
      model.setStage({ backdrop: state.backdrop, aspect: state.aspect });
      camera.position.fromArray(state.cameraPosition);
      controls.target.fromArray(state.target);
      applyPhotography({ focal: state.focal, exposure: state.exposure, dof: state.dof,
        autoOrbit: state.autoOrbit, showRigs: state.showRigs, removeShadows: state.removeShadows, lights: state.lights });
      star.group.rotation.y = THREE.MathUtils.degToRad(state.rotation);
      if (state.jointPose) {
        star.restorePose(state.jointPose);
      } else {
        star.setGrounded(true);
        for (const side of ['left', 'right'] as const) {
          const angles: Vector3Tuple = [...star.poseAngles[`${side}UpperArm`]];
          angles[2] += THREE.MathUtils.degToRad(state[`${side}Arm`]);
          star.setJoint(`${side}UpperArm`, angles);
        }
      }
      poseSaveTarget = !knownPose || state.poseSaveTarget === null ? null : state.pose;
      poseSaving.update();
      if (state.poseCustomized || !knownPose) onJointChange(star.selected);
      else syncJointControls();
      syncPlacementControls();
      lifetime.frame(resizeViewport);
      return true;
    }

    async function resetStudio() {
      rememberState();
      if (await restoreState(createDefaultState(poseLibrary.defaultPose, lightDefinitions))) announce('摄影棚已重置');
    }

    function announce(message: string) {
      if (lifetime.signal.aborted) return;
      model.setStatus(message);
    }

    function updateShadows() {
      renderer.shadowMap.enabled = !model.getSnapshot().photography.removeShadows;
      renderer.shadowMap.needsUpdate = true;
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material: THREE.Material) => { material.needsUpdate = true; });
      });
    }

    function updateRigVisibility() {
      const visible = model.getSnapshot().photography.showRigs;
      Object.values(lights).forEach((rig) => {
        rig.stand.visible = visible;
        rig.fixture.visible = visible;
        rig.panel.visible = visible;
      });
    }

    function loadBackground(data: string | null) {
      return data ? new THREE.TextureLoader().loadAsync(data) : Promise.resolve(null);
    }

    function installBackground(data: string | null, texture: THREE.Texture | null) {
      backgroundData = data;
      studio.photoBackdrop.material.map?.dispose();
      studio.photoBackdrop.material.map = texture;
      studio.photoBackdrop.material.needsUpdate = true;
      studio.photoBackdrop.visible = !!texture;
      if (texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
        const aspect = texture.image.width / texture.image.height;
        studio.photoBackdrop.scale.x = Math.min(1, aspect / (16 / 9));
        studio.photoBackdrop.scale.y = Math.min(1, (16 / 9) / aspect);
      }
    }

    async function setBackground(data: string | null) {
      if (lifetime.signal.aborted) return false;
      const version = ++backgroundLoadVersion;
      try {
        const texture = await loadBackground(data);
        if (lifetime.signal.aborted || version !== backgroundLoadVersion) { texture?.dispose(); return false; }
        installBackground(data, texture);
        scheduleConfiguration();
        return true;
      } catch (error) {
        if (!lifetime.signal.aborted && version === backgroundLoadVersion) {
          console.error(error);
          announce('背景图片无法解码，请选择 PNG、JPEG 或 WebP');
        }
        return false;
      }
    }

    async function importBackground(file: File) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
        announce('请选择 8 MB 以内的 PNG、JPEG 或 WebP');
        return;
      }
      const reader = new FileReader();
      reader.addEventListener('load', async () => {
        rememberState();
        if (typeof reader.result !== 'string') return;
        if (await setBackground(reader.result)) announce('背景图片已导入');
      }, { signal: lifetime.signal });
      reader.addEventListener('error', () => announce('读取背景图片失败'), { signal: lifetime.signal });
      reader.readAsDataURL(file);
    }

    function saveProject() {
      downloadJson({ version: 1, state: captureState() }, `studio-${Date.now()}.json`);
      announce('项目配置已导出，包含背景图片与摄影参数');
    }

    async function loadProject(file: File) {
      try {
        if (file.size > 13 * 1024 * 1024) throw new Error('Project too large');
        const project = JSON.parse(await file.text());
        if (lifetime.signal.aborted) return;
        if (!validProject(project, { poses, characters: CHARACTERS, lightDefinitions })) throw new Error('Invalid studio project');
        rememberState();
        if (await restoreState(project.state)) announce('项目已恢复');
      } catch (error) {
        console.error(error);
        announce('项目文件格式无效，当前场景未更改');
      }
    }

    function syncPlacementControls() {
      model.setCharacter({ grounded: star.grounded, height: Number(star.height.toFixed(3)), rotation: Number(THREE.MathUtils.radToDeg(star.group.rotation.y).toFixed(1)) });
    }

    function syncJointControls() {
      const angles = star.poseAngles[star.selected] ?? [0, 0, 0];
      syncPlacementControls();
      model.setCharacter({ id: star.id, selected: star.selected, editing: star.editing,
        jointAvailable: !!star.joints[star.selected], selectable: JOINTS.filter(([id]) => star.isJointSelectable(id)).map(([id]) => id),
        angles: angles.map(angle => Number(THREE.MathUtils.radToDeg(angle).toFixed(1))) as Vector3Tuple });
    }

    function onJointChange(id: string, edited = true) {
      if (edited) {
        poseCustomized = true;
        poseBrowser.setSelection(null);
        const entry = poseLibrary.poses.find((pose) => pose.id === poseSaveTarget);
        if (entry) poseBrowser.setCaption(`${entry.name} · 未保存`);
      }
      syncJointControls();
      if (edited) scheduleConfiguration();
    }

    async function switchCharacter(id: string, recordHistory = true) {
      if (lifetime.signal.aborted || modelLoading || !Object.hasOwn(CHARACTERS, id)) return false;
      if (!['mannequin', 'mannequinFemale', 'quaternius'].includes(id)) id = 'mannequinFemale';
      if (star.vrm && star.id === id) return true;
      if (recordHistory) rememberState();
      modelLoading = true;
      model.setAvailability({ busy: true });
      model.setCharacter({ credit: '正在加载人偶…' });
      poseSaving.update();
      props.refresh();
      try {
        await star.load(id);
        if (lifetime.signal.aborted) return false;
        model.setCharacter({ credit: CHARACTERS[id].credit });
        syncJointControls();
        announce(`${CHARACTERS[id].name} · ${Object.keys(star.joints).length} 个可编辑关节`);
        return true;
      } catch (error) {
        if (lifetime.signal.aborted) return false;
        model.setCharacter({ credit: star.vrm ? CHARACTERS[star.id].credit : '人偶加载失败' });
        announce(`人偶加载失败：${error instanceof Error ? error.message : String(error)}`);
        return false;
      } finally {
        modelLoading = false;
        if (!lifetime.signal.aborted) {
          model.setAvailability({ busy: project.getSnapshot().restoring });
          poseSaving.update();
          props.refresh();
          if (recordHistory) scheduleConfiguration();
        }
      }
    }

    function downloadJson(data: unknown, filename: string) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = lifetime.objectUrl(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      lifetime.timeout(() => lifetime.releaseUrl(url), 1000);
    }

    async function importPose(file: File) {
      try {
        if (file.size > 128 * 1024) throw new Error('姿势文件超过 128 KB');
        const pose = JSON.parse(await file.text());
        if (lifetime.signal.aborted) return;
        if (!validPose(pose)) throw new Error('请选择有效的 studio-pose JSON 文件');
        rememberState();
        star.restorePose(pose);
        syncPlacementControls();
        poseSaveTarget = null;
        poseSaving.update();
        onJointChange(star.selected);
        announce('姿势已导入');
      } catch (error) {
        announce(`未导入：${error instanceof Error ? error.message : String(error)}，当前姿势已保留`);
      }
    }

} catch (error) {
  lifetime.dispose();
  throw error;
}
}