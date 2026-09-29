import { Button } from 'antd';
import { Maximize, Scan, X, ZoomIn, ZoomOut } from 'lucide-react';
import { requiredElement } from './dom';
import type { ViewHost } from './react-view';

export function createImagePreview(views: ViewHost) {
  const container = document.createElement('div');
  document.body.append(container);
  const pointers = new Map<number, { x: number; y: number }>();
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let ready = false;
  let fitted = true;
  let generation = 0;
  let trigger: HTMLElement | null = null;
  let source: string | undefined;
  let title = '图片预览';
  let status = '';
  let width = 0;
  let height = 0;
  const snapshot = () => ({ scale, offsetX, offsetY, ready, source, title, status, width, height });
  const view = views.mountView(container, snapshot(), state => <dialog className="image-viewer" aria-label="图片预览"
    onClose={closed} onClick={event => { if (event.target === event.currentTarget) dialog.close(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dialog.close(); }
      else if (['+', '=', '-', '0', '1'].includes(event.key)) {
        event.preventDefault();
        if (event.key === '0') fit();
        else zoom(event.key === '1' ? 1 : scale * (event.key === '-' ? 0.8 : 1.25));
      }
    }}>
    <header><div className="image-viewer-heading"><h2>{state.title}</h2>
      <span className="image-viewer-dimensions">{state.ready ? `${state.width} × ${state.height}` : ''}</span></div>
      <div className="image-viewer-tools">
        <Button className="icon-button" data-preview="out" title="缩小" aria-label="缩小" icon={<ZoomOut size={18} />}
          disabled={!state.ready || state.scale <= Math.min(fitScale(), 0.1)} onClick={() => zoom(scale / 1.25)} />
        <output aria-label="缩放比例">{state.ready ? `${Math.round(state.scale * 100)}%` : ''}</output>
        <Button className="icon-button" data-preview="in" title="放大" aria-label="放大" icon={<ZoomIn size={18} />}
          disabled={!state.ready || state.scale >= 8} onClick={() => zoom(scale * 1.25)} />
        <Button className="icon-button" data-preview="fit" title="适应窗口" aria-label="适应窗口" icon={<Maximize size={18} />} onClick={fit} />
        <Button className="icon-button" data-preview="actual" title="原始大小（100%）" aria-label="原始大小" icon={<Scan size={18} />} onClick={() => zoom(1)} />
        <Button className="icon-button" data-preview="close" title="关闭图片预览" aria-label="关闭图片预览" icon={<X size={18} />} autoFocus onClick={() => dialog.close()} />
      </div></header>
    <div className={`image-viewer-viewport${state.ready && (state.width * state.scale > viewport.clientWidth || state.height * state.scale > viewport.clientHeight) ? ' can-pan' : ''}`}
      onDoubleClick={() => { if (fitted) zoom(1); else fit(); }}
      onPointerDown={event => {
        if (!ready || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }} onPointerMove={event => {
        const previous = pointers.get(event.pointerId);
        if (!previous || !ready) return;
        const before = [...pointers.values()];
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size === 2) {
          const after = [...pointers.values()];
          const distance = (points: { x: number; y: number }[]) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
          if (distance(before) > 0) zoom(scale * distance(after) / distance(before),
            (after[0].x + after[1].x) / 2, (after[0].y + after[1].y) / 2);
        } else if (pointers.size === 1) {
          offsetX += event.clientX - previous.x;
          offsetY += event.clientY - previous.y;
          draw();
        }
      }} onPointerUp={event => pointers.delete(event.pointerId)} onPointerCancel={event => pointers.delete(event.pointerId)}
      onLostPointerCapture={event => pointers.delete(event.pointerId)}>
      <img alt={state.title} src={state.source} draggable={false} hidden={!state.ready}
        style={{ width: state.width * state.scale, height: state.height * state.scale,
          transform: `translate(-50%, -50%) translate(${state.offsetX}px, ${state.offsetY}px)` }} />
      <p role="status">{state.status}</p>
    </div>
  </dialog>);
  const dialog = requiredElement<HTMLDialogElement>('dialog', container);
  const viewport = requiredElement('.image-viewer-viewport', dialog);
  const image = requiredElement<HTMLImageElement>('img', dialog);
  function fitScale() {
    return width && height ? Math.min(1, viewport.clientWidth / width, viewport.clientHeight / height) : 1;
  }
  function draw() {
    if (!ready) return;
    const maxX = Math.max(0, (width * scale - viewport.clientWidth) / 2);
    const maxY = Math.max(0, (height * scale - viewport.clientHeight) / 2);
    offsetX = Math.max(-maxX, Math.min(maxX, offsetX));
    offsetY = Math.max(-maxY, Math.min(maxY, offsetY));
    view.update(snapshot());
  }
  function fit() {
    if (!ready) return;
    fitted = true;
    scale = fitScale();
    offsetX = offsetY = 0;
    draw();
  }
  function zoom(value: number, clientX?: number, clientY?: number) {
    if (!ready) return;
    fitted = false;
    const next = Math.max(Math.min(fitScale(), 0.1), Math.min(8, value));
    const bounds = viewport.getBoundingClientRect();
    const anchorX = clientX === undefined ? 0 : clientX - bounds.left - bounds.width / 2;
    const anchorY = clientY === undefined ? 0 : clientY - bounds.top - bounds.height / 2;
    offsetX = anchorX - (anchorX - offsetX) * next / scale;
    offsetY = anchorY - (anchorY - offsetY) * next / scale;
    scale = next;
    draw();
  }
  function closed() {
    generation++;
    ready = false;
    pointers.clear();
    source = undefined;
    view.update(snapshot());
    trigger?.focus({ preventScroll: true });
  }
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    zoom(scale * Math.exp(Math.max(-1, Math.min(1, -event.deltaY * 0.002))), event.clientX, event.clientY);
  };
  viewport.addEventListener('wheel', wheel, { passive: false });
  const resize = new ResizeObserver(() => { if (dialog.open) { if (fitted) fit(); else draw(); } });
  resize.observe(viewport);
  return {
    dialog,
    async open(src: string, name = '图片预览') {
      if (!src) return false;
      const current = ++generation;
      if (!dialog.open) trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      ready = false;
      fitted = true;
      source = src;
      title = name;
      status = '正在加载图片';
      view.update(snapshot());
      if (!dialog.open) dialog.showModal();
      try {
        await image.decode();
        if (generation !== current || !dialog.open) return false;
        width = image.naturalWidth;
        height = image.naturalHeight;
        ready = true;
        status = '';
        fit();
        return true;
      } catch {
        if (generation === current && dialog.open) { status = '图片无法加载'; view.update(snapshot()); }
        return false;
      }
    },
    destroy() { generation++; resize.disconnect(); viewport.removeEventListener('wheel', wheel); dialog.close(); view.dispose(); container.remove(); },
  };
}