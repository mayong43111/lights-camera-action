import { useRef, useState } from 'react';
import { Input, Select, Segmented } from 'antd';
import { ArrowLeft, ArrowRight, Check, Dices, PersonStanding, RotateCcw, ScanFace, Undo2, X } from 'lucide-react';
import { StudioButton, ControlledNumber, ControlledRange } from '../components/StudioControls';
import { useStudio } from '../studio-context';
import { selectPart } from '../character-parts';
import type { CharacterAppearance, CharacterCreation } from '../character-appearance';
import shapes from '../creator-shapes.json';

const steps = ['体型', '面容', '造型', '完成'];
const legacyKeys: Record<string, string> = { '圆润脸型': 'FaceRound', '方正脸型': 'FaceSquare', '体脂增加': 'BodyWeight', '体型纤细': 'BodySlim', '鼻翼宽度': 'NoseWidth', '鼻梁高度': 'NoseDepth', '嘴形宽度': 'MouthWidth', '眼睛大小': 'EyeSize' };
const presets: Record<string, Record<string, number>> = {
  '匀称': {}, '纤细': { BodyWeight: -0.45, BodyTorso: -0.2, BodyMuscle: -0.1 },
  '健壮': { BodyMuscle: 0.55, BodyShoulder: 0.45, BodyTorso: 0.2, BodyAbdomen: 0.3 },
  '丰满': { BodyWeight: 0.45, BodyHip: 0.2, BodyTorso: 0.1 },
  '自然': {}, '柔和': { FaceRound: 0.4, Jaw: -0.2, ChinWidth: -0.15, EyeSize: 0.15 },
  '棱角': { FaceSquare: 0.35, Jaw: 0.3, ChinWidth: 0.2, NoseDepth: 0.2 },
  '修长': { HeadHeight: 0.25, HeadWidth: -0.2, ChinHeight: 0.15, NoseWidth: -0.15 },
};
const palettes: Record<string, string[]> = {
  '肤色': ['#f4d6c2', '#e4b89c', '#cfa58e', '#ad795c', '#80533f', '#50352d'],
  '发色': ['#ffffff', '#282522', '#604535', '#a87645', '#d5bb85', '#813b35'],
  '眼睛': ['#ffffff', '#527278', '#50715c', '#6b4d32', '#8b8a87', '#383737'],
};
const otherColors = ['#ffffff', '#282c30', '#8d3b43', '#456d78', '#55745a', '#c3a765'];

function Adjustment({ label, value, min = -1, max = 1, initial = 0, disabled, onChange, id }: {
  label: string; value: number; min?: number; max?: number; initial?: number; disabled: boolean; id?: string; onChange(value: number): void;
}) {
  return <div className="creator-range">
    <div className="creator-range-heading"><span>{label}</span>
      <ControlledNumber label={`${label}数值`} min={min * 100} max={max * 100} step={1} value={Math.round(value * 100)} disabled={disabled}
        onBeforeChange={() => {}} onChange={next => onChange(next / 100)} /><span className="creator-unit">%</span>
      <StudioButton type="text" className="creator-reset" title={`重置${label}`} aria-label={`重置${label}`} disabled={disabled || value === initial}
        onClick={() => onChange(initial)} icon={<RotateCcw size={13} />} />
    </div>
    <ControlledRange id={id} label={label} min={min} max={max} step={0.01} value={value} disabled={disabled} onBeforeChange={() => {}} onChange={onChange} />
  </div>;
}

