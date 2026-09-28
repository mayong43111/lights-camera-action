import type { NumericInput, Vector3Tuple } from './scene-types';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const isVector = (value: unknown, min = -Infinity, max = Infinity): value is Vector3Tuple =>
  Array.isArray(value) && value.length === 3
  && value.every(number => typeof number === 'number' && Number.isFinite(number) && number >= min && number <= max);

export const finiteRange = (value: unknown, min: number, max: number): value is NumericInput =>
  (typeof value === 'number' || typeof value === 'string') && value !== ''
  && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;

export const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);