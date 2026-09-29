import { useEffect, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { Button, Checkbox, Input, Select, Tooltip } from 'antd';
import { Clapperboard, Eye, ImagePlus, RefreshCw, Save, ScanEye, Trash2 } from 'lucide-react';
import { SHOT_CATEGORIES } from './shot-presets';
import { createShotModel } from './shot-model';
import type { ShotModel, ShotModelOptions } from './shot-model';
import type { ViewHost } from './react-view';
import { useStudio } from './studio-context';

export function ShotBrowser({ model }: { model: ShotModel }) {
  const { state: studio } = useStudio();
  const unavailable = !studio.ready || studio.busy || studio.capture.recording;
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const input = useRef<HTMLInputElement>(null);
  const selected = model.selected();
  const visible = model.visible();
  const categories = SHOT_CATEGORIES.map(value => ({ label: value, value }));
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (model.getSnapshot().busy || model.getSnapshot().draft) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [model]);

  return <div className="shot-browser" aria-busy={state.busy}>
    <section className="tool-section">
      <div className="section-heading"><span>PRESETS</span><h2>配置预设</h2></div>
      <Select id="shot-category" aria-label="预设分类" value={state.category} onChange={model.setCategory}
        options={[{ value: '', label: '全部分类' }, ...categories]} />
      <div id="shot-select" className="shot-picker">
        <Select id="shot-preset" aria-label="配置预设" showSearch optionFilterProp="label"
          placeholder="选择预设" notFoundContent="没有匹配的预设" listHeight={224}
          value={selected?.id} onChange={model.select}
          options={visible.map(item => ({ value: item.id, label: item.name }))} />
      </div>
      <p id="shot-empty" hidden={visible.length > 0}>暂无预设</p>
      <img id="shot-preview" className="shot-preview" alt="预设预览图" src={selected?.thumbnail} hidden={!selected} />
      <p id="shot-notes" className="shot-notes">{selected ? `${selected.sourceName}\n${selected.notes}` : ''}</p>
      <div className="prop-toolbar"><output id="shot-count">{model.builtIns.length ? `内置 ${model.builtIns.length} · 自存 ` : ''}{state.items.length} / 100</output>
        <Tooltip title="应用预设，替换姿势、道具、镜头和灯光"><Button id="shot-apply" className="icon-button" aria-label="应用配置预设"
          icon={<Clapperboard size={16} />} disabled={unavailable || state.busy || !selected} onClick={() => void model.applySelected()} /></Tooltip>
        <Tooltip title="删除预设"><Button id="shot-delete" className="icon-button" aria-label="删除预设" icon={<Trash2 size={16} />}
          disabled={state.busy || !state.loaded || !selected || model.builtInIds.has(selected.id)} onClick={() => void model.removeSelected()} /></Tooltip>
      </div>
      <p id="shot-library-status" role="status">{state.libraryStatus}</p>
    </section>
    <section className="tool-section">
      <div className="section-heading"><span>AI</span><h2>图片生成预设</h2>
        <Tooltip title="重新读取 AI 配置"><Button id="shot-config-refresh" className="icon-button" aria-label="重新读取 AI 配置"
          icon={<RefreshCw size={16} />} disabled={state.busy} onClick={() => void model.refreshConfig()} /></Tooltip></div>
      <p id="shot-ai-config" role="status">{state.configStatus}</p>
      <Button id="shot-upload" icon={<ImagePlus size={16} />} disabled={state.busy} loading={state.imageLoading} onClick={() => input.current?.click()}>上传单人图片</Button>
      <input id="shot-source-input" type="file" accept="image/png,image/jpeg" hidden ref={input} disabled={state.busy}
        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void model.upload(file); }} />
      <img id="shot-source-preview" className="shot-preview" alt="待分析的单人参考图" src={state.source?.thumbnail} hidden={!state.source} />
      <p id="shot-source-name" className="shot-notes">{state.source?.sourceName}</p>
      <Checkbox id="shot-consent" className="shot-consent" checked={state.consent} disabled={state.busy}
        onChange={event => model.setConsent(event.target.checked)}>我有权使用此图，同意上传至配置的 AI 服务并承担可能的费用</Checkbox>
      <Button id="shot-generate" type="primary" icon={<ScanEye size={16} />} disabled={state.busy || !state.source || !state.config?.configured || !state.consent}
        onClick={() => void model.generate()}>分析生成</Button>
      <p id="shot-ai-status" role="status" aria-live="polite">{state.status}</p>
      <fieldset id="shot-result" hidden={!state.draft}><legend>生成结果 · 待确认</legend>
        <label htmlFor="shot-name">名称</label><Input id="shot-name" maxLength={80} value={state.draft?.name ?? ''}
          disabled={state.busy} onChange={event => model.editDraft({ name: event.target.value })} />
        <label htmlFor="shot-result-category">分类</label><Select id="shot-result-category" aria-label="生成预设分类" options={categories}
          value={state.draft?.category} disabled={state.busy} onChange={category => model.editDraft({ category })} />
        <p id="shot-result-notes" className="shot-notes">{state.draft?.notes}</p>
        <div className="prop-toolbar"><Tooltip title="在场景中预览生成配置"><Button id="shot-preview-result" className="icon-button"
          aria-label="预览生成配置" icon={<Eye size={16} />} disabled={unavailable || state.busy || !state.draft} onClick={() => void model.previewDraft()} /></Tooltip>
          <Button id="shot-save-result" icon={<Save size={16} />} disabled={state.busy || !state.draft || !state.loaded || state.items.length >= 100}
            onClick={() => void model.saveDraft()}>保存预设</Button></div>
      </fieldset>
    </section>
  </div>;
}

export function createShotBrowser({ root, views, ...options }: ShotModelOptions & { root: HTMLElement; views: ViewHost }) {
  const model = createShotModel(options);
  const view = views.mount(root, <ShotBrowser model={model} />);
  return { model, ready: model.ready.then(() => { flushSync(() => {}); }), dispose() { model.dispose(); view.dispose(); } };
}