export function CharacterWorkshop({ creation, name, onName }: { creation: CharacterCreation; name: string; onName(name: string): void }) {
  const { actions } = useStudio(state => ({ ready: state.ready }));
  const [step, setStep] = useState(0);
  const [region, setRegion] = useState('轮廓');
  const [direction, setDirection] = useState('正面');
  const [preset, setPreset] = useState<Record<number, string>>({});
  const [history, setHistory] = useState<CharacterAppearance[]>([]);
  const [error, setError] = useState('');
  const initial = useRef(structuredClone(creation.appearance));
  const { appearance, saving } = creation;
  const morphs = new Map(creation.morphs.map(morph => [morph.key ?? legacyKeys[morph.name] ?? morph.name, morph]));
  const morphValue = (key: string, source = appearance) => {
    const morph = morphs.get(key);
    return morph ? source.morphs[morph.id] ?? morph.value : 0;
  };
  const negativeKey = (key: string) => key === 'BodyWeight' ? 'BodySlim' : `${key}Negative`;
  const valueOf = (key: string) => morphValue(key) - morphValue(negativeKey(key));
  function assign(next: CharacterAppearance, key: string, value: number) {
    const positive = morphs.get(key), negative = morphs.get(negativeKey(key));
    if (positive) next.morphs[positive.id] = Math.max(0, value);
    if (negative) next.morphs[negative.id] = Math.max(0, -value);
  }
  function change(next: CharacterAppearance) {
    setHistory(previous => [...previous.slice(-29), structuredClone(appearance)]);
    setError('');
    setPreset(previous => ({ ...previous, [step]: '' }));
    actions.setAppearance(next);
  }
  function changeValue(key: string, value: number) {
    const next = structuredClone(appearance);
    assign(next, key, value);
    change(next);
  }
  function move(next: number) {
    setStep(next);
    setDirection('正面');
    actions.previewCharacter(next === 1 ? 'face' : 'full', 'front');
  }
  function resetGroup(next: CharacterAppearance, original: CharacterAppearance) {
    for (const morph of creation.morphs) {
      if (step < 2 && morph.group === (step === 0 ? 'body' : 'face')) next.morphs[morph.id] = original.morphs[morph.id] ?? morph.value;
    }
    if (step === 0) { next.height = original.height; next.width = original.width; }
    if (step === 2) next.parts = structuredClone(original.parts);
    for (const color of creation.colors) if (color.group === (step === 0 ? 'body' : step === 1 ? 'face' : 'style')) {
      next.colors[color.id] = original.colors[color.id] ?? color.value;
    }
  }
  function applyPreset(label: string) {
    const next = structuredClone(appearance);
    resetGroup(next, { height: 1, width: 1, colors: {}, morphs: {} });
    next.colors = { ...appearance.colors };
    for (const [key, value] of Object.entries(presets[label])) assign(next, key, value);
    change(next);
    setPreset(previous => ({ ...previous, [step]: label }));
  }
  function randomize() {
    const next = structuredClone(appearance);
    if (step < 2) {
      for (const shape of shapes.filter(shape => shape.group === (step === 0 ? 'body' : 'face'))) assign(next, shape.key, Math.round((Math.random() - 0.5) * 70) / 100);
      if (step === 0) assign(next, 'BodyWeight', Math.round((Math.random() - 0.5) * 100) / 100);
      else { assign(next, 'FaceRound', 0); assign(next, 'FaceSquare', 0); }
    } else if (next.parts) {
      for (const group of next.parts.catalog.groups) {
        const option = group.options[Math.floor(Math.random() * group.options.length)];
        next.parts = selectPart(next.parts, group.id, option.id);
      }
      for (const color of creation.colors.filter(color => color.group === 'style')) {
        const palette = palettes[color.name] ?? otherColors;
        next.colors[color.id] = palette[Math.floor(Math.random() * palette.length)];
      }
    }
    change(next);
  }
  function colors(group: string) {
    return creation.colors.filter(color => color.group === group).map(color => {
      const value = appearance.colors[color.id] ?? color.value;
      const update = (next: string) => change({ ...appearance, colors: { ...appearance.colors, [color.id]: next } });
      return <fieldset className="creator-color" key={color.id}><legend>{color.name}</legend><div className="creator-swatches">
        {(palettes[color.name] ?? otherColors).map(swatch => <button type="button" key={swatch} title={`${color.name} ${swatch}`} aria-label={`${color.name} ${swatch}`}
          aria-pressed={value.toLowerCase() === swatch} style={{ backgroundColor: swatch }} disabled={saving} onClick={() => update(swatch)} />)}
        <input type="color" data-material-color={color.id} aria-label={`${color.name}颜色`} title={`自定义${color.name}`} value={value} disabled={saving} onChange={event => update(event.target.value)} />
      </div></fieldset>;
    });
  }
  function shapeControls(group: string, section?: string) {
    return shapes.filter(shape => shape.group === group && (!section || shape.section === section) && morphs.has(shape.key)).map(shape =>
      <Adjustment key={shape.key} label={shape.label} value={valueOf(shape.key)} min={morphs.has(negativeKey(shape.key)) ? -1 : 0}
        disabled={saving} onChange={value => changeValue(shape.key, value)} />);
  }
  const faceShape = morphValue('FaceRound') > 0 ? 'round' : morphValue('FaceSquare') > 0 ? 'square' : 'natural';
  return <section id="character-creator" className="workshop creator-editor" aria-label="角色创建">
    <header className="workshop-heading"><div><span>CHARACTER CREATION</span><h2>创建你的角色</h2></div>
      <StudioButton id="character-cancel" type="text" aria-label="取消制作" title="取消制作" disabled={saving} onClick={() => actions.run('cancelCharacter')} icon={<X size={18} />} />
    </header>
    <div className="workshop-navigation"><nav role="tablist" aria-label="创建步骤" className="workshop-steps">
      {steps.map((label, index) => <button key={label} type="button" role="tab" id={`creator-step-${index}`} aria-controls={`creator-page-${index}`}
        aria-selected={step === index} disabled={saving} onClick={() => move(index)}><span>{index + 2}</span>{label}</button>)}
    </nav><div className="workshop-tools" role="group" aria-label="人物预览">
      <StudioButton type="text" title="全身预览" aria-label="全身预览" disabled={saving} icon={<PersonStanding size={17} />} onClick={() => { setDirection('正面'); actions.previewCharacter('full', 'front'); }} />
      <StudioButton type="text" title="面部特写" aria-label="面部特写" disabled={saving} icon={<ScanFace size={17} />} onClick={() => { setDirection('正面'); actions.previewCharacter('face', 'front'); }} />
      <Segmented size="small" aria-label="预览方向" disabled={saving} value={direction} options={['正面', '左侧', '右侧', '背面']}
        onChange={value => { setDirection(value); actions.previewCharacter(step === 1 ? 'face' : 'full', ({ 正面: 'front', 左侧: 'left', 右侧: 'right', 背面: 'back' } as const)[value as '正面' | '左侧' | '右侧' | '背面']); }} />
    </div></div>
    <div className="workshop-content">
      {step < 3 && <div className="workshop-section-heading"><h3>{steps[step]}</h3><div>
        <StudioButton type="text" title="随机当前步骤" aria-label="随机当前步骤" disabled={saving} onClick={randomize} icon={<Dices size={16} />} />
        <StudioButton type="text" title="撤销外观调整" aria-label="撤销外观调整" disabled={saving || !history.length} icon={<Undo2 size={16} />} onClick={() => {
          const previous = history.at(-1); if (previous) { actions.setAppearance(previous); setHistory(history.slice(0, -1)); setPreset({}); }
        }} />
        <StudioButton type="text" title="重置当前步骤" aria-label="重置当前步骤" disabled={saving} icon={<RotateCcw size={16} />} onClick={() => {
          const next = structuredClone(appearance); resetGroup(next, initial.current); change(next);
        }} />
      </div></div>}
      <div id="creator-page-0" role="tabpanel" aria-labelledby="creator-step-0" hidden={step !== 0} className="workshop-fields">
        <label className="select-label">体型预设</label><Segmented block disabled={saving} value={preset[0] ?? ''} options={['匀称', '纤细', '健壮', '丰满']} onChange={applyPreset} />
        <Adjustment id="creation-height" label="身高比例" min={0.5} max={1.5} initial={1} value={appearance.height} disabled={saving} onChange={height => change({ ...appearance, height })} />
        <Adjustment id="creation-width" label="体型宽度" min={0.5} max={1.5} initial={1} value={appearance.width} disabled={saving} onChange={width => change({ ...appearance, width })} />
        <Adjustment label="胖瘦" value={valueOf('BodyWeight')} disabled={saving} onChange={value => changeValue('BodyWeight', value)} />
        {shapeControls('body')}{colors('body')}
      </div>
      <div id="creator-page-1" role="tabpanel" aria-labelledby="creator-step-1" hidden={step !== 1} className="workshop-fields">
        <label className="select-label">面容预设</label><Segmented block disabled={saving} value={preset[1] ?? ''} options={['自然', '柔和', '棱角', '修长']} onChange={applyPreset} />
        <Select aria-label="面部区域" disabled={saving} value={region} onChange={setRegion} options={['轮廓', '下颌', '眼睛', '鼻子', '嘴唇'].map(label => ({ label, value: label }))} />
        {region === '轮廓' && <><label className="select-label">脸型</label><Segmented block aria-label="脸型" disabled={saving} value={faceShape}
          options={[{ value: 'natural', label: '原始' }, { value: 'round', label: '圆润' }, { value: 'square', label: '方正' }]}
          onChange={value => { const next = structuredClone(appearance); assign(next, 'FaceRound', value === 'round' ? 0.5 : 0); assign(next, 'FaceSquare', value === 'square' ? 0.5 : 0); change(next); }} />
          {faceShape !== 'natural' && <Adjustment label="轮廓强度" min={0} value={morphValue(faceShape === 'round' ? 'FaceRound' : 'FaceSquare')} disabled={saving}
            onChange={value => changeValue(faceShape === 'round' ? 'FaceRound' : 'FaceSquare', value)} />}</>}
        {shapeControls('face', region)}{region === '眼睛' && colors('face')}
      </div>
      <div id="creator-page-2" role="tabpanel" aria-labelledby="creator-step-2" hidden={step !== 2} className="workshop-fields">
        {appearance.parts?.catalog.groups.map(group => <div className="workshop-part" key={group.id}>
          <label className="select-label" htmlFor={`part-${group.id}`}>{group.name}</label>
          <Select id={`part-${group.id}`} aria-label={group.name} value={appearance.parts?.selected[group.id] ?? ''} disabled={saving}
            options={[...(!group.required ? [{ value: '', label: '无' }] : []), ...group.options.map(option => ({ value: option.id, label: option.name }))]}
            onChange={value => { try { change({ ...appearance, parts: selectPart(appearance.parts!, group.id, value || null) }); } catch (failure) { setError(String(failure)); } }} />
        </div>)}{colors('style')}
      </div>
      <div id="creator-page-3" role="tabpanel" aria-labelledby="creator-step-3" hidden={step !== 3} className="workshop-fields">
        <h3>角色档案</h3><label className="select-label" htmlFor="character-name">人物名称</label>
        <Input id="character-name" maxLength={160} value={name} disabled={saving} onChange={event => onName(event.target.value)} />
        <dl className="workshop-summary"><dt>身高比例</dt><dd>{Math.round(appearance.height * 100)}%</dd><dt>体型宽度</dt><dd>{Math.round(appearance.width * 100)}%</dd>
          {appearance.parts?.catalog.groups.map(group => <div key={group.id}><dt>{group.name}</dt><dd>{group.options.find(option => option.id === appearance.parts?.selected[group.id])?.name ?? '无'}</dd></div>)}
          <dt>外观调整</dt><dd>{Object.values(appearance.morphs).filter(value => value !== 0).length} 项</dd>
        </dl>
      </div>
      {(error || creation.error) && <p role="alert">{error || creation.error}</p>}
    </div>
    <footer className="creator-footer workshop-footer">
      <StudioButton disabled={saving || step === 0} aria-label="上一步" onClick={() => move(step - 1)} icon={<ArrowLeft size={16} />} />
      <span>{step + 2} / 5</span>
      {step < 3 ? <StudioButton type="primary" id="creator-next" disabled={saving} onClick={() => move(step + 1)}>下一步<ArrowRight size={16} /></StudioButton>
        : <StudioButton id="character-finish" type="primary" loading={saving} disabled={saving || !name.trim()} onClick={() => actions.finishCharacter(name)}><Check size={16} />完成并入场</StudioButton>}
    </footer>
  </section>;
}