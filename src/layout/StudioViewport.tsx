import { CaptureBar } from './CaptureBar';

export function Viewport() {
  return (<section className="stage-column" aria-label="3D 摄影棚视口">
      <div className="viewport-surface">
        <div className="viewport-frame" id="viewport-frame">
          <div id="viewport" role="img" aria-label="可交互的 3D 明星摄影棚"></div>
          <div className="viewfinder" aria-hidden="true">
            <i className="corner corner-tl"></i><i className="corner corner-tr"></i>
            <i className="corner corner-bl"></i><i className="corner corner-br"></i>
            <span className="focus-mark"></span>
          </div>
          <div className="viewport-meta viewport-meta-top"><span>CAM A</span><span id="lens-readout">50 MM</span></div>
          <div className="viewport-meta viewport-meta-bottom"><span>LIVE VIEW</span><span id="resolution-readout">-- × --</span></div>
          <div className="recording-indicator" id="recording-indicator" hidden><span></span> REC <time id="record-time">00:00</time></div>
          <div className="loading-state" id="loading-state"><span></span><p>正在点亮摄影棚</p></div>
        </div>
        </div>
        <div className="stage-status">
          <div><span className="status-light"></span><strong>STUDIO LIVE</strong></div>
          <p id="status-message" role="status" aria-live="polite">摄影棚已就绪</p>
          <div className="camera-data"><span>ISO 100</span><span>1/125</span><span id="aperture-readout">f/5.6</span></div>
        </div>
        <CaptureBar />
      </section>);
}
