import { Vector2 } from 'three';

export function createCaptureController({ renderer, composer, camera, character, floorMarks, getAspect, isLoading, onPhoto, onResize, announce, setHelpersVisible = () => {}, root = document, Recorder = globalThis.MediaRecorder }) {
  let takeNumber = 1;
  let recorder = null;
  let recordingTimer = null;
  let restoreRecordingUi = null;
  let finishRecording = null;

  function takePhoto({ archive = true, download } = {}) {
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
    const overlay = root.querySelector('.viewfinder');
    const overlayHidden = overlay.hidden;
    const wasEditing = character.editing;
    const marksVisible = floorMarks.visible;

    try {
      overlay.hidden = true;
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
        Promise.resolve(onPhoto(dataUrl, name)).catch(error => announce(error.message || '相册保存失败，请重试。'));
        takeNumber += 1;
        root.querySelector('#take-number').textContent = String(takeNumber).padStart(2, '0');
      }
      return { image: dataUrl, name };
    } finally {
      floorMarks.visible = marksVisible;
      renderer.setPixelRatio(previousRatio);
      renderer.setSize(previousSize.x, previousSize.y, false);
      composer.setSize(previousSize.x, previousSize.y);
      camera.aspect = previousAspect;
      camera.updateProjectionMatrix();
      overlay.hidden = overlayHidden;
      character.setEditing(wasEditing);
      setHelpersVisible(true);
    }
  }

  function startRecordingUi() {
    const wasEditing = character.editing;
    const lockedControls = [...root.querySelectorAll('#edit-joints, #pose-mode, [data-character], #photo-button, #reset-button, #load-button, #undo-button, #pose-save, #pose-save-as, #shot-apply, #prop-controls input, #prop-controls select, #prop-controls button, [data-aspect]')];
    const disabledStates = lockedControls.map((control) => control.disabled);
    restoreRecordingUi = () => {
      character.setEditing(wasEditing);
      setHelpersVisible(true);
      lockedControls.forEach((control, index) => { control.disabled = disabledStates[index]; });
    };
    character.setEditing(false);
    setHelpersVisible(false);
    lockedControls.forEach((control) => { control.disabled = true; });
    const button = root.querySelector('#record-button');
    button.classList.add('is-recording');
    button.setAttribute('aria-label', '停止录制');
    button.title = '停止录制';
    root.querySelector('#record-label').textContent = '停止录制';
    root.querySelector('#record-time').textContent = '00:00';
    root.querySelector('#recording-indicator').hidden = false;
    const startedAt = Date.now();
    recordingTimer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      root.querySelector('#record-time').textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
    }, 250);
  }

  function stopRecordingUi() {
    restoreRecordingUi?.();
    restoreRecordingUi = null;
    clearInterval(recordingTimer);
    recordingTimer = null;
    const button = root.querySelector('#record-button');
    button.disabled = false;
    button.classList.remove('is-recording');
    button.setAttribute('aria-label', '录制视频');
    button.title = '录制视频';
    root.querySelector('#record-label').textContent = '录制视频';
    root.querySelector('#recording-indicator').hidden = true;
    onResize();
  }

  function toggleRecording() {
    if (recorder?.state === 'recording') {
      root.querySelector('#record-button').disabled = true;
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
    const chunks = [];
    let stream;
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
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `lights-camera-recording-${Date.now()}.webm`;
        link.href = url;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  return { takePhoto, toggleRecording, get isRecording() { return recorder !== null; } };
}