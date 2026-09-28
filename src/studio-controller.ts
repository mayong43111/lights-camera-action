import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Character, CHARACTERS } from './character';
import { JOINTS, validPose } from './pose-schema';
import { createDefaultState, validProject } from './project-schema';
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
import { isRecord } from './schema-utils';
import { createLifetime } from './lifetime';
import type { JointPose, NumericInput, ProjectState, Vector3Tuple } from './scene-types';

export async function createStudioController(signal?: AbortSignal) {
const lifetime = createLifetime(signal);
try {
    lifetime.signal.throwIfAborted();
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
    });
    lifetime.defer(() => poseBrowser.dispose());

    const viewport = element<HTMLElement>('#viewport');
    const viewportFrame = element<HTMLElement>('#viewport-frame');
    const statusMessage = element<HTMLElement>('#status-message');
    const libraryClient = createLibraryClient();
    const library: ReturnType<typeof createLibrary> = createLibrary({ client: libraryClient, announce,
      onUse: (asset, image) => retouch.useAsset(asset, image),
      onDelete: id => retouch.removeAsset(id),
    });
    lifetime.defer(() => library.dispose());
    const retouch: ReturnType<typeof createRetouch> = createRetouch(() => takePhoto({ archive: false }), { client: libraryClient, library });
    lifetime.defer(() => retouch.dispose());

    const scene = new THREE.Scene();
    lifetime.defer(() => disposeScene());
    scene.background = new THREE.Color('#eef2f4');

    const camera = new THREE.PerspectiveCamera(32, 1.5, 0.1, 100);
    camera.position.set(0.8, 2.1, 7.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    lifetime.defer(() => { renderer.setAnimationLoop(null); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.5;
    viewport.append(renderer.domElement);
    const environmentGenerator = new THREE.PMREMGenerator(renderer);
    const environmentRoom = new RoomEnvironment();
    const environmentTarget = environmentGenerator.fromScene(environmentRoom, 0.04);
    lifetime.defer(() => environmentTarget.dispose());
    scene.environment = environmentTarget.texture;
    scene.environmentIntensity = 0.45;
    environmentRoom.dispose();
    environmentGenerator.dispose();

    const controls = new OrbitControls(camera, renderer.domElement);
    lifetime.defer(() => controls.dispose());
    controls.target.set(0, 1.65, 0);
    controls.enableDamping = true;
    controls.minDistance = 0;
    controls.maxDistance = Infinity;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;

    const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: Math.min(4, renderer.capabilities.maxSamples),
    });
    const composer = new EffectComposer(renderer, renderTarget);
    lifetime.defer(() => { composer.passes.forEach(pass => pass.dispose()); composer.dispose(); });
    composer.addPass(new RenderPass(scene, camera));
    const bokehPass = new BokehPass(scene, camera, {
      focus: 9,
      aperture: 0.000001,
      maxblur: 0.002,
    });
    function hasBokehUniforms(value: object): value is Record<'focus' | 'aspect' | 'aperture' | 'maxblur', THREE.IUniform<number>> {
      return ['focus', 'aspect', 'aperture', 'maxblur'].every(name => {
        const uniform: unknown = Reflect.get(value, name);
        return isRecord(uniform) && typeof uniform.value === 'number';
      });
    }
    const bokehUniforms = (() => {
      const uniforms = bokehPass.uniforms;
      if (!hasBokehUniforms(uniforms)) throw new Error('景深参数未正确初始化');
      return uniforms;
    })();
    composer.addPass(bokehPass);
    bokehPass.enabled = false;
    composer.addPass(new OutputPass());

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
    let currentAspect = 1.5;
    let history: string[] = [];
    let isRestoringState = false;
    let backgroundData: string | null = null;
    let backgroundLoadVersion = 0;
    let previousFrameTime = 0;
    let poseCustomized = false;
    let modelLoading = false;
    let persistenceReady = false;
    let configurationTimer: ReturnType<typeof setTimeout> | undefined;
    let configurationSaving = 0;
    let configurationDirty = false;
    let configurationVersion = 0;
    lifetime.defer(() => { lifetime.clearTimer(configurationTimer); backgroundLoadVersion++; });

    const capture: ReturnType<typeof createCaptureController> = createCaptureController({
      renderer, composer, camera, character: star, floorMarks: studio.floorMarks,
      getAspect: () => currentAspect,
      isLoading: () => modelLoading,
      setHelpersVisible: visible => props.setHelpersVisible(visible),
      onPhoto: async (image, name) => {
        retouch.setPhoto(image, name);
        announce('正在保存到拍摄相册…');
        await library.save('photo', image, name);
        announce('已存入拍摄相册');
      },
      onResize: () => { resizeViewport(); poseSaving.update(); },
      announce,
    });
    const { takePhoto, toggleRecording } = capture;
    const poseSaving = createPoseSaveControls({
      getEntry: () => poseLibrary.poses.find((pose) => pose.id === poseSaveTarget),
      getFolders: () => [...new Set(poseLibrary.poses.map((pose) => pose.folder))],
      capturePose: () => star.capturePose(),
      isAvailable: () => !modelLoading && !!star.vrm && !capture.isRecording,
      save: (snapshot) => saveLibraryPose(snapshot),
      saveAs: (details, snapshot) => saveLibraryPose(snapshot, details),
      announce,
    });
    lifetime.defer(() => poseSaving.dispose());
    const props: ReturnType<typeof createPropsController> = createPropsController({
      scene, camera, canvas: renderer.domElement, orbit: controls, root: element<HTMLElement>('#prop-controls'),
      canPick: () => !star.editing,
      onSelect: () => element<HTMLElement>('#tab-props').click(),
      onBeforeChange: rememberState, onChange: scheduleConfiguration,
      onFrame: () => frameCharacter('scene'),
      isAvailable: () => !modelLoading && !isRestoringState && !capture.isRecording,
      announce,
    });
    lifetime.defer(() => props.dispose());
    lifetime.defer(() => capture.dispose());

    const shotBrowser = createShotBrowser({
      root: element<HTMLElement>('#panel-shots'), client: libraryClient,
      builtIns: builtInShotPresets,
      isAvailable: () => persistenceReady && !modelLoading && !isRestoringState && !capture.isRecording,
      apply: async preset => {
        rememberState();
        await restoreState(createShotProject(preset).state);
        announce(`已应用预设“${preset.name}”，可微调或撤销`);
      },
    });
    lifetime.defer(() => shotBrowser.dispose());

    applyPose(currentPose);
    buildLightControls();
    buildJointControls();
    bindInterface();
    window.lucide?.createIcons();
    updateRigVisibility();
    resizeViewport();
    renderer.setAnimationLoop(render);
    lifetime.defer(() => renderer.setAnimationLoop(null));
    await switchCharacter('mannequinFemale', false);
    lifetime.signal.throwIfAborted();
    element<HTMLElement>('#loading-state').classList.add('is-hidden');
    if (poseStore.warning) announce(poseStore.warning);
    try {
      const saved = await libraryClient.settings('scene');
      lifetime.signal.throwIfAborted();
      if (saved) {
        if (!validProject(saved, { poses, characters: CHARACTERS, lightDefinitions })) throw new Error('已存配置无效，未覆盖原始数据。');
        if (!await restoreState(saved.state)) throw new Error('配置中的人偶加载失败，未覆盖已存配置。');
      }
      lifetime.signal.throwIfAborted();
      persistenceReady = true;
      element<HTMLButtonElement>('#config-save').disabled = false;
      element<HTMLElement>('#persistence-status').textContent = saved ? '已恢复本地配置' : '配置尚未保存';
    } catch (error) {
      lifetime.signal.throwIfAborted();
      element<HTMLElement>('#persistence-status').textContent = '配置读取失败';
      announce(error instanceof Error ? error.message : String(error));
    }
    element<HTMLElement>('#config-save').addEventListener('click', saveConfiguration, { signal: lifetime.signal });
    element<HTMLElement>('.workspace').addEventListener('input', scheduleConfiguration, { signal: lifetime.signal });
    element<HTMLElement>('.workspace').addEventListener('change', scheduleConfiguration, { signal: lifetime.signal });
    element<HTMLElement>('.workspace').addEventListener('click', scheduleConfiguration, { signal: lifetime.signal });
    controls.addEventListener('end', scheduleConfiguration);
    lifetime.defer(() => controls.removeEventListener('end', scheduleConfiguration));
    window.addEventListener('beforeunload', event => {
      if (configurationDirty || configurationSaving || retouch.hasPendingChanges || library.hasPending) {
        event.preventDefault();
        event.returnValue = '';
      }
    }, { signal: lifetime.signal });
    return { dispose: lifetime.dispose };

    function scheduleConfiguration() {
      if (lifetime.signal.aborted || !persistenceReady || isRestoringState) return;
      configurationDirty = true;
      configurationVersion++;
      element<HTMLElement>('#persistence-status').textContent = '配置待保存';
      lifetime.clearTimer(configurationTimer);
      configurationTimer = lifetime.timeout(saveConfiguration, 750);
    }

    async function saveConfiguration() {
      lifetime.clearTimer(configurationTimer);
      configurationTimer = undefined;
      if (lifetime.signal.aborted || !persistenceReady) return;
      if (modelLoading || isRestoringState) {
        configurationTimer = lifetime.timeout(saveConfiguration, 500);
        return;
      }
      const version = configurationVersion;
      configurationSaving++;
      element<HTMLElement>('#persistence-status').textContent = '正在保存配置';
      try {
        await libraryClient.saveSettings('scene', { version: 1, state: captureState() });
        if (lifetime.signal.aborted) return;
        if (version === configurationVersion) {
          configurationDirty = false;
          element<HTMLElement>('#persistence-status').textContent = '配置已保存到本机';
        }
      } catch (error) {
        if (lifetime.signal.aborted) return;
        configurationDirty = true;
        element<HTMLElement>('#persistence-status').textContent = '配置保存失败';
        announce(error instanceof Error ? error.message : String(error));
      } finally { configurationSaving--; }
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
      const degrees = THREE.MathUtils.radToDeg(star.group.rotation.y);
      element<HTMLInputElement>('#star-rotation').value = String(degrees);
      element<HTMLOutputElement>('#rotation-output').value = `${Number(degrees.toFixed(1))}°`;
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
      window.lucide?.createIcons();
      announce(`${details ? '已另存' : '已保存'}“${saved.name}”到本机姿势库`);
      scheduleConfiguration();
    }

    function buildLightControls() {
      const container = element<HTMLElement>('#light-controls');
      lightDefinitions.forEach((definition) => {
        const article = element<HTMLElement>(`[data-light="${definition.id}"]`, container);
        article.dataset.light = definition.id;
        element<HTMLElement>('.light-index', article).textContent = definition.index;
        element<HTMLElement>('.light-name', article).textContent = definition.name;
        const intensity = element<HTMLInputElement>('.light-intensity', article);
        intensity.value = String(definition.intensity);
        const output = element<HTMLOutputElement>('.light-output', article);
        output.value = definition.intensity.toFixed(1);
        const color = element<HTMLInputElement>('.light-color', article);
        color.value = definition.color;
        const position = element<HTMLInputElement>('.light-position', article);
        position.value = String(definition.position[0]);
        element<HTMLInputElement>('.light-height', article).value = String(definition.position[1]);
        element<HTMLInputElement>('.light-depth', article).value = String(definition.position[2]);
        article.querySelectorAll('input').forEach((input) => {
          const label = input.closest('label')?.textContent?.trim() ?? '';
          input.setAttribute('aria-label', `${definition.name}${label}`);
        });
      });
    }

    function bindInterface() {
      window.addEventListener('studio:panel-change', event => {
        const panel = event.detail;
        if (!['cast', 'shots', 'poses', 'props', 'stage', 'camera', 'lights'].includes(panel)) return;
        props.setEditing(panel === 'props');
        if (panel !== 'poses') {
          star.setEditing(false);
          element<HTMLInputElement>('#edit-joints').checked = false;
        }
      }, { signal: lifetime.signal });
      element<HTMLElement>('#framing-controls').addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-framing]') : null;
        if (button?.dataset.framing && !modelLoading) frameCharacter(button.dataset.framing);
      }, { signal: lifetime.signal });
      element<HTMLElement>('#character-controls').addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-character]') : null;
        if (button?.dataset.character && !modelLoading && !capture.isRecording) switchCharacter(button.dataset.character);
      }, { signal: lifetime.signal });
      element<HTMLSelectElement>('#joint-select').addEventListener('change', () => { star.select(element<HTMLSelectElement>('#joint-select').value); syncJointControls(); }, { signal: lifetime.signal });
      element<HTMLInputElement>('#edit-joints').addEventListener('change', () => star.setEditing(element<HTMLInputElement>('#edit-joints').checked), { signal: lifetime.signal });
      element<HTMLInputElement>('#auto-ground').addEventListener('change', () => {
        rememberState();
        star.setGrounded(element<HTMLInputElement>('#auto-ground').checked);
        syncPlacementControls();
        onJointChange(star.selected);
      }, { signal: lifetime.signal });
      for (const selector of ['#character-height', '#character-height-value']) {
        const input = element<HTMLInputElement>(selector);
        input.addEventListener('pointerdown', rememberState, { signal: lifetime.signal });
        input.addEventListener('focus', rememberState, { signal: lifetime.signal });
        input.addEventListener('input', () => {
          if (input.value === '' || !Number.isFinite(Number(input.value))) return;
          star.setHeight(Number(input.value));
          syncPlacementControls();
          onJointChange(star.selected);
        }, { signal: lifetime.signal });
      }
      element<HTMLSelectElement>('#pose-mode').addEventListener('change', () => {
        const mode = element<HTMLSelectElement>('#pose-mode').value;
        star.setEditMode(mode);
        element<HTMLInputElement>('#edit-joints').checked = true;
        star.setEditing(true);
        syncJointControls();
        announce(mode === 'ik' ? '手脚 IK 拖拽已开启' : '关节旋转已开启');
      }, { signal: lifetime.signal });
      element<HTMLElement>('#joint-reset').addEventListener('click', () => {
        rememberState();
        star.setJoint(star.selected, poses[currentPose][star.selected] ?? [0, 0, 0]);
        onJointChange(star.selected);
      }, { signal: lifetime.signal });
      element<HTMLElement>('#pose-export').addEventListener('click', () => downloadJson(star.capturePose(), 'studio-pose.json'), { signal: lifetime.signal });
      element<HTMLElement>('#pose-import').addEventListener('click', () => element<HTMLInputElement>('#pose-input').click(), { signal: lifetime.signal });
      element<HTMLInputElement>('#pose-input').addEventListener('change', importPose, { signal: lifetime.signal });
      element<HTMLElement>('#backdrop-controls').addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-color]') : null;
        if (!button?.dataset.color || button.classList.contains('is-active')) return;
        rememberState();
        setActiveButton(button);
        studio.material.color.set(button.dataset.color);
        setBackground(null);
        announce('背景颜色已更新');
      }, { signal: lifetime.signal });

      element<HTMLElement>('#aspect-controls').addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-aspect]') : null;
        if (!button || button.classList.contains('is-active')) return;
        rememberState();
        setActiveButton(button);
        currentAspect = Number(button.dataset.aspect);
        document.documentElement.style.setProperty('--frame-aspect', String(currentAspect));
        lifetime.frame(resizeViewport);
        announce(`画幅已切换为 ${button.textContent}`);
      }, { signal: lifetime.signal });

      bindRange('#star-rotation', '#rotation-output', (value, output) => {
        star.group.rotation.y = THREE.MathUtils.degToRad(value);
        output.value = `${value}°`;
        if (!isRestoringState && star.vrm) onJointChange(star.selected);
      });
      bindRange('#focal-length', '#focal-output', (value, output) => {
        camera.setFocalLength(value);
        output.value = `${Math.round(value)} mm`;
        element<HTMLElement>('#lens-readout').textContent = `${Math.round(value)} MM`;
      });
      bindRange('#exposure', '#exposure-output', (value, output) => {
        renderer.toneMappingExposure = value;
        const ev = Math.log2(value);
        output.value = `${ev >= 0 ? '+' : ''}${ev.toFixed(1)} EV`;
      });
      bindRange('#depth-of-field', '#dof-output', (value, output) => {
        const strength = value / 100;
        bokehPass.enabled = value > 0;
        bokehUniforms.aperture.value = strength * 0.00008 + 0.000001;
        bokehUniforms.maxblur.value = strength * 0.012 + 0.001;
        output.value = value === 0 ? '关闭' : `${value}%`;
        element<HTMLElement>('#aperture-readout').textContent = value === 0 ? 'f/5.6' : `f/${(5.6 - strength * 4.2).toFixed(1)}`;
      });

      element<HTMLElement>('#light-controls').addEventListener('pointerdown', (event) => {
        if (event.target instanceof HTMLInputElement) rememberState();
      }, { signal: lifetime.signal });
      element<HTMLElement>('#light-controls').addEventListener('input', updateLightFromControl, { signal: lifetime.signal });
      element<HTMLElement>('#light-controls').addEventListener('change', updateLightFromControl, { signal: lifetime.signal });
      document.querySelectorAll('input').forEach((input) => input.addEventListener('keydown', (event) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Home', 'End'].includes(event.key)) rememberState();
      }, { signal: lifetime.signal }));
      element<HTMLInputElement>('#auto-orbit').addEventListener('change', () => {
        controls.autoRotate = element<HTMLInputElement>('#auto-orbit').checked;
        controls.autoRotateSpeed = 0.6;
      }, { signal: lifetime.signal });
      element<HTMLInputElement>('#show-rigs').addEventListener('change', updateRigVisibility, { signal: lifetime.signal });
      element<HTMLInputElement>('#remove-shadows').addEventListener('change', () => {
        rememberState();
        updateShadows();
      }, { signal: lifetime.signal });
      ['#auto-orbit', '#show-rigs'].forEach((selector) => element<HTMLElement>(selector).addEventListener('pointerdown', rememberState, { signal: lifetime.signal }));
      element<HTMLElement>('#save-button').addEventListener('click', saveProject, { signal: lifetime.signal });
      element<HTMLElement>('#load-button').addEventListener('click', () => element<HTMLInputElement>('#project-input').click(), { signal: lifetime.signal });
      element<HTMLInputElement>('#project-input').addEventListener('change', loadProject, { signal: lifetime.signal });
      element<HTMLElement>('#background-import').addEventListener('click', () => element<HTMLInputElement>('#background-input').click(), { signal: lifetime.signal });
      element<HTMLInputElement>('#background-input').addEventListener('change', importBackground, { signal: lifetime.signal });
      element<HTMLElement>('#background-clear').addEventListener('click', () => { rememberState(); setBackground(null); }, { signal: lifetime.signal });
      element<HTMLElement>('#photo-button').addEventListener('click', () => {
        try { takePhoto(); } catch (error) {
          console.error(error);
          announce('图片导出失败，请降低分辨率或更换浏览器');
        }
      }, { signal: lifetime.signal });
      element<HTMLElement>('#record-button').addEventListener('click', toggleRecording, { signal: lifetime.signal });
      element<HTMLElement>('#reset-button').addEventListener('click', resetStudio, { signal: lifetime.signal });
      element<HTMLElement>('#undo-button').addEventListener('click', undo, { signal: lifetime.signal });
      window.addEventListener('resize', resizeViewport, { signal: lifetime.signal });
      const observer = new ResizeObserver(resizeViewport);
      observer.observe(viewportFrame);
      lifetime.defer(() => observer.disconnect());
      controls.addEventListener('start', rememberState);
      lifetime.defer(() => controls.removeEventListener('start', rememberState));
    }

    function frameCharacter(mode: string, shot: { direction: Vector3Tuple; offset?: number } | null = null) {
      const bounds = star.getFramingBounds(mode);
      if (!bounds) return;
      if (mode === 'scene') bounds.union(props.getBounds());
      if (!shot) rememberState();
      controls.autoRotate = false;
      element<HTMLInputElement>('#auto-orbit').checked = false;
      controls.enableDamping = false;
      controls.update();
      const center = bounds.getCenter(new THREE.Vector3());
      const direction = shot ? new THREE.Vector3(...shot.direction).normalize() : camera.position.clone().sub(controls.target).normalize();
      if (mode === 'low') {
        direction.y = -0.16;
        direction.normalize();
      }
      const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
      const up = new THREE.Vector3().crossVectors(direction, right);
      const verticalSlope = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const horizontalSlope = verticalSlope * camera.aspect;
      let distance = controls.minDistance;
      for (const horizontal of [bounds.min.x, bounds.max.x]) {
        for (const vertical of [bounds.min.y, bounds.max.y]) {
          for (const depth of [bounds.min.z, bounds.max.z]) {
            const offset = new THREE.Vector3(horizontal, vertical, depth).sub(center);
            const clearance = Math.max(Math.abs(offset.dot(right)) / (horizontalSlope * (1 - Math.abs(shot?.offset ?? 0))), Math.abs(offset.dot(up)) / verticalSlope);
            distance = Math.max(distance, offset.dot(direction) + clearance * 1.12);
          }
        }
      }
      center.addScaledVector(right, (shot?.offset ?? 0) * distance * horizontalSlope);
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(direction, distance);
      controls.update();
      controls.enableDamping = true;
      const names: Record<string, string> = { full: '全身取景', half: '半身取景', face: '面部特写', low: '低机位仰拍', scene: '人物与全部道具取景' };
      announce(`已切换为${names[mode] ?? mode}`);
    }

    function bindRange(inputSelector: string, outputSelector: string, update: (value: number, output: HTMLOutputElement) => void) {
      const input = element<HTMLInputElement>(inputSelector);
      const output = element<HTMLOutputElement>(outputSelector);
      input.addEventListener('pointerdown', rememberState, { signal: lifetime.signal });
      input.addEventListener('input', () => update(Number(input.value), output), { signal: lifetime.signal });
      update(Number(input.value), output);
    }

    function updateLightFromControl(event: Event) {
      const article = event.target instanceof Element ? event.target.closest<HTMLElement>('.light-control') : null;
      if (!article?.dataset.light) return;
      const rig = lights[article.dataset.light];
      const enabled = element<HTMLInputElement>('.light-enabled', article).checked;
      const intensity = Number(element<HTMLInputElement>('.light-intensity', article).value);
      const color = element<HTMLInputElement>('.light-color', article).value;
      const x = Number(element<HTMLInputElement>('.light-position', article).value);
      const height = Number(element<HTMLInputElement>('.light-height', article).value);
      const depth = Number(element<HTMLInputElement>('.light-depth', article).value);
      rig.enabled = enabled;
      rig.light.intensity = enabled ? intensity * 8 : 0;
      rig.light.color.set(color);
      rig.glowMaterial.color.set(enabled ? color : '#222222');
      element<HTMLOutputElement>('.light-output', article).value = intensity.toFixed(1);
      rig.light.position.set(x, height, depth);
      rig.stand.position.set(x, height / 2, depth);
      rig.stand.scale.y = height / 3.1;
      rig.fixture.position.copy(rig.light.position);
      rig.panel.position.copy(rig.light.position);
      rig.fixture.lookAt(rig.light.target.position);
      rig.panel.lookAt(rig.light.target.position);
      rig.panel.translateZ(0.071);
    }

    function setActiveButton(button: HTMLElement) {
      button.parentElement?.querySelectorAll('.is-active').forEach((active) => active.classList.remove('is-active'));
      button.classList.add('is-active');
    }

    function resizeViewport() {
      if (lifetime.signal.aborted || capture.isRecording) return;
      const width = Math.max(1, viewport.clientWidth);
      const height = Math.max(1, viewport.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      bokehUniforms.aspect.value = camera.aspect;
      element<HTMLElement>('#resolution-readout').textContent = `${Math.round(width * renderer.getPixelRatio())} × ${Math.round(height * renderer.getPixelRatio())}`;
    }

    function render(time: number) {
      if (lifetime.signal.aborted) return;
      const delta = previousFrameTime ? Math.min((time - previousFrameTime) / 1000, 0.1) : 1 / 60;
      previousFrameTime = time;
      if (controls.enabled) controls.update(delta);
      const requiredFar = Math.max(100, camera.position.length() + controls.target.length() + 100);
      if (camera.far < requiredFar || camera.far > requiredFar * 4) {
        camera.far = requiredFar * 2;
        camera.updateProjectionMatrix();
      }
      star.update(delta);
      bokehUniforms.focus.value = camera.position.distanceTo(controls.target);
      composer.render();
    }

    function captureState(): ProjectState {
      return {
        props: props.capture(),
        pose: currentPose,
        poseSaveTarget,
        backdrop: `#${studio.material.color.getHexString()}`,
        aspect: currentAspect,
        cameraPosition: camera.position.toArray(),
        target: controls.target.toArray(),
        focal: element<HTMLInputElement>('#focal-length').value,
        exposure: element<HTMLInputElement>('#exposure').value,
        dof: element<HTMLInputElement>('#depth-of-field').value,
        rotation: element<HTMLInputElement>('#star-rotation').value,
        character: star.id,
        jointPose: star.capturePose(),
        poseCustomized,
        background: backgroundData,
        autoOrbit: element<HTMLInputElement>('#auto-orbit').checked,
        showRigs: element<HTMLInputElement>('#show-rigs').checked,
        removeShadows: !renderer.shadowMap.enabled,
        lights: Object.fromEntries([...document.querySelectorAll<HTMLElement>('.light-control')].map((article) => [article.dataset.light!, {
          enabled: element<HTMLInputElement>('.light-enabled', article).checked,
          intensity: element<HTMLInputElement>('.light-intensity', article).value,
          color: element<HTMLInputElement>('.light-color', article).value,
          position: element<HTMLInputElement>('.light-position', article).value,
          height: element<HTMLInputElement>('.light-height', article).value,
          depth: element<HTMLInputElement>('.light-depth', article).value,
        }])),
      };
    }

    function rememberState() {
      if (lifetime.signal.aborted || isRestoringState) return;
      scheduleConfiguration();
      const state = JSON.stringify(captureState());
      if (history.at(-1) !== state) history.push(state);
      if (history.length > 30) history.shift();
    }

    async function undo() {
      const state = history.pop();
      if (!state) {
        announce('没有可撤销的操作');
        return;
      }
      if (await restoreState(JSON.parse(state))) announce('已撤销上一步');
    }

    async function restoreState(state: ProjectState) {
      if (state.character && state.character !== star.id && !await switchCharacter(state.character, false)) return false;
      if (lifetime.signal.aborted) return false;
      isRestoringState = true;
      props.restore(state.props ?? []);
      const knownPose = Object.hasOwn(poses, state.pose);
      applyPose(knownPose ? state.pose : poseLibrary.defaultPose);
      studio.material.color.set(state.backdrop);
      document.querySelectorAll<HTMLElement>('[data-color]').forEach((button) => button.classList.toggle('is-active', button.dataset.color?.toLowerCase() === state.backdrop.toLowerCase()));
      document.documentElement.style.setProperty('--frame-aspect', String(state.aspect));
      currentAspect = Number(state.aspect);
      document.querySelectorAll<HTMLElement>('[data-aspect]').forEach((button) => button.classList.toggle('is-active', button.dataset.aspect === String(state.aspect)));
      camera.position.fromArray(state.cameraPosition);
      controls.target.fromArray(state.target);
      setRangeValue('#focal-length', state.focal);
      setRangeValue('#exposure', state.exposure);
      setRangeValue('#depth-of-field', state.dof);
      setRangeValue('#star-rotation', state.rotation ?? 0);
      if (state.jointPose) {
        setRangeValue('#star-rotation', THREE.MathUtils.radToDeg(state.jointPose.rotation));
        star.restorePose(state.jointPose);
        element<HTMLOutputElement>('#rotation-output').value = `${THREE.MathUtils.radToDeg(state.jointPose.rotation).toFixed(1)}°`;
      } else {
        star.setGrounded(true);
        for (const side of ['left', 'right'] as const) {
          const angles: Vector3Tuple = [...star.poseAngles[`${side}UpperArm`]];
          angles[2] += THREE.MathUtils.degToRad(Number(state[`${side}Arm`] ?? 0));
          star.setJoint(`${side}UpperArm`, angles);
        }
      }
      poseSaveTarget = !knownPose || state.poseSaveTarget === null ? null : state.pose;
      poseSaving.update();
      if (state.poseCustomized || !knownPose) onJointChange(star.selected);
      else syncJointControls();
      syncPlacementControls();
      element<HTMLInputElement>('#auto-orbit').checked = state.autoOrbit ?? false;
      controls.autoRotate = state.autoOrbit ?? false;
      controls.autoRotateSpeed = 0.6;
      element<HTMLInputElement>('#show-rigs').checked = state.showRigs ?? false;
      updateRigVisibility();
      element<HTMLInputElement>('#remove-shadows').checked = state.removeShadows ?? true;
      updateShadows();
      setBackground(state.background ?? null);
      Object.entries(state.lights).forEach(([id, lightState]) => {
        const article = element<HTMLElement>(`[data-light="${id}"]`);
        element<HTMLInputElement>('.light-enabled', article).checked = lightState.enabled;
        element<HTMLInputElement>('.light-intensity', article).value = String(lightState.intensity);
        element<HTMLInputElement>('.light-color', article).value = lightState.color;
        element<HTMLInputElement>('.light-position', article).value = String(lightState.position);
        const definition = lightDefinitions.find((light) => light.id === id);
        if (!definition) throw new Error('未知灯光配置');
        element<HTMLInputElement>('.light-height', article).value = String(lightState.height ?? definition.position[1]);
        element<HTMLInputElement>('.light-depth', article).value = String(lightState.depth ?? definition.position[2]);
        element<HTMLInputElement>('.light-intensity', article).dispatchEvent(new Event('input', { bubbles: true }));
      });
      lifetime.frame(resizeViewport);
      isRestoringState = false;
      scheduleConfiguration();
      return true;
    }

    function setRangeValue(selector: string, value: NumericInput) {
      const input = element<HTMLInputElement>(selector);
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    async function resetStudio() {
      rememberState();
      await restoreState(createDefaultState(poseLibrary.defaultPose, lightDefinitions));
      announce('摄影棚已重置');
    }

    function announce(message: string) {
      if (lifetime.signal.aborted) return;
      statusMessage.textContent = message;
    }

    function updateShadows() {
      renderer.shadowMap.enabled = !element<HTMLInputElement>('#remove-shadows').checked;
      renderer.shadowMap.needsUpdate = true;
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material: THREE.Material) => { material.needsUpdate = true; });
      });
    }

    function updateRigVisibility() {
      const visible = element<HTMLInputElement>('#show-rigs').checked;
      Object.values(lights).forEach((rig) => {
        rig.stand.visible = visible;
        rig.fixture.visible = visible;
        rig.panel.visible = visible;
      });
    }

    async function setBackground(data: string | null) {
      if (lifetime.signal.aborted) return;
      const version = ++backgroundLoadVersion;
      backgroundData = data;
      studio.photoBackdrop.visible = false;
      studio.photoBackdrop.material.map?.dispose();
      studio.photoBackdrop.material.map = null;
      studio.photoBackdrop.material.needsUpdate = true;
      if (!data) return;
      try {
        const texture = await new THREE.TextureLoader().loadAsync(data);
        if (lifetime.signal.aborted || version !== backgroundLoadVersion) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace;
        const aspect = texture.image.width / texture.image.height;
        studio.photoBackdrop.scale.x = Math.min(1, aspect / (16 / 9));
        studio.photoBackdrop.scale.y = Math.min(1, (16 / 9) / aspect);
        studio.photoBackdrop.material.map = texture;
        studio.photoBackdrop.material.needsUpdate = true;
        studio.photoBackdrop.visible = true;
      } catch (error) {
        if (version === backgroundLoadVersion) backgroundData = null;
        console.error(error);
        announce('背景图片无法解码，请选择 PNG、JPEG 或 WebP');
      }
    }

    async function importBackground(event: Event) {
      if (!(event.target instanceof HTMLInputElement)) return;
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
        announce('请选择 8 MB 以内的 PNG、JPEG 或 WebP');
        return;
      }
      const reader = new FileReader();
      reader.addEventListener('load', async () => {
        rememberState();
        if (typeof reader.result !== 'string') return;
        await setBackground(reader.result);
        if (backgroundData) announce('背景图片已导入');
      }, { signal: lifetime.signal });
      reader.addEventListener('error', () => announce('读取背景图片失败'), { signal: lifetime.signal });
      reader.readAsDataURL(file);
    }

    function saveProject() {
      downloadJson({ version: 1, state: captureState() }, `studio-${Date.now()}.json`);
      announce('项目配置已导出，包含背景图片与摄影参数');
    }

    async function loadProject(event: Event) {
      if (!(event.target instanceof HTMLInputElement)) return;
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
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

    function buildJointControls() {
      const select = element<HTMLSelectElement>('#joint-select');
      select.replaceChildren();
      for (const [id, , label] of JOINTS) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = label;
        select.append(option);
      }
      select.value = star.selected;
      ['x', 'y', 'z'].forEach((axis, index) => {
        for (const suffix of ['', '-value']) {
          const input = element<HTMLInputElement>(`#joint-${axis}${suffix}`);
          input.addEventListener('pointerdown', rememberState, { signal: lifetime.signal });
          input.addEventListener('focus', rememberState, { signal: lifetime.signal });
          input.addEventListener('input', () => {
            if (input.value === '' || !Number.isFinite(Number(input.value))) return;
            const angles: Vector3Tuple = [...star.poseAngles[star.selected]];
            angles[index] = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(Number(input.value), -180, 180));
            star.setJoint(star.selected, angles);
            onJointChange(star.selected);
          }, { signal: lifetime.signal });
        }
      });
    }

    function syncPlacementControls() {
      element<HTMLInputElement>('#auto-ground').checked = star.grounded;
      for (const selector of ['#character-height', '#character-height-value']) {
        const input = element<HTMLInputElement>(selector);
        input.value = String(Number(star.height.toFixed(3)));
        input.disabled = star.grounded;
      }
    }

    function syncJointControls() {
      const select = element<HTMLSelectElement>('#joint-select');
      if (!select) return;
      for (const option of select.options) {
        option.disabled = !star.isJointSelectable(option.value);
        option.hidden = false;
      }
      element<HTMLButtonElement>('#joint-reset').disabled = !star.joints[star.selected];
      select.value = star.selected;
      const angles = star.poseAngles[star.selected] ?? [0, 0, 0];
      ['x', 'y', 'z'].forEach((axis, index) => {
        const value = Number(THREE.MathUtils.radToDeg(angles[index]).toFixed(1));
        element<HTMLInputElement>(`#joint-${axis}`).value = String(value);
        element<HTMLInputElement>(`#joint-${axis}-value`).value = String(value);
        element<HTMLInputElement>(`#joint-${axis}`).disabled = !star.joints[star.selected];
        element<HTMLInputElement>(`#joint-${axis}-value`).disabled = !star.joints[star.selected];
      });
    }

    function onJointChange(id: string, edited = true) {
      if (edited) {
        poseCustomized = true;
        poseBrowser.setSelection(null);
        const entry = poseLibrary.poses.find((pose) => pose.id === poseSaveTarget);
        if (entry) poseBrowser.setCaption(`${entry.name} · 未保存`);
      }
      syncJointControls();
    }

    async function switchCharacter(id: string, recordHistory = true) {
      if (lifetime.signal.aborted || modelLoading || !Object.hasOwn(CHARACTERS, id)) return false;
      if (!['mannequin', 'mannequinFemale', 'quaternius'].includes(id)) id = 'mannequinFemale';
      if (star.vrm && star.id === id) return true;
      if (recordHistory) rememberState();
      modelLoading = true;
      element<HTMLElement>('#character-controls').setAttribute('aria-busy', 'true');
      element<HTMLElement>('#model-credit').textContent = '正在加载人偶…';
      const actions = ['#save-button', '#load-button', '#undo-button', '#reset-button', '#photo-button', '#record-button', '#pose-save', '#pose-save-as', '#shot-apply'];
      actions.forEach((selector) => { element<HTMLButtonElement>(selector).disabled = true; });
      try {
        await star.load(id);
        if (lifetime.signal.aborted) return false;
        for (const option of element<HTMLSelectElement>('#joint-select').options) option.disabled = !star.joints[option.value];
        document.querySelectorAll<HTMLElement>('[data-character]').forEach((button) => {
          button.classList.toggle('is-active', button.dataset.character === id);
          button.setAttribute('aria-pressed', String(button.dataset.character === id));
        });
        element<HTMLElement>('#model-credit').textContent = CHARACTERS[id].credit;
        syncJointControls();
        announce(`${CHARACTERS[id].name} · ${Object.keys(star.joints).length} 个可编辑关节`);
        return true;
      } catch (error) {
        if (lifetime.signal.aborted) return false;
        element<HTMLElement>('#model-credit').textContent = star.vrm ? CHARACTERS[star.id].credit : '人偶加载失败';
        announce(`人偶加载失败：${error instanceof Error ? error.message : String(error)}`);
        return false;
      } finally {
        modelLoading = false;
        if (!lifetime.signal.aborted) {
          element<HTMLElement>('#character-controls').setAttribute('aria-busy', 'false');
          actions.forEach((selector) => { element<HTMLButtonElement>(selector).disabled = false; });
          poseSaving.update();
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

    async function importPose(event: Event) {
      if (!(event.target instanceof HTMLInputElement)) return;
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        if (file.size > 128 * 1024) throw new Error('姿势文件超过 128 KB');
        const pose = JSON.parse(await file.text());
        if (lifetime.signal.aborted) return;
        if (!validPose(pose)) throw new Error('请选择有效的 studio-pose JSON 文件');
        rememberState();
        star.restorePose(pose);
        setRangeValue('#star-rotation', THREE.MathUtils.radToDeg(pose.rotation));
        syncPlacementControls();
        poseSaveTarget = null;
        poseSaving.update();
        onJointChange(star.selected);
        announce('姿势已导入');
      } catch (error) {
        announce(`未导入：${error instanceof Error ? error.message : String(error)}，当前姿势已保留`);
      }
    }

    function disposeScene() {
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        }
        if (object instanceof THREE.SpotLight || object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight) object.shadow.dispose();
      });
      for (const material of materials) for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      textures.forEach(texture => texture.dispose());
      materials.forEach(material => material.dispose());
      geometries.forEach(geometry => geometry.dispose());
      scene.clear();
      scene.environment = null;
    }
} catch (error) {
  lifetime.dispose();
  throw error;
}
}