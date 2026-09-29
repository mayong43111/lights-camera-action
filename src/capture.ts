import { Vector2 } from 'three';
import type { PerspectiveCamera, WebGLRenderer } from 'three';
import type { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { createLifetime } from './lifetime';

export interface CaptureState { takeNumber: number; recording: boolean; stopping: boolean; elapsed: number }

export interface CaptureOptions {
  renderer: Pick<WebGLRenderer, 'getSize' | 'getPixelRatio' | 'setPixelRatio' | 'setSize' | 'domElement'>;
  composer: Pick<EffectComposer, 'setSize' | 'render'>;
  camera: Pick<PerspectiveCamera, 'aspect' | 'updateProjectionMatrix'>;
  character: { vrm: unknown; editing: boolean; setEditing(enabled: boolean): void; update(delta: number): void };
  floorMarks: { visible: boolean };
  getAspect(): number;
  isLoading(): boolean;
  onPhoto(dataUrl: string, name: string): unknown;
  onResize(): void;
  announce(message: string): void;
  setHelpersVisible?(visible: boolean): void;
  onStateChange?(state: CaptureState): void;
  Recorder?: typeof MediaRecorder;
}

export function createCaptureController({ renderer, composer, camera, character, floorMarks, getAspect, isLoading, onPhoto, onResize, announce, setHelpersVisible = () => {}, onStateChange = () => {}, Recorder = globalThis.MediaRecorder }: CaptureOptions) {
  const lifetime = createLifetime();
  let takeNumber = 1;
  let recorder: MediaRecorder | null = null;
  let recordingTimer: number | null = null;
  let restoreRecordingUi: (() => void) | null = null;
  let finishRecording: (() => boolean) | null = null;
  let disposed = false;
  let state: CaptureState = { takeNumber, recording: false, stopping: false, elapsed: 0 };
  function publish(patch: Partial<CaptureState>) {
    state = { ...state, ...patch };
    if (!disposed) onStateChange(state);
  }

  function takePhoto({ archive = true, download }: { archive?: boolean; download?: boolean } = {}) {
    if (disposed) return;
    if (download === false) archive = false;
    if (isLoading() || !character.vrm) {
      announce('人偶正在加载，请稍后再拍摄');
      return;
    }
    if (recorder) {
      announce('请先停止录制再导出图片');
      return;
    }
    const aspect = getAspect();
    const width = aspect >= 1 ? 1920 : Math.round(1920 * aspect);
    const height = aspect >= 1 ? Math.round(1920 / aspect) : 1920;
    const previousSize = renderer.getSize(new Vector2());
    const previousRatio = renderer.getPixelRatio();
    const previousAspect = camera.aspect;
    const wasEditing = character.editing;
    const marksVisible = floorMarks.visible;

    try {
      character.setEditing(false);
      setHelpersVisible(false);
      floorMarks.visible = false;
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      character.update(0);
      composer.render();
      const dataUrl = renderer.domElement.toDataURL('image/png');
      const name = archive ? `lights-camera-${Date.now()}-take-${String(takeNumber).padStart(2, '0')}.png` : '当前场景.png';
      if (archive) {
        Promise.resolve(onPhoto(dataUrl, name)).catch(error => announce(error instanceof Error ? error.message : '相册保存失败，请重试。'));
        takeNumber += 1;
      }
      return { image: dataUrl, name };
    } finally {
      floorMarks.visible = marksVisible;
      renderer.setPixelRatio(previousRatio);
      renderer.setSize(previousSize.x, previousSize.y, false);
      composer.setSize(previousSize.x, previousSize.y);
      camera.aspect = previousAspect;
      camera.updateProjectionMatrix();
      character.setEditing(wasEditing);
      setHelpersVisible(true);
      publish({ takeNumber });
    }
  }

  function startRecordingUi() {
    const wasEditing = character.editing;
    restoreRecordingUi = () => {
      character.setEditing(wasEditing);
      setHelpersVisible(true);
    };
    character.setEditing(false);
    setHelpersVisible(false);
    publish({ recording: true, stopping: false, elapsed: 0 });
    const startedAt = Date.now();
    recordingTimer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      if (elapsed !== state.elapsed) publish({ elapsed });
    }, 250);
  }

  function stopRecordingUi() {
    restoreRecordingUi?.();
    restoreRecordingUi = null;
    if (recordingTimer !== null) clearInterval(recordingTimer);
    recordingTimer = null;
    publish({ recording: false, stopping: false });
    if (disposed) return;
    onResize();
  }

  function toggleRecording() {
    if (disposed) return;
    if (recorder?.state === 'recording') {
      publish({ stopping: true });
      try {
        recorder.stop();
      } catch (error) {
        finishRecording?.();
        console.error(error);
        announce('视频录制出错，请重试');
      }
      return;
    }
    if (recorder || isLoading() || !character.vrm) return;
    if (!renderer.domElement.captureStream || !Recorder) {
      announce('当前浏览器不支持视频录制，请使用最新版 Chrome 或 Edge');
      return;
    }
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((type) => Recorder.isTypeSupported(type));
    if (!mimeType) {
      announce('当前浏览器不支持 WebM 编码，请使用 Chrome 或 Edge');
      return;
    }
    const chunks: Blob[] = [];
    let stream: MediaStream | undefined;
    let finished = false;
    function finish() {
      if (finished) return false;
      finished = true;
      stream?.getTracks().forEach((track) => track.stop());
      recorder = null;
      finishRecording = null;
      stopRecordingUi();
      return true;
    }
    try {
      finishRecording = finish;
      startRecordingUi();
      composer.render();
      stream = renderer.domElement.captureStream(30);
      const activeRecorder = new Recorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
      recorder = activeRecorder;
      activeRecorder.addEventListener('dataavailable', (event) => { if (!finished && event.data.size) chunks.push(event.data); });
      activeRecorder.addEventListener('stop', () => {
        if (!finish()) return;
        const blob = new Blob(chunks, { type: activeRecorder.mimeType });
        if (!blob.size) {
          announce('未捕获到视频，请延长录制时间后重试');
          return;
        }
        const url = lifetime.objectUrl(blob);
        const link = document.createElement('a');
        link.download = `lights-camera-recording-${Date.now()}.webm`;
        link.href = url;
        link.click();
        lifetime.timeout(() => lifetime.releaseUrl(url), 1000);
        announce('视频已导出为 WebM');
      });
      activeRecorder.addEventListener('error', () => {
        if (finish()) announce('视频录制出错，请重试');
      });
      activeRecorder.start(1000);
      announce('正在录制，可继续调整镜头、姿势和灯光');
    } catch (error) {
      finish();
      console.error(error);
      announce('录制失败，当前浏览器或设备不支持此编码');
    }
  }

  return {
    takePhoto, toggleRecording, get isRecording() { return state.recording; },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifetime.dispose();
      const active = recorder;
      finishRecording?.();
      if (active && active.state !== 'inactive') {
        try { active.stop(); } catch {}
      }
    },
  };
}