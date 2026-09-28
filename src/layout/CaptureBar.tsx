import { useEffect, useState } from 'react';
import { Camera, Video, WandSparkles } from 'lucide-react';
import { StudioButton } from '../components/StudioControls';

export function CaptureBar() {
  const [retouchBusy, setRetouchBusy] = useState(false);
  useEffect(() => {
    const update = (event: CustomEvent<boolean>) => setRetouchBusy(event.detail);
    window.addEventListener('studio:retouch-busy', update);
    return () => window.removeEventListener('studio:retouch-busy', update);
  }, []);
  return <footer className="capture-bar" aria-label="拍摄控制">
    <div className="take-display" aria-label="当前场次"><span>TAKE</span><strong id="take-number">01</strong></div>
    <div className="capture-actions">
      <StudioButton className="button capture-primary" id="photo-button" htmlType="button" title="拍摄图片" aria-label="拍摄图片">
        <Camera aria-hidden="true" size={18} /><span className="action-label">拍摄图片</span>
      </StudioButton>
      <StudioButton className="button button-record" id="record-button" htmlType="button" title="录制视频" aria-label="录制视频">
        <Video aria-hidden="true" size={18} /><span className="action-label" id="record-label">录制视频</span>
      </StudioButton>
      <StudioButton className={`icon-button${retouchBusy ? ' is-working' : ''}`} id="retouch-open" htmlType="button" title="AI 修图" aria-label="AI 修图" aria-haspopup="dialog">
        <WandSparkles aria-hidden="true" size={18} />
      </StudioButton>
    </div>
  </footer>;
}