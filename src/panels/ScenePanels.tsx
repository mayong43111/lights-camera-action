import { type CSSProperties } from "react";
import { Download, ImageOff, ImagePlus, RotateCcw, Upload } from "lucide-react";
import { StudioButton, StudioRange } from "../components/StudioControls";

export function CreationPanel({ active = 'shots' }: { active?: string } = {}) {
  return (<>
        <div id="panel-cast" role="tabpanel" aria-labelledby="tab-cast" hidden={active !== 'cast'}>
        <section className="tool-section">
          <div className="section-heading"><span>CAST</span><h2>选择人偶</h2></div>
          <div className="character-grid" id="character-controls">
            <StudioButton htmlType="button" className="character-button" data-character="mannequin" aria-pressed="false"><img src="./assets/characters/mannequin.png" alt="男性白模正面预览" /><b>男性白模</b><span>健硕人形</span></StudioButton>
            <StudioButton htmlType="button" className="character-button is-active" data-character="mannequinFemale" aria-pressed="true"><img src="./assets/characters/mannequin-female.png" alt="女性白模正面预览" /><b>女性白模</b><span>基础人形</span></StudioButton>
            <StudioButton htmlType="button" className="character-button" data-character="quaternius" aria-pressed="false"><img src="./assets/characters/quaternius-original.png" alt="Quaternius 动画原模正面预览" /><b>原模</b><span>Quaternius</span></StudioButton>
          </div>
          <p className="model-credit" id="model-credit">正在加载白模</p>
        </section>
        </div>
        <div id="panel-shots" role="tabpanel" aria-labelledby="tab-shots" hidden={active !== 'shots'}>
        </div>
        <div id="panel-poses" role="tabpanel" aria-labelledby="tab-poses" hidden={active !== 'poses'}>
        <section className="tool-section">
          <div id="pose-library-home"></div>
          <div className="asset-actions pose-actions"><div className="pose-file-actions" role="group" aria-label="姿势保存与导入导出"><div id="pose-save-controls"></div><StudioButton htmlType="button" className="icon-button" id="pose-import" title="导入姿势" aria-label="导入姿势"><Upload aria-hidden="true" size={16} /></StudioButton><StudioButton htmlType="button" className="icon-button" id="pose-export" title="导出姿势" aria-label="导出姿势"><Download aria-hidden="true" size={16} /></StudioButton></div></div>
          <input type="file" id="pose-input" accept=".json,application/json" hidden />
          <label className="range-control"><span><b>人物朝向</b><output id="rotation-output">0°</output></span><StudioRange id="star-rotation" min="-180" max="180" step="1" defaultValue="0" aria-label="人物朝向" /></label>
          <label className="check-control"><input id="auto-ground" type="checkbox" defaultChecked />自动贴地</label>
          <div className="joint-axis"><label htmlFor="character-height">人物高度 Y</label><input id="character-height-value" type="number" min="-1000" max="1000" step="0.05" defaultValue="0" aria-label="人物高度" disabled /><StudioRange id="character-height" min="-10" max="10" step="0.05" defaultValue="0" aria-label="人物高度 Y" disabled /></div>
        </section>
        <section className="tool-section joint-section">
          <div className="section-heading"><span>RIG</span><h2>手动摆姿</h2></div>
          <label className="select-label" htmlFor="pose-mode">鼠标操作</label>
          <select id="pose-mode"><option value="fk">旋转关节 · FK</option><option value="ik">IK 拖拽 + 关节精调</option></select>
          <label className="select-label" htmlFor="joint-select">当前关节</label><select id="joint-select"></select>
          <label className="check-control"><input id="edit-joints" type="checkbox" />显示姿势控制点</label>
          <div className="joint-axis"><label htmlFor="joint-x">X · 俯仰</label><input id="joint-x-value" type="number" min="-180" max="180" step="1" defaultValue="0" aria-label="X 俯仰角度" /><StudioRange id="joint-x" min="-180" max="180" step="1" defaultValue="0" aria-label="X 俯仰角度" /></div>
          <div className="joint-axis"><label htmlFor="joint-y">Y · 扭转</label><input id="joint-y-value" type="number" min="-180" max="180" step="1" defaultValue="0" aria-label="Y 扭转角度" /><StudioRange id="joint-y" min="-180" max="180" step="1" defaultValue="0" aria-label="Y 扭转角度" /></div>
          <div className="joint-axis"><label htmlFor="joint-z">Z · 侧摆</label><input id="joint-z-value" type="number" min="-180" max="180" step="1" defaultValue="0" aria-label="Z 侧摆角度" /><StudioRange id="joint-z" min="-180" max="180" step="1" defaultValue="0" aria-label="Z 侧摆角度" /></div>
          <StudioButton htmlType="button" className="button full-width" id="joint-reset"><RotateCcw aria-hidden="true" size={16} />重置当前关节</StudioButton>
        </section>
        </div>
        <div id="panel-props" role="tabpanel" aria-labelledby="tab-props" hidden={active !== 'props'}>
          <section className="tool-section">
            <div className="section-heading"><span>PROPS</span><h2>场景道具</h2></div>
            <div id="prop-controls"></div>
          </section>
        </div>
        <div id="panel-stage" role="tabpanel" aria-labelledby="tab-stage" hidden={active !== 'stage'}>
        <section className="tool-section">
          <div className="section-heading"><span>02</span><h2>背景色</h2></div>
          <div className="swatch-grid" id="backdrop-controls" aria-label="选择背景色">
            <StudioButton className="swatch is-active" htmlType="button" data-color="#edf4f6" style={{"--swatch":"#edf4f6"} as CSSProperties} aria-label="柔白背景"></StudioButton>
            <StudioButton className="swatch" htmlType="button" data-color="#7a7b78" style={{"--swatch":"#7a7b78"} as CSSProperties} aria-label="中灰背景"></StudioButton>
            <StudioButton className="swatch" htmlType="button" data-color="#151515" style={{"--swatch":"#151515"} as CSSProperties} aria-label="黑色背景"></StudioButton>
            <StudioButton className="swatch" htmlType="button" data-color="#8c2530" style={{"--swatch":"#8c2530"} as CSSProperties} aria-label="红色背景"></StudioButton>
            <StudioButton className="swatch" htmlType="button" data-color="#315b74" style={{"--swatch":"#315b74"} as CSSProperties} aria-label="蓝色背景"></StudioButton>
            <StudioButton className="swatch" htmlType="button" data-color="#1f674f" style={{"--swatch":"#1f674f"} as CSSProperties} aria-label="绿幕背景"></StudioButton>
          </div>
          <div className="asset-actions"><StudioButton className="button" id="background-import" htmlType="button"><ImagePlus aria-hidden="true" size={16} />导入背景</StudioButton><StudioButton className="icon-button" id="background-clear" htmlType="button" title="移除背景图" aria-label="移除背景图"><ImageOff aria-hidden="true" size={16} /></StudioButton></div>
          <input type="file" id="background-input" accept="image/png,image/jpeg,image/webp" hidden />
        </section>

        <section className="tool-section">
          <div className="section-heading"><span>03</span><h2>画幅</h2></div>
          <div className="segmented" id="aspect-controls" role="group" aria-label="构图比例">
            <StudioButton className="is-active" htmlType="button" data-aspect="1.5">3:2</StudioButton>
            <StudioButton htmlType="button" data-aspect="1.333333">4:3</StudioButton>
            <StudioButton htmlType="button" data-aspect="1">1:1</StudioButton>
            <StudioButton htmlType="button" data-aspect="0.5625">9:16</StudioButton>
          </div>
        </section>
        </div>
      </>);
}
