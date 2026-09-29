import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createLifetime } from './lifetime';
import { isRecord } from './schema-utils';

interface RuntimeOptions {
  viewport: HTMLElement;
  pixelRatio: number;
  update(delta: number): void;
  canResize(): boolean;
  onResize(width: number, height: number): void;
}

export function createStudioRuntime({ viewport, pixelRatio, update, canResize, onResize }: RuntimeOptions) {
  const lifetime = createLifetime();
  try {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#eef2f4');
    lifetime.defer(() => disposeScene(scene));
    const camera = new THREE.PerspectiveCamera(32, 1.5, 0.1, 100);
    camera.position.set(0.8, 2.1, 7.5);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    lifetime.defer(() => { renderer.setAnimationLoop(null); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); });
    renderer.setPixelRatio(pixelRatio);
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.5;
    viewport.append(renderer.domElement);
    const environmentGenerator = new THREE.PMREMGenerator(renderer);
    const environmentRoom = new RoomEnvironment();
    try {
      const environment = environmentGenerator.fromScene(environmentRoom, 0.04);
      lifetime.defer(() => environment.dispose());
      scene.environment = environment.texture;
      scene.environmentIntensity = 0.45;
    } finally {
      environmentRoom.dispose();
      environmentGenerator.dispose();
    }
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
    const bokeh = new BokehPass(scene, camera, { focus: 9, aperture: 0.000001, maxblur: 0.002 });
    composer.addPass(bokeh);
    function hasBokehUniforms(value: object): value is Record<'focus' | 'aspect' | 'aperture' | 'maxblur', THREE.IUniform<number>> {
      return ['focus', 'aspect', 'aperture', 'maxblur'].every(name => {
        const uniform: unknown = Reflect.get(value, name);
        return isRecord(uniform) && typeof uniform.value === 'number';
      });
    }
    const uniforms = (() => {
      const value = bokeh.uniforms;
      if (!hasBokehUniforms(value)) throw new Error('景深参数未正确初始化');
      return value;
    })();
    bokeh.enabled = false;
    composer.addPass(new OutputPass());
    let previousFrameTime = 0;
    let started = false;
    function resize() {
      if (lifetime.signal.aborted || !canResize()) return;
      const width = Math.max(1, viewport.clientWidth);
      const height = Math.max(1, viewport.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      uniforms.aspect.value = camera.aspect;
      onResize(Math.round(width * renderer.getPixelRatio()), Math.round(height * renderer.getPixelRatio()));
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
      update(delta);
      uniforms.focus.value = camera.position.distanceTo(controls.target);
      composer.render();
    }
    return {
      scene, camera, renderer, composer, controls, resize, dispose: lifetime.dispose,
      start() {
        lifetime.signal.throwIfAborted();
        if (started) return;
        started = true;
        const observer = new ResizeObserver(resize);
        observer.observe(viewport);
        lifetime.defer(() => observer.disconnect());
        window.addEventListener('resize', resize, { signal: lifetime.signal });
        resize();
        renderer.setAnimationLoop(render);
        lifetime.defer(() => renderer.setAnimationLoop(null));
      },
      setDepthOfField(value: number) {
        const strength = value / 100;
        bokeh.enabled = value > 0;
        uniforms.aperture.value = strength * 0.00008 + 0.000001;
        uniforms.maxblur.value = strength * 0.012 + 0.001;
      },
    };
  } catch (error) {
    lifetime.dispose();
    throw error;
  }
}

function disposeScene(scene: THREE.Scene) {
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