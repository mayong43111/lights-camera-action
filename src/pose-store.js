import { validatePoseLibrary } from './pose-library.js';
import { validPose } from './pose-schema.js';

const STORAGE_KEY = 'studio-pose-library-v1';

export function createPoseStore(baseLibrary, getStorage = () => globalThis.localStorage) {
  const base = structuredClone(validatePoseLibrary(baseLibrary));
  let overrides = new Map();
  let catalog = base;
  let warning = '';
  let storedText = null;

  function merge(entries) {
    const poses = new Map(base.poses.map((pose) => [pose.id, pose]));
    entries.forEach((pose, id) => poses.set(id, pose));
    return validatePoseLibrary({ ...base, poses: [...poses.values()] });
  }

  try {
    const text = getStorage().getItem(STORAGE_KEY);
    storedText = text;
    if (text) {
      if (text.length > 4 * 1024 * 1024) throw new Error('本地姿势库过大');
      const data = JSON.parse(text);
      if (data?.version !== 1 || !Array.isArray(data.poses)) throw new Error('本地姿势库格式无效');
      if (data.poses.length) validatePoseLibrary({ version: 1, units: 'radians', defaultPose: data.poses[0]?.id, poses: data.poses });
      overrides = new Map(data.poses.map((pose) => [pose.id, pose]));
      catalog = merge(overrides);
    }
  } catch {
    warning = '本地姿势库无法读取，已使用内置预设；请检查浏览器存储设置，原数据未改动';
  }

  function persist(pose) {
    if (warning) throw new Error('本地姿势库未正常加载，无法保存；请先导出姿势备份并检查浏览器存储');
    const next = new Map(overrides);
    next.set(pose.id, pose);
    const merged = merge(next);
    const text = JSON.stringify({ version: 1, poses: [...next.values()] });
    if (text.length > 4 * 1024 * 1024) throw new Error('本地姿势库空间不足，请先导出姿势备份');
    let storage;
    let latest;
    try {
      storage = getStorage();
      latest = storage.getItem(STORAGE_KEY);
    } catch {
      throw new Error('保存失败：浏览器存储不可用，请导出姿势备份');
    }
    if (latest !== storedText) throw new Error('姿势库已在其他页面更新，请先导出当前姿势，再刷新页面后保存');
    try {
      storage.setItem(STORAGE_KEY, text);
    } catch {
      throw new Error('保存失败：浏览器存储不可用或空间不足，请导出姿势备份');
    }
    storedText = text;
    overrides = next;
    catalog = merged;
    return structuredClone(pose);
  }

  function snapshotFields(snapshot) {
    if (!validPose(snapshot)) throw new Error('当前姿势数据无效，无法保存');
    return structuredClone({ joints: snapshot.joints, rotation: snapshot.rotation, ...(snapshot.placement ? { placement: snapshot.placement } : {}) });
  }

  return {
    get catalog() { return structuredClone(catalog); },
    get warning() { return warning; },
    save(id, snapshot) {
      const original = catalog.poses.find((pose) => pose.id === id);
      if (!original) throw new Error('当前姿势不在姿势库中，请使用另存为');
      return persist({ ...original, ...snapshotFields(snapshot) });
    },
    saveAs({ name, folder }, snapshot) {
      name = name.trim();
      folder = folder.trim();
      if (!name || name.length > 80 || !folder || folder.length > 80) throw new Error('名称和分类需为 1 至 80 个字符');
      if (catalog.poses.some((pose) => pose.name === name && pose.folder === folder)) throw new Error('此分类下已有同名姿势，请更换名称');
      return persist({ id: `user-${crypto.randomUUID()}`, name, folder, icon: 'user-round', ...snapshotFields(snapshot) });
    },
  };
}