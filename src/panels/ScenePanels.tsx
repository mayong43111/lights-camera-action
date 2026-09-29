import { useRef, useState, type CSSProperties } from "react";
import { Checkbox, Input, Modal, Select, Segmented, Tabs } from 'antd';
import { Check, Download, ImageOff, ImagePlus, RotateCcw, Upload, UserRoundPen, X, Ruler, ScanFace, Shirt, Plus } from "lucide-react";
import { StudioButton, ControlledRange, ControlledNumber } from "../components/StudioControls";
import { useStudio } from '../studio-context';
import { JOINTS } from '../pose-schema';
import type { Vector3Tuple } from '../scene-types';
import { selectPart } from '../character-parts';
import type { CharacterCreation } from '../character-appearance';
import { CharacterWorkshop } from './CharacterWorkshop';

function AppearanceSlider({ id, label, value, min = 0, max = 1, initial = 0, disabled, onChange }: {
  id?: string; label: string; value: number; min?: number; max?: number; initial?: number; disabled: boolean; onChange(value: number): void;
}) {
  return <div className="creator-range">
    <div className="creator-range-heading"><span>{label}</span>
      <ControlledNumber label={`${label}数值`} value={Math.round(value * 100)} min={min * 100} max={max * 100} step={1}
        disabled={disabled} onBeforeChange={() => {}} onChange={value => onChange(value / 100)} /><span className="creator-unit">%</span>
      <StudioButton className="creator-reset" type="text" aria-label={`重置${label}`} title={`重置${label}`} disabled={disabled || value === initial}
        onClick={() => onChange(initial)} icon={<RotateCcw size={13} aria-hidden="true" />} />
    </div>
    <ControlledRange id={id} label={label} value={value} min={min} max={max} step={0.01} disabled={disabled} onBeforeChange={() => {}} onChange={onChange} />
  </div>;
}

