import { FileDown, FolderOpen, Images, RotateCcw, Save, Undo2, UserRound } from 'lucide-react';
import { StudioButton } from '../components/StudioControls';
import { useRef } from 'react';
import { useStudio } from '../studio-context';

export function Topbar() {
  const { state, actions } = useStudio();
  const projectInput = useRef<HTMLInputElement>(null);
  const disabled = state.loading || state.busy;
  const locked = disabled || state.capture.recording;
  return (<header className="topbar">
      <div className="brand-block">
        <span className="slate-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <div>
          <h1>灯光、摄影、开拍</h1>
          <p id="persistence-status" role="status">{state.persistence}</p>
        </div>
      </div>

      <nav className="top-actions" aria-label="项目操作">
        <a className="icon-button" id="account-link" href="/account" title={`${state.account ?? ''} · 账户与退出登录`} aria-label="账户与退出登录" hidden={!state.account}><UserRound aria-hidden="true" size={16} /></a>
        <StudioButton className="icon-button" id="config-save" title="保存当前配置" aria-label="保存当前配置" disabled={!state.ready || disabled} onClick={() => actions.run('save')}><Save aria-hidden="true" size={16} /></StudioButton>
        <StudioButton className="icon-button" id="save-button" title="导出项目配置" aria-label="导出项目配置" disabled={disabled} onClick={() => actions.run('export')}><FileDown aria-hidden="true" size={16} /></StudioButton>
        <StudioButton className="icon-button" id="library-open" title="相册与素材" aria-label="相册与素材" disabled={state.loading} onClick={() => actions.run('library')}><Images aria-hidden="true" size={16} /></StudioButton>
        <StudioButton className="icon-button" id="load-button" title="打开项目" aria-label="打开项目" disabled={locked} onClick={() => projectInput.current?.click()}><FolderOpen aria-hidden="true" size={16} /></StudioButton>
        <input type="file" id="project-input" accept=".json,application/json" hidden ref={projectInput} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) actions.importFile('project', file); }} />
        <StudioButton className="icon-button" id="undo-button" title="撤销上一步" aria-label="撤销上一步" disabled={locked} onClick={() => actions.run('undo')}><Undo2 aria-hidden="true" size={16} /></StudioButton>
        <StudioButton className="icon-button" id="reset-button" title="重置摄影棚" aria-label="重置摄影棚" disabled={locked} onClick={() => actions.run('reset')}><RotateCcw aria-hidden="true" size={16} /></StudioButton>
      </nav>
    </header>);
}

