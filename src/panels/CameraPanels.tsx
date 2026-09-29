import { MoveUpRight, PersonStanding, ScanFace, User } from "lucide-react";
import { Button } from 'antd';
import { ControlledRange } from '../components/StudioControls';
import { useStudio } from '../studio-context';
import { LIGHT_DEFINITIONS } from '../studio-defaults';

export function CameraPanel({ active = 'camera' }: { active?: string } = {}) {
  const { state, actions } = useStudio(state => ({ photography: state.photography, ready: state.ready, busy: state.busy }));
  const settings = state.photography;
  const disabled = !state.ready || state.busy;
  const ev = Math.log2(settings.exposure);
  const range = { disabled, onBeforeChange: actions.beginEdit };
  return (<>
        <div id="panel-camera" role="tabpanel" aria-labelledby="tab-camera" hidden={active !== 'camera'}>
        <section className="tool-section">
          <div className="section-heading"><span>CAMERA</span><h2>镜头预设与微调</h2></div>
          <div className="framing-controls" id="framing-controls" role="group" aria-label="人物取景">
            <Button className="button" disabled={disabled} data-framing="full" title="全身取景" onClick={() => actions.frame('full')}><PersonStanding aria-hidden="true" size={16} />全身</Button>
            <Button className="button" disabled={disabled} data-framing="half" title="半身取景" onClick={() => actions.frame('half')}><User aria-hidden="true" size={16} />半身</Button>
            <Button className="button" disabled={disabled} data-framing="face" title="面部特写" onClick={() => actions.frame('face')}><ScanFace aria-hidden="true" size={16} />面部</Button>
            <Button className="button" disabled={disabled} data-framing="low" title="低机位仰拍" onClick={() => actions.frame('low')}><MoveUpRight aria-hidden="true" size={16} />仰拍</Button>
          </div>
          <label className="range-control">
            <span><b>焦距</b><output id="focal-output">{Math.round(settings.focal)} mm</output></span>
            <ControlledRange {...range} id="focal-length" min={24} max={100} value={settings.focal} step={1} label="焦距" onChange={focal => actions.setPhotography({ focal })} />
          </label>
          <label className="range-control">
            <span><b>曝光</b><output id="exposure-output">{ev >= 0 ? '+' : ''}{ev.toFixed(1)} EV</output></span>
            <ControlledRange {...range} id="exposure" min={0.125} max={2} value={settings.exposure} step={0.025} label="曝光" onChange={exposure => actions.setPhotography({ exposure })} />
          </label>
          <label className="range-control">
            <span><b>景深</b><output id="dof-output">{settings.dof === 0 ? '关闭' : `${settings.dof}%`}</output></span>
            <ControlledRange {...range} id="depth-of-field" min={0} max={100} value={settings.dof} step={1} label="景深" onChange={dof => actions.setPhotography({ dof })} />
          </label>
          <label className="check-control"><input type="checkbox" id="auto-orbit" disabled={disabled} checked={settings.autoOrbit} onChange={event => { actions.beginEdit(); actions.setPhotography({ autoOrbit: event.target.checked }); }} />自动环绕运镜</label>
        </section>
        </div>
        <div id="panel-lights" role="tabpanel" aria-labelledby="tab-lights" hidden={active !== 'lights'}>
        <section className="tool-section lights-section">
          <div className="section-heading"><span>05</span><h2>摄影灯</h2></div>
          <label className="check-control"><input type="checkbox" id="remove-shadows" disabled={disabled} checked={settings.removeShadows} onChange={event => { actions.beginEdit(); actions.setPhotography({ removeShadows: event.target.checked }); }} />去除影子</label>
          <label className="check-control"><input type="checkbox" id="show-rigs" disabled={disabled} checked={settings.showRigs} onChange={event => { actions.beginEdit(); actions.setPhotography({ showRigs: event.target.checked }); }} />显示灯架</label>
          <LightControls />
        </section>
        </div>
      </>);
}

function LightControls() {
  const { state, actions } = useStudio(state => ({ photography: state.photography, ready: state.ready, busy: state.busy }));
  const disabled = !state.ready || state.busy;
  return <div id="light-controls">{LIGHT_DEFINITIONS.map(definition => {
    const light = state.photography.lights[definition.id];
    const range = { disabled, onBeforeChange: actions.beginEdit };
    return <article className="light-control" key={definition.id} data-light={definition.id}>
      <header><div><span className="light-index">{definition.index}</span><b className="light-name">{definition.name}</b></div>
        <label className="switch"><input className="light-enabled" type="checkbox" aria-label={`${definition.name}开关`} disabled={disabled} checked={light.enabled} onChange={event => { actions.beginEdit(); actions.setLight(definition.id, { enabled: event.target.checked }); }} /><span /><em>开关</em></label></header>
      <label className="range-control compact"><span><b>亮度</b><output className="light-output">{light.intensity.toFixed(1)}</output></span>
        <ControlledRange {...range} className="light-intensity" min={0} max={12} step={0.1} value={light.intensity} label={`${definition.name}亮度`} onChange={intensity => actions.setLight(definition.id, { intensity })} /></label>
      <div className="light-row"><label className="color-control"><span>颜色</span><input className="light-color" type="color" aria-label={`${definition.name}颜色`} disabled={disabled} value={light.color} onFocus={actions.beginEdit} onChange={event => actions.setLight(definition.id, { color: event.target.value })} /></label>
        <label className="range-control compact position-control"><span><b>水平位置</b></span><ControlledRange {...range} className="light-position" min={-6} max={6} step={0.1} value={light.position} label={`${definition.name}水平位置`} onChange={position => actions.setLight(definition.id, { position })} /></label></div>
      <label className="range-control compact"><span><b>高度</b></span><ControlledRange {...range} className="light-height" min={1} max={6} step={0.1} value={light.height} label={`${definition.name}高度`} onChange={height => actions.setLight(definition.id, { height })} /></label>
      <label className="range-control compact"><span><b>前后位置</b></span><ControlledRange {...range} className="light-depth" min={-4} max={6} step={0.1} value={light.depth} label={`${definition.name}前后位置`} onChange={depth => actions.setLight(definition.id, { depth })} /></label>
    </article>;
  })}</div>;
}
