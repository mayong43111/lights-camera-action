import { isRecord } from './schema-utils';

export interface PartOption { id: string; name: string; meshes: string[]; excludes: string[] }
export interface PartGroup { id: string; name: string; required: boolean; options: PartOption[] }
export interface PartCatalog { version: 1; groups: PartGroup[] }
export interface PartSelection { catalog: PartCatalog; selected: Record<string, string | null> }

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value);
}

function label(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160 && !/[\x00-\x1f]/.test(value);
}

export function parsePartCatalog(value: unknown): PartCatalog {
  const invalid = () => new Error('部件清单无效：请检查分组、网格名称和互斥项');
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.groups) || !value.groups.length || value.groups.length > 32) throw invalid();
  const groups: PartGroup[] = [];
  const groupIds = new Set<string>();
  const options = new Map<string, PartOption>();
  const meshes = new Set<string>();
  for (const group of value.groups) {
    if (!isRecord(group) || !identifier(group.id) || groupIds.has(group.id) || !label(group.name)
      || typeof group.required !== 'boolean' || !Array.isArray(group.options) || !group.options.length || group.options.length > 32) throw invalid();
    groupIds.add(group.id);
    const entries: PartOption[] = [];
    for (const option of group.options) {
      if (!isRecord(option) || !identifier(option.id) || options.has(option.id) || !label(option.name)
        || !Array.isArray(option.meshes) || !option.meshes.length || option.meshes.length > 32
        || !Array.isArray(option.excludes ?? []) || (option.excludes as unknown[] | undefined)?.some(id => !identifier(id))) throw invalid();
      const names: string[] = [];
      for (const name of option.meshes) {
        if (!label(name) || meshes.has(name)) throw invalid();
        meshes.add(name);
        names.push(name);
      }
      const entry: PartOption = { id: option.id, name: option.name, meshes: names, excludes: [...new Set((option.excludes ?? []) as string[])] };
      options.set(entry.id, entry);
      entries.push(entry);
    }
    groups.push({ id: group.id, name: group.name, required: group.required, options: entries });
  }
  if (options.size > 128 || meshes.size > 512) throw invalid();
  for (const option of options.values()) {
    for (const excluded of option.excludes) {
      if (!options.has(excluded) || excluded === option.id) throw invalid();
    }
  }
  return { version: 1, groups };
}

export function partsConflict(first: PartOption, second: PartOption) {
  return first.excludes.includes(second.id) || second.excludes.includes(first.id);
}

export function validatePartSelection(parts: PartSelection) {
  const chosen: PartOption[] = [];
  if (!isRecord(parts.selected) || Object.keys(parts.selected).some(id => !parts.catalog.groups.some(group => group.id === id))) throw new Error('部件选择无效');
  for (const group of parts.catalog.groups) {
    const id = parts.selected[group.id];
    const option = group.options.find(option => option.id === id);
    if (id != null && !option || group.required && !option) throw new Error(`请选择${group.name}`);
    if (option) {
      if (chosen.some(previous => partsConflict(previous, option))) throw new Error('所选部件不能同时使用');
      chosen.push(option);
    }
  }
}

export function selectPart(parts: PartSelection, groupId: string, optionId: string | null): PartSelection {
  const group = parts.catalog.groups.find(group => group.id === groupId);
  if (!group || optionId === null && group.required) throw new Error('该部件不能移除');
  const option = group.options.find(option => option.id === optionId);
  if (optionId !== null && !option) throw new Error('部件不存在');
  const selected = { ...parts.selected, [groupId]: optionId };
  if (option) for (const other of parts.catalog.groups) {
    if (other.id === groupId) continue;
    const current = other.options.find(candidate => candidate.id === selected[other.id]);
    if (current && partsConflict(option, current)) {
      if (other.required) throw new Error(`${option.name}与必选部件${current.name}冲突`);
      selected[other.id] = null;
    }
  }
  const result = { catalog: parts.catalog, selected };
  validatePartSelection(result);
  return result;
}