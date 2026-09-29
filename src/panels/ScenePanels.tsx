import { useRef, type CSSProperties } from "react";
import { Download, ImageOff, ImagePlus, RotateCcw, Upload } from "lucide-react";
import { StudioButton, ControlledRange, ControlledNumber } from "../components/StudioControls";
import { useStudio } from '../studio-context';
import { JOINTS } from '../pose-schema';
import type { Vector3Tuple } from '../scene-types';

export function CreationPanel({ active = 'shots' }: { active?: string } = {}) {
  const { state, actions } = useStudio();
  const character = state.character;
  const disabled = !state.ready || state.busy;
  const locked = disabled || state.capture.recording;
  const range = { disabled, onBeforeChange: actions.beginEdit };
  const poseInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  return (<>
        <div id="panel-cast" role="tabpanel" aria-labelledby="tab-cast" hidden={active !== 'cast'}>
        <section className="tool-section">
          <div className="section-heading"><span>CAST</span><h2>选择人偶</h2></div>
          <div className="character-grid" id="character-controls" aria-busy={state.busy}>
            {[
              ['mannequin', 'mannequin.png', '男性白模', '健硕人形'],
              ['mannequinFemale', 'mannequin-female.png', '女性白模', '基础人形'],
              ['quaternius', 'quaternius-original.png', '原模', 'Quaternius'],
            ].map(([id, image, name, description]) => <StudioButton key={id} className={`character-button${character.id === id ? ' is-active' : ''}`} data-character={id}
              aria-pressed={character.id === id} disabled={locked} onClick={() => actions.setCharacter({ id })}><img src={`./assets/characters/${image}`} alt={`${name}正面预览`} /><b>{name}</b><span>{description}</span></StudioButton>)}
          </div>
          <p className="model-credit" id="model-credit">{character.credit}</p>
        </section>
        </div>
        <div id="panel-shots" role="tabpanel" aria-labelledby="tab-shots" hidden={active !== 'shots'}>
        </div>
        <div id="panel-poses" role="tabpanel" aria-labelledby="tab-poses" hidden={active !== 'poses'}>
        <section className="tool-section">
          <div id="pose-library-home"></div>
          <div className="asset-actions pose-actions"><div className="pose-file-actions" role="group" aria-label="姿势保存与导入导出"><div id="pose-save-controls"></div><StudioButton className="icon-button" id="pose-import" title="导入姿势" aria-label="导入姿势" disabled={locked} onClick={() => poseInput.current?.click()}><Upload aria-hidden="true" size={16} /></StudioButton><StudioButton className="icon-button" id="pose-export" title="导出姿势" aria-label="导出姿势" disabled={disabled} onClick={() => actions.run('exportPose')}><Download aria-hidden="true" size={16} /></StudioButton></div></div>
          <input type="file" id="pose-input" accept=".json,application/json" hidden ref={poseInput} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) actions.importFile('pose', file); }} />
          <label className="range-control"><span><b>人物朝向</b><output id="rotation-output">{character.rotation}°</output></span><ControlledRange {...range} id="star-rotation" min={-180} max={180} step={1} value={character.rotation} label="人物朝向" onChange={rotation => actions.setCharacter({ rotation })} /></label>
          <label className="check-control"><input id="auto-ground" type="checkbox" checked={character.grounded} disabled={disabled} onChange={event => actions.setCharacter({ grounded: event.target.checked })} />自动贴地</label>
          <div className="joint-axis"><label htmlFor="character-height-value">人物高度 Y</label><ControlledNumber {...range} id="character-height-value" min={-1000} max={1000} step={0.05} value={character.height} label="人物高度" disabled={disabled || character.grounded} onChange={height => actions.setCharacter({ height })} /><ControlledRange {...range} id="character-height" min={-10} max={10} step={0.05} value={character.height} label="人物高度 Y" disabled={disabled || character.grounded} onChange={height => actions.setCharacter({ height })} /></div>
        </section>
        <section className="tool-section joint-section">
          <div className="section-heading"><span>RIG</span><h2>手动摆姿</h2></div>
          <label className="select-label" htmlFor="pose-mode">鼠标操作</label>
          <select id="pose-mode" value={character.mode} disabled={locked} onChange={event => actions.setCharacter({ mode: event.target.value as 'fk' | 'ik' })}><option value="fk">旋转关节 · FK</option><option value="ik">IK 拖拽 + 关节精调</option></select>
          <label className="select-label" htmlFor="joint-select">当前关节</label><select id="joint-select" value={character.selected} disabled={disabled} onChange={event => actions.setCharacter({ selected: event.target.value })}>{JOINTS.map(([id, , label]) => <option key={id} value={id} disabled={!character.selectable.includes(id)}>{label}</option>)}</select>
          <label className="check-control"><input id="edit-joints" type="checkbox" checked={character.editing} disabled={locked} onChange={event => actions.setCharacter({ editing: event.target.checked })} />显示姿势控制点</label>
          {(['X · 俯仰', 'Y · 扭转', 'Z · 侧摆'] as const).map((label, index) => {
            const axis = ['x', 'y', 'z'][index];
            const change = (value: number) => { const angles: Vector3Tuple = [...character.angles]; angles[index] = value; actions.setCharacter({ angles }); };
            return <div className="joint-axis" key={axis}><label htmlFor={`joint-${axis}-value`}>{label}</label><ControlledNumber {...range} id={`joint-${axis}-value`} min={-180} max={180} step={1} value={character.angles[index]} label={`${label}角度`} disabled={disabled || !character.jointAvailable} onChange={change} /><ControlledRange {...range} id={`joint-${axis}`} min={-180} max={180} step={1} value={character.angles[index]} label={`${label}角度`} disabled={disabled || !character.jointAvailable} onChange={change} /></div>;
          })}
          <StudioButton className="button full-width" id="joint-reset" disabled={locked || !character.jointAvailable} onClick={() => actions.run('resetJoint')}><RotateCcw aria-hidden="true" size={16} />重置当前关节</StudioButton>
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
            {['#edf4f6', '#7a7b78', '#151515', '#8c2530', '#315b74', '#1f674f'].map((color, index) => <StudioButton key={color} className={`swatch${state.stage.backdrop.toLowerCase() === color ? ' is-active' : ''}`} data-color={color} style={{ '--swatch': color } as CSSProperties} aria-label={['柔白背景', '中灰背景', '黑色背景', '红色背景', '蓝色背景', '绿幕背景'][index]} aria-pressed={state.stage.backdrop.toLowerCase() === color} disabled={disabled} onClick={() => actions.setStage({ backdrop: color })} />)}
          </div>
          <div className="asset-actions"><StudioButton className="button" id="background-import" disabled={locked} onClick={() => backgroundInput.current?.click()}><ImagePlus aria-hidden="true" size={16} />导入背景</StudioButton><StudioButton className="icon-button" id="background-clear" title="移除背景图" aria-label="移除背景图" disabled={disabled} onClick={() => actions.run('clearBackground')}><ImageOff aria-hidden="true" size={16} /></StudioButton></div>
          <input type="file" id="background-input" accept="image/png,image/jpeg,image/webp" hidden ref={backgroundInput} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) actions.importFile('background', file); }} />
        </section>

        <section className="tool-section">
          <div className="section-heading"><span>03</span><h2>画幅</h2></div>
          <div className="segmented" id="aspect-controls" role="group" aria-label="构图比例">
            {[[1.5, '3:2'], [1.333333, '4:3'], [1, '1:1'], [0.5625, '9:16']].map(([aspect, label]) => <StudioButton key={aspect} className={state.stage.aspect === Number(aspect) ? 'is-active' : ''} data-aspect={aspect} aria-pressed={state.stage.aspect === Number(aspect)} disabled={locked} onClick={() => actions.setStage({ aspect: Number(aspect) })}>{label}</StudioButton>)}
          </div>
        </section>
        </div>
      </>);
}
