import { useEffect, useRef, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { Box, Camera, Images, LampDesk, Layers, PanelLeftClose, PanelLeftOpen, PersonStanding, UserRound } from 'lucide-react';
import { CreationPanel } from '../panels/ScenePanels';
import { CameraPanel } from '../panels/CameraPanels';
import { Viewport } from './StudioViewport';

const tools = [
  { key: 'cast', label: '人物', Icon: UserRound },
  { key: 'shots', label: '组合', Icon: Layers },
  { key: 'poses', label: '姿势', Icon: PersonStanding },
  { key: 'props', label: '道具', Icon: Box },
  { key: 'stage', label: '布景', Icon: Images },
  { key: 'camera', label: '镜头', Icon: Camera },
  { key: 'lights', label: '灯光', Icon: LampDesk },
] as const;
type ToolKey = typeof tools[number]['key'];

export function StudioLayout() {
  const [active, setActive] = useState<ToolKey>('shots');
  const [collapsed, setCollapsed] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 700px)').matches);
  const inspector = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)');
    const change = () => { setCompact(media.matches); if (media.matches) setCollapsed(false); };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('studio:panel-change', { detail: active }));
    inspector.current?.scrollTo({ top: 0 });
  }, [active]);
  function select(key: ToolKey) { setActive(key); setCollapsed(false); }
  const label = tools.find(tool => tool.key === active)!.label;
  return <main className={`workspace studio-workspace${collapsed ? ' is-panel-collapsed' : ''}`}>
    <nav className="tool-rail" aria-label="摄影棚工具">
      <div className="tool-navigation" role="tablist" aria-label="工具分类" aria-orientation={compact ? 'horizontal' : 'vertical'}>
        {tools.map(({ key, label, Icon }, index) => <Tooltip key={key} title={label} placement={compact ? 'top' : 'right'}>
          <Button id={`tab-${key}`} className="tool-tab" role="tab" aria-label={label} aria-controls={`panel-${key}`}
            aria-selected={active === key} tabIndex={active === key ? 0 : -1} onClick={() => select(key)} onKeyDown={event => {
              const previous = compact ? 'ArrowLeft' : 'ArrowUp';
              const next = compact ? 'ArrowRight' : 'ArrowDown';
              if (![previous, next, 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const target = tools[event.key === 'Home' ? 0 : event.key === 'End' ? tools.length - 1 : (index + (event.key === previous ? -1 : 1) + tools.length) % tools.length];
              select(target.key);
              document.getElementById(`tab-${target.key}`)?.focus();
            }}><Icon size={19} aria-hidden="true" /><span>{label}</span></Button>
        </Tooltip>)}
      </div>
      <Tooltip title={collapsed ? '展开参数区' : '收起参数区'} placement="right">
        <Button className="inspector-toggle icon-button" aria-label={collapsed ? '展开参数区' : '收起参数区'} aria-expanded={!collapsed}
          aria-controls="studio-inspector" onClick={() => setCollapsed(value => !value)} icon={collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />} />
      </Tooltip>
    </nav>
    <aside id="studio-inspector" className="panel studio-inspector" aria-label={`${label}参数`} ref={inspector} hidden={collapsed}>
      <header className="inspector-heading"><h2>{label}</h2><span>STUDIO / {String(tools.findIndex(tool => tool.key === active) + 1).padStart(2, '0')}</span></header>
      <CreationPanel active={active} /><CameraPanel active={active} />
    </aside>
    <Viewport />
  </main>;
}