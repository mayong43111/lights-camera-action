import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentRef, InputHTMLAttributes } from 'react';
import { Button, Slider } from 'antd';
import type { ButtonProps, ThemeConfig } from 'antd';
import { LIGHT_DEFINITIONS } from '../studio-scene';

export const studioTheme: ThemeConfig = { token: {
  colorPrimary: '#28786f', colorError: '#d94635', borderRadius: 4,
  fontFamily: '"Bahnschrift", "Microsoft YaHei UI", sans-serif', fontSize: 12, controlHeight: 36,
} };

export function StudioButton({ disabled, ...props }: ButtonProps) {
  const button = useRef<ComponentRef<typeof Button>>(null);
  const [isDisabled, setDisabled] = useState(disabled);
  useEffect(() => {
    const element = button.current;
    if (!element) return;
    const observer = new MutationObserver(() => setDisabled(element.hasAttribute('disabled')));
    observer.observe(element, { attributes: true, attributeFilter: ['disabled'] });
    return () => observer.disconnect();
  }, []);
  return <Button {...props} ref={button} disabled={isDisabled} />;
}

type RangeProps = Pick<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className' | 'min' | 'max' | 'step' | 'defaultValue' | 'disabled' | 'aria-label'>;

export function StudioRange(props: RangeProps) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(Number(props.defaultValue ?? props.min ?? 0));
  const [disabled, setDisabled] = useState(props.disabled ?? false);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    const own = Object.getOwnPropertyDescriptor(element, 'value');
    const descriptor = own ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!descriptor?.get || !descriptor.set) return;
    const { get, set } = descriptor;
    Object.defineProperty(element, 'value', {
      configurable: true,
      get() { return get.call(element); },
      set(next: string) { set.call(element, next); setValue(Number(element.value)); },
    });
    const observer = new MutationObserver(() => setDisabled(element.disabled));
    observer.observe(element, { attributes: true, attributeFilter: ['disabled'] });
    return () => {
      observer.disconnect();
      if (own) Object.defineProperty(element, 'value', own);
      else Reflect.deleteProperty(element, 'value');
    };
  }, []);
  const change = (next: number) => {
    if (!input.current) return;
    input.current.value = String(next);
    input.current.dispatchEvent(new Event('input', { bubbles: true }));
  };
  return <span className="studio-range" onPointerDown={() => input.current?.dispatchEvent(new Event('pointerdown'))}
    onKeyDown={event => input.current?.dispatchEvent(new KeyboardEvent('keydown', { key: event.key }))}>
    <input {...props} type="range" ref={input} hidden />
    <Slider min={Number(props.min)} max={Number(props.max)} step={Number(props.step ?? 1)}
      value={value} disabled={disabled} onChange={change} ariaLabelForHandle={props['aria-label']}
      onChangeComplete={() => input.current?.dispatchEvent(new Event('change', { bubbles: true }))} />
  </span>;
}

export function LightControls() {
  return <div id="light-controls">{LIGHT_DEFINITIONS.map(definition => <article className="light-control" key={definition.id} data-light={definition.id}>
    <header><div><span className="light-index">{definition.index}</span><b className="light-name">{definition.name}</b></div>
      <label className="switch"><input className="light-enabled" type="checkbox" defaultChecked /><span /><em>开关</em></label></header>
    <label className="range-control compact"><span><b>亮度</b><output className="light-output">{definition.intensity.toFixed(1)}</output></span>
      <StudioRange className="light-intensity" min="0" max="12" step="0.1" defaultValue={definition.intensity} aria-label={`${definition.name}亮度`} /></label>
    <div className="light-row"><label className="color-control"><span>颜色</span><input className="light-color" type="color" defaultValue={definition.color} /></label>
      <label className="range-control compact position-control"><span><b>水平位置</b></span><StudioRange className="light-position" min="-6" max="6" step="0.1" defaultValue={definition.position[0]} aria-label={`${definition.name}水平位置`} /></label></div>
    <label className="range-control compact"><span><b>高度</b></span><StudioRange className="light-height" min="1" max="6" step="0.1" defaultValue={definition.position[1]} aria-label={`${definition.name}高度`} /></label>
    <label className="range-control compact"><span><b>前后位置</b></span><StudioRange className="light-depth" min="-4" max="6" step="0.1" defaultValue={definition.position[2]} aria-label={`${definition.name}前后位置`} /></label>
  </article>)}</div>;
}