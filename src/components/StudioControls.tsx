import { useEffect, useState } from 'react';
import { Slider } from 'antd';
import type { ThemeConfig } from 'antd';
export { Button as StudioButton } from 'antd';

export const studioTheme: ThemeConfig = { token: {
  colorPrimary: '#28786f', colorError: '#d94635', borderRadius: 4,
  fontFamily: '"Bahnschrift", "Microsoft YaHei UI", sans-serif', fontSize: 12, controlHeight: 36,
} };

interface ControlledRangeProps {
  id?: string;
  className?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  disabled: boolean;
  onBeforeChange(): void;
  onChange(value: number): void;
}

export function ControlledRange({ id, className = '', label, onBeforeChange, ...props }: ControlledRangeProps) {
  return <span id={id} className={`studio-range ${className}`} onPointerDownCapture={onBeforeChange}
    onKeyDownCapture={event => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) onBeforeChange();
    }}><Slider {...props} ariaLabelForHandle={label} /></span>;
}

export function ControlledNumber({ label, value, onBeforeChange, onChange, ...props }: ControlledRangeProps) {
  const [draft, setDraft] = useState<string>();
  useEffect(() => setDraft(undefined), [value]);
  return <input {...props} type="number" aria-label={label} value={draft ?? value}
    onFocus={onBeforeChange} onBlur={() => setDraft(undefined)} onChange={event => {
      const next = event.target.value;
      setDraft(next);
      if (next !== '' && Number.isFinite(Number(next)) && Number(next) >= props.min && Number(next) <= props.max) onChange(Number(next));
    }} />;
}