import { MoveUpRight, PersonStanding, ScanFace, User } from "lucide-react";
import { StudioButton, StudioRange, LightControls } from "../components/StudioControls";

export function CameraPanel({ active = 'camera' }: { active?: string } = {}) {
  return (<>
        <div id="panel-camera" role="tabpanel" aria-labelledby="tab-camera" hidden={active !== 'camera'}>
        <section className="tool-section">
          <div className="section-heading"><span>CAMERA</span><h2>镜头预设与微调</h2></div>
          <div className="framing-controls" id="framing-controls" role="group" aria-label="人物取景">
            <StudioButton className="button" htmlType="button" data-framing="full" title="全身取景"><PersonStanding aria-hidden="true" size={16} />全身</StudioButton>
            <StudioButton className="button" htmlType="button" data-framing="half" title="半身取景"><User aria-hidden="true" size={16} />半身</StudioButton>
            <StudioButton className="button" htmlType="button" data-framing="face" title="面部特写"><ScanFace aria-hidden="true" size={16} />面部</StudioButton>
            <StudioButton className="button" htmlType="button" data-framing="low" title="低机位仰拍"><MoveUpRight aria-hidden="true" size={16} />仰拍</StudioButton>
          </div>
          <label className="range-control">
            <span><b>焦距</b><output id="focal-output">50 mm</output></span>
            <StudioRange id="focal-length" min="24" max="100" defaultValue="50" step="1" aria-label="焦距" />
          </label>
          <label className="range-control">
            <span><b>曝光</b><output id="exposure-output">-1.0 EV</output></span>
            <StudioRange id="exposure" min="0.125" max="2" defaultValue="0.5" step="0.025" aria-label="曝光" />
          </label>
          <label className="range-control">
            <span><b>景深</b><output id="dof-output">关闭</output></span>
            <StudioRange id="depth-of-field" min="0" max="100" defaultValue="0" step="1" aria-label="景深" />
          </label>
          <label className="check-control"><input type="checkbox" id="auto-orbit" />自动环绕运镜</label>
        </section>
        </div>
        <div id="panel-lights" role="tabpanel" aria-labelledby="tab-lights" hidden={active !== 'lights'}>
        <section className="tool-section lights-section">
          <div className="section-heading"><span>05</span><h2>摄影灯</h2></div>
          <label className="check-control"><input type="checkbox" id="remove-shadows" defaultChecked />去除影子</label>
          <label className="check-control"><input type="checkbox" id="show-rigs" />显示灯架</label>
          <LightControls />
        </section>
        </div>
      </>);
}