export function CreationPanel({ active = 'shots' }: { active?: string } = {}) {
  const { state, actions } = useStudio(state => ({ character: state.character, stage: state.stage,
    ready: state.ready, busy: state.busy, recording: state.capture.recording }));
  const character = state.character;
  const disabled = !state.ready || state.busy;
  const locked = disabled || state.recording;
  const range = { disabled, onBeforeChange: actions.beginEdit };
  const poseInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const characterInput = useRef<HTMLInputElement>(null);
  const partsInput = useRef<HTMLInputElement>(null);
  const [partsError, setPartsError] = useState('');
  const [characterFile, setCharacterFile] = useState<File | null>(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [creationName, setCreationName] = useState('定制人偶');
  const [morphSearch, setMorphSearch] = useState('');
  const [newCharacterOpen, setNewCharacterOpen] = useState(false);
  const [newCharacterBase, setNewCharacterBase] = useState('humanFemale');
  const [creationTab, setCreationTab] = useState('body');
  const creation = character.creation;
  const human = creation?.kind === 'human' || creation?.morphs.some(morph => morph.name === '圆润脸型');
  const groupOfColor = (color: CharacterCreation['colors'][number]) => color.group ?? (human ? ['肤色'].includes(color.name) ? 'body' : ['眼睛', '眉毛'].includes(color.name) ? 'face' : 'style' : 'body');
  const groupOfMorph = (morph: CharacterCreation['morphs'][number]) => morph.group ?? (['体脂增加', '体型纤细'].includes(morph.name) ? 'body' : 'face');
  const morphValue = (morph: CharacterCreation['morphs'][number] | undefined) => morph && creation ? creation.appearance.morphs[morph.id] ?? morph.value : 0;
  const fat = creation?.morphs.find(morph => morph.name === '体脂增加');
  const slim = creation?.morphs.find(morph => morph.name === '体型纤细');
  const round = creation?.morphs.find(morph => morph.name === '圆润脸型');
  const square = creation?.morphs.find(morph => morph.name === '方正脸型');
  const faceShape = morphValue(round) > 0 ? 'round' : morphValue(square) > 0 ? 'square' : 'natural';
  const updateMorphs = (values: Record<string, number>) => {
    if (creation) actions.setAppearance({ ...creation.appearance, morphs: { ...creation.appearance.morphs, ...values } });
  };
  const colorsFor = (group: string) => creation?.colors.filter(color => groupOfColor(color) === group).map((color, index) => {
    const value = creation.appearance.colors[color.id] ?? color.value;
    const name = color.name === 'Porcelain' ? /eyebrow/i.test(creation.meshes[index] ?? '') ? '眉毛' : /eye/i.test(creation.meshes[index] ?? '') ? '眼睛' : '身体' : color.name;
    const palette = name === '肤色' ? ['#f4d6c2', '#e4b89c', '#cfa58e', '#ad795c', '#80533f', '#50352d'] : ['#ffffff', '#24282b', '#715141', '#d3b179', '#8c3448', '#426974'];
    const change = (next: string) => actions.setAppearance({ ...creation.appearance, colors: { ...creation.appearance.colors, [color.id]: next } });
    return <fieldset className="creator-color" key={color.id}><legend>{name}</legend><div className="creator-swatches">
      {palette.map(swatch => <button type="button" key={swatch} style={{ backgroundColor: swatch }} aria-label={`${name} ${swatch}`}
        title={`${name} ${swatch}`} aria-pressed={value.toLowerCase() === swatch} disabled={creation.saving} onClick={() => change(swatch)} />)}
      <input type="color" aria-label={`${name}颜色`} title={`自定义${name}`} data-material-color={color.id} value={value} disabled={creation.saving} onChange={event => change(event.target.value)} />
      <StudioButton type="text" className="creator-reset" aria-label={`重置${name}`} title={`重置${name}`} disabled={creation.saving || value === color.value}
        onClick={() => change(color.value)} icon={<RotateCcw size={13} aria-hidden="true" />} />
    </div></fieldset>;
  });
  const morphsFor = (group: string) => creation?.morphs.filter(morph => groupOfMorph(morph) === group
    && !(human && [fat?.id, slim?.id, round?.id, square?.id].includes(morph.id)) && morph.name.toLowerCase().includes(morphSearch.toLowerCase()))
    .slice(0, 256).map(morph => <AppearanceSlider key={morph.id} label={morph.name} value={morphValue(morph)} initial={morph.value}
      disabled={creation.saving} onChange={value => updateMorphs({ [morph.id]: value })} />);
  const hasFace = !!creation?.morphs.some(morph => groupOfMorph(morph) === 'face') || !!creation?.colors.some(color => groupOfColor(color) === 'face');
  const hasStyle = !!creation?.appearance.parts?.catalog.groups.length || !!creation?.colors.some(color => groupOfColor(color) === 'style');
  return (<>
        <div id="panel-cast" role="tabpanel" aria-labelledby="tab-cast" hidden={active !== 'cast'}>
        <section className="tool-section" hidden={!!creation}>
          <div className="creator-entry"><div className="section-heading"><span>CREATE</span><h2>人物制作</h2></div>
            <StudioButton id="human-create" className="button full-width" type="primary" disabled={locked}
              onClick={() => { setNewCharacterBase(character.id === 'mannequin' || character.id === 'humanMale' ? 'humanMale' : 'humanFemale'); setNewCharacterOpen(true); }}
              icon={<Plus size={16} aria-hidden="true" />}>新建人物</StudioButton>
          </div>
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
          <div className="asset-actions">
            <StudioButton className="button" id="character-create" disabled={locked} onClick={() => { setCreationName('定制人偶'); setMorphSearch(''); setPartsError(''); setCreationTab('body'); actions.run('createCharacter'); }}><UserRoundPen aria-hidden="true" size={16} />编辑当前外观</StudioButton>
            <StudioButton className="button" id="character-import" disabled={locked} onClick={() => characterInput.current?.click()}><Upload aria-hidden="true" size={16} />导入 VRM</StudioButton>
            <StudioButton className="button" id="character-model-export" disabled={locked} onClick={() => actions.run('exportCharacterModel')}><Download aria-hidden="true" size={16} />导出 GLB</StudioButton>
          </div>
          <input type="file" id="character-input" accept=".vrm" hidden ref={characterInput} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (file) { setRightsConfirmed(false); setCharacterFile(file); }
          }} />
          {character.custom.length > 0 && <>
            <label className="select-label" htmlFor="custom-character">自定义人偶</label>
            <div className="asset-actions">
              <Select id="custom-character" aria-label="自定义人偶" showSearch optionFilterProp="label" style={{ flex: 1, minWidth: 0 }} disabled={locked}
                placeholder="选择人偶" value={character.id.startsWith('custom:') ? character.id : undefined}
                options={character.custom.map(asset => ({ value: `custom:${asset.id}`, label: asset.name }))}
                onChange={id => actions.setCharacter({ id })} />
              <StudioButton className="icon-button" id="character-export" aria-label="导出原始 VRM" title="导出原始 VRM" disabled={locked || !character.id.startsWith('custom:') || !!character.custom.find(asset => `custom:${asset.id}` === character.id)?.base} onClick={() => actions.run('exportCharacter')}><Download aria-hidden="true" size={16} /></StudioButton>
            </div>
          </>}
        </section>
        {creation && human && <CharacterWorkshop creation={creation} name={creationName} onName={setCreationName} />}
        {creation && !human && <section className="tool-section creator-editor" id="character-creator">
          <header className="creator-heading"><h2>{human ? '制作人物' : '编辑外观'}</h2><span>{human ? '完整人体' : '基础模型'}</span></header>
          <div className="creator-name"><label className="select-label" htmlFor="character-name">人物名称</label>
            <Input id="character-name" maxLength={160} value={creationName} disabled={creation.saving} onChange={event => setCreationName(event.target.value)} /></div>
          <Tabs className="creator-tabs" activeKey={creationTab === 'face' && !hasFace || creationTab === 'style' && !hasStyle ? 'body' : creationTab}
            onChange={setCreationTab} tabBarGutter={0} items={[
              { key: 'body', label: '体型', icon: <Ruler size={14} />, forceRender: true, children: <div className="creator-fields">
                <div className="creator-group-title">身体比例</div>
                {(['height', 'width'] as const).map(key => <AppearanceSlider key={key} id={`creation-${key}`} label={key === 'height' ? '身高比例' : '体型宽度'}
                  min={0.5} max={1.5} initial={1} value={creation.appearance[key]} disabled={creation.saving}
                  onChange={value => actions.setAppearance({ ...creation.appearance, [key]: value })} />)}
                {human && fat && slim && <AppearanceSlider label="胖瘦" min={-1} value={morphValue(fat) - morphValue(slim)} disabled={creation.saving}
                  onChange={value => updateMorphs({ [fat.id]: Math.max(0, value), [slim.id]: Math.max(0, -value) })} />}
                {morphsFor('body')}{colorsFor('body')}
              </div> },
              ...(hasFace ? [{ key: 'face', label: '面容', icon: <ScanFace size={14} />, forceRender: true, children: <div className="creator-fields">
                {human && round && square && <><div className="creator-group-title">脸型</div>
                  <Segmented block aria-label="脸型" disabled={creation.saving} value={faceShape}
                    options={[{ value: 'natural', label: '自然' }, { value: 'round', label: '圆润' }, { value: 'square', label: '方正' }]}
                    onChange={value => updateMorphs({ [round.id]: value === 'round' ? 0.5 : 0, [square.id]: value === 'square' ? 0.5 : 0 })} />
                  {faceShape !== 'natural' && <AppearanceSlider label="轮廓强度" value={faceShape === 'round' ? morphValue(round) : morphValue(square)}
                    disabled={creation.saving} onChange={value => updateMorphs({ [faceShape === 'round' ? round.id : square.id]: value })} />}
                </>}
                <div className="creator-group-title">五官</div>
                {creation.morphs.length > 12 && <Input aria-label="搜索变形项" placeholder="搜索" value={morphSearch} onChange={event => setMorphSearch(event.target.value)} />}
                {morphsFor('face')}{colorsFor('face')}
              </div> }] : []),
              ...(hasStyle ? [{ key: 'style', label: '造型', icon: <Shirt size={14} />, forceRender: true, children: <div className="creator-fields">
                {creation.appearance.parts?.catalog.groups.map(group => <div className="creator-part" key={group.id}>
                  <label className="select-label" htmlFor={`part-${group.id}`}>{group.name}</label>
                  <Select id={`part-${group.id}`} aria-label={group.name} style={{ width: '100%' }} disabled={creation.saving}
                    value={creation.appearance.parts?.selected[group.id] ?? ''}
                    options={[...(!group.required ? [{ value: '', label: '无' }] : []), ...group.options.map(option => ({ value: option.id, label: option.name }))]}
                    onChange={value => {
                      try { const parts = selectPart(creation.appearance.parts!, group.id, value || null); setPartsError(''); actions.setAppearance({ ...creation.appearance, parts }); }
                      catch (error) { setPartsError(error instanceof Error ? error.message : String(error)); }
                    }} />
                </div>)}
                {partsError && <p role="alert">{partsError}</p>}{colorsFor('style')}
              </div> }] : []),
            ]} />
          <input type="file" id="parts-input" accept=".json,application/json" hidden ref={partsInput} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''; setPartsError(''); setCreationTab('style');
            if (file) actions.importFile('parts', file);
          }} />
          <div className="creator-footer">
            <StudioButton id="character-finish" type="primary" className="button" loading={creation.saving} disabled={creation.saving || !creationName.trim()} onClick={() => actions.finishCharacter(creationName)}><Check aria-hidden="true" size={16} />完成并加入</StudioButton>
            <StudioButton id="character-cancel" className="button" disabled={creation.saving} onClick={() => actions.run('cancelCharacter')}><X aria-hidden="true" size={16} />取消</StudioButton>
          </div>
        </section>}
        <Modal title="新建人物 · 1 / 5" open={newCharacterOpen} okText="开始制作" cancelText="取消" okButtonProps={{ disabled: locked }}
          onCancel={() => setNewCharacterOpen(false)} onOk={() => {
            if (locked) return;
            setCreationName('定制人偶'); setMorphSearch(''); setPartsError(''); setCreationTab('body'); setNewCharacterOpen(false);
            actions.run(newCharacterBase === 'humanMale' ? 'createHumanMale' : 'createHumanFemale');
          }}>
          <label className="select-label" htmlFor="creator-base">基础人体</label>
          <Select id="creator-base" aria-label="人体底模" style={{ width: '100%' }} value={newCharacterBase}
            options={[{ value: 'humanFemale', label: '女性人体' }, { value: 'humanMale', label: '男性人体' }]} onChange={setNewCharacterBase} />
        </Modal>
        <Modal title="导入自定义人偶" open={!!characterFile} okText="导入" cancelText="取消" okButtonProps={{ disabled: locked || !rightsConfirmed }}
          onCancel={() => setCharacterFile(null)} onOk={() => { if (characterFile && rightsConfirmed && !locked) { actions.importFile('character', characterFile); setCharacterFile(null); } }}>
          <p style={{ overflowWrap: 'anywhere' }}>{characterFile?.name}</p>
          <Checkbox checked={rightsConfirmed} onChange={event => setRightsConfirmed(event.target.checked)}>我有权使用并保存该人偶及其包含的素材</Checkbox>
        </Modal>
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
