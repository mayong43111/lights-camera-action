import { useRef, useState, useSyncExternalStore } from 'react';
import { AutoComplete, Button, Input, Modal, Tooltip } from 'antd';
import type { InputRef } from 'antd';
import { CopyPlus, Save } from 'lucide-react';
import type { ViewHost } from './react-view';
import type { JointPose, PoseEntry } from './scene-types';

interface PoseSaveOptions {
  views: ViewHost;
  getEntry(): PoseEntry | undefined;
  getFolders(): string[];
  capturePose(): JointPose;
  isAvailable(): boolean;
  save(pose: JointPose): unknown;
  saveAs(details: { name: string; folder: string }, pose: JointPose): unknown;
  announce(message: string): void;
  root?: ParentNode;
}

function createAvailability(options: PoseSaveOptions) {
  let state = { available: options.isAvailable(), entry: options.getEntry() };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update() {
      const available = options.isAvailable();
      const entry = options.getEntry();
      if (available === state.available && entry === state.entry) return;
      state = { available, entry };
      listeners.forEach(listener => listener());
    },
  };
}

function PoseSaveControls({ options, availability }: { options: PoseSaveOptions; availability: ReturnType<typeof createAvailability> }) {
  const state = useSyncExternalStore(availability.subscribe, availability.getSnapshot);
  const [snapshot, setSnapshot] = useState<JointPose | null>(null);
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const nameInput = useRef<InputRef>(null);
  const title = state.entry ? `保存“${state.entry.name}”` : '请先另存为新姿势';
  const report = (error: unknown) => error instanceof Error ? error.message : '姿势保存失败';
  const save = async () => {
    if (!options.isAvailable() || !options.getEntry() || saving) return;
    setSaving(true);
    try { await options.save(options.capturePose()); }
    catch (error) { options.announce(report(error)); }
    finally { setSaving(false); }
  };
  const open = () => {
    if (!options.isAvailable() || saving) return;
    try {
      const entry = options.getEntry();
      setSnapshot(structuredClone(options.capturePose()));
      setName(entry ? `${entry.name.slice(0, 75)} 副本` : '新姿势');
      setFolder(entry?.folder ?? '我的姿势');
      setError('');
    } catch (error) { options.announce(report(error)); }
  };
  const saveAs = async () => {
    if (!snapshot || !options.isAvailable() || saving) return;
    setSaving(true);
    try {
      await options.saveAs({ name, folder }, snapshot);
      setSnapshot(null);
    } catch (error) { setError(report(error)); }
    finally { setSaving(false); }
  };
  return <>
    <Tooltip title={title}><Button id="pose-save" className="icon-button" aria-label={title} icon={<Save size={16} />}
      disabled={!state.available || !state.entry || saving} onClick={() => void save()} /></Tooltip>
    <Tooltip title="另存为新姿势"><Button id="pose-save-as" className="icon-button" aria-label="另存为新姿势" aria-haspopup="dialog"
      icon={<CopyPlus size={16} />} disabled={!state.available || saving} onClick={open} /></Tooltip>
    <Modal title="另存为新姿势" open={snapshot !== null} footer={null} width={420} destroyOnHidden
      onCancel={() => { if (!saving) setSnapshot(null); }} maskClosable={!saving} keyboard={!saving} closable={!saving}
      afterOpenChange={open => { if (open) nameInput.current?.focus({ cursor: 'all' }); }}>
      <form id="pose-save-form" className="pose-save-form" onSubmit={event => { event.preventDefault(); void saveAs(); }}>
        <label htmlFor="pose-save-name">姿势名称</label><Input id="pose-save-name" ref={nameInput} maxLength={80} required autoComplete="off"
          value={name} disabled={saving} onChange={event => setName(event.target.value)} />
        <label htmlFor="pose-save-folder">分类</label><AutoComplete id="pose-save-folder" value={folder} options={options.getFolders().map(value => ({ value }))}
          filterOption={(input, option) => String(option?.value ?? '').toLocaleLowerCase().includes(input.trim().toLocaleLowerCase())}
          disabled={saving} onChange={setFolder}><Input maxLength={80} required /></AutoComplete>
        <p id="pose-save-error" role="alert">{error}</p>
        <footer><Button id="pose-save-cancel" disabled={saving} onClick={() => setSnapshot(null)}>取消</Button>
          <Button id="pose-save-submit" type="primary" htmlType="submit" icon={<Save size={16} />} loading={saving} disabled={!state.available}>保存</Button></footer>
      </form>
    </Modal>
  </>;
}

export function createPoseSaveControls(options: PoseSaveOptions) {
  const container = (options.root ?? document).querySelector<HTMLElement>('#pose-save-controls');
  if (!container) throw new Error('Missing pose save container');
  const availability = createAvailability(options);
  const view = options.views.mount(container, <PoseSaveControls options={options} availability={availability} />);
  return { update: availability.update, dispose: view.dispose };
}