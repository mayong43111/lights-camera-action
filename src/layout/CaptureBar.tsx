import { Camera, Video, WandSparkles } from 'lucide-react';
import { StudioButton } from '../components/StudioControls';
import { useStudio } from '../studio-context';

export function CaptureBar() {
  const { state: { retouchBusy, capture, loading, busy }, actions } = useStudio();
  const recordLabel = capture.recording ? '停止录制' : '录制视频';
  return <footer className="capture-bar" aria-label="拍摄控制">
    <div className="take-display" aria-label="当前场次"><span>TAKE</span><strong id="take-number">{String(capture.takeNumber).padStart(2, '0')}</strong></div>
    <div className="capture-actions">
      <StudioButton className="button capture-primary" id="photo-button" htmlType="button" title="拍摄图片" aria-label="拍摄图片" disabled={loading || busy || capture.recording} onClick={() => actions.run('photo')}>
        <Camera aria-hidden="true" size={18} /><span className="action-label">拍摄图片</span>
      </StudioButton>
      <StudioButton className={`button button-record${capture.recording ? ' is-recording' : ''}`} id="record-button" htmlType="button" title={recordLabel} aria-label={recordLabel} disabled={loading || busy || capture.stopping} onClick={() => actions.run('record')}>
        <Video aria-hidden="true" size={18} /><span className="action-label" id="record-label">{recordLabel}</span>
      </StudioButton>
      <StudioButton className={`icon-button${retouchBusy ? ' is-working' : ''}`} id="retouch-open" htmlType="button" title="AI 修图" aria-label="AI 修图" aria-haspopup="dialog" disabled={loading} onClick={() => actions.run('retouch')}>
        <WandSparkles aria-hidden="true" size={18} />
      </StudioButton>
    </div>
  </footer>;
}