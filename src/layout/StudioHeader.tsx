import { FileDown, FolderOpen, Images, RotateCcw, Save, Undo2, UserRound } from 'lucide-react';
import { StudioButton } from '../components/StudioControls';

export function Topbar() {
  return (<header className="topbar">
      <div className="brand-block">
        <span className="slate-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <div>
          <h1>灯光、摄影、开拍</h1>
          <p id="persistence-status" role="status">正在读取配置</p>
        </div>
      </div>

      <nav className="top-actions" aria-label="项目操作">
        <a className="icon-button" id="account-link" href="/account" title="账户与退出登录" aria-label="账户与退出登录" hidden><UserRound aria-hidden="true" size={16} /></a>
        <StudioButton className="icon-button" id="config-save" htmlType="button" title="保存当前配置" aria-label="保存当前配置" disabled><Save aria-hidden="true" size={16} /></StudioButton>
        <StudioButton className="icon-button" id="save-button" htmlType="button" title="导出项目配置" aria-label="导出项目配置"><FileDown aria-hidden="true" size={16} /></StudioButton>
        <StudioButton className="icon-button" id="library-open" htmlType="button" title="相册与素材" aria-label="相册与素材"><Images aria-hidden="true" size={16} /></StudioButton>
        <StudioButton className="icon-button" id="load-button" htmlType="button" title="打开项目" aria-label="打开项目"><FolderOpen aria-hidden="true" size={16} /></StudioButton>
        <input type="file" id="project-input" accept=".json,application/json" hidden />
        <StudioButton className="icon-button" id="undo-button" htmlType="button" title="撤销上一步" aria-label="撤销上一步"><Undo2 aria-hidden="true" size={16} /></StudioButton>
        <StudioButton className="icon-button" id="reset-button" htmlType="button" title="重置摄影棚" aria-label="重置摄影棚"><RotateCcw aria-hidden="true" size={16} /></StudioButton>
      </nav>
    </header>);
}

