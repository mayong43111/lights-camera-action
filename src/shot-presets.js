import { validProject } from './project-schema.js';
import { LIGHT_DEFINITIONS } from './studio-scene.js';

export const SHOT_CATEGORIES = ['时尚封面', '写真集', '肖像', '其他'];

const BUILT_IN_SHOTS = [
  [101, '正面柔光肖像', '肖像', 'fashionFront', [0, 2.85, 3.8], [0, 2.85, 0], 85, '0.5625', 'soft', '正面近景，柔和主光与低强度辅光。'],
  [102, '四十五度侧颜', '肖像', 'fashionThreeQuarter', [0.4, 2.8, 4.2], [0, 2.7, 0], 85, '0.5625', 'split', '斜侧近景，侧光突出面部和肩部轮廓。'],
  [103, '侧身回眸', '肖像', 'profile', [0, 2.65, 4.6], [0, 2.5, 0], 70, '0.5625', 'rim', '回眸半身，轮廓光分离肩背线条。'],
  [104, '袖口与手势', '肖像', 'fashionCuff', [0, 2.5, 4.8], [0, 2.35, 0], 70, '0.5625', 'soft', '屈臂半身，手腕与衣袖同框。'],
  [105, '交谈瞬间', '肖像', 'ual1Talking', [0.5, 2.5, 5.2], [0, 2.3, 0], 70, '1', 'even', '交谈手势中景，方形构图保留双手空间。'],
  [106, '经典封面站姿', '时尚封面', 'editorial', [0, 1.8, 7.2], [0, 1.65, 0], 50, '0.5625', 'soft', '竖幅全身，经典封面站姿。'],
  [107, '低机位气场', '时尚封面', 'power', [0.4, 1.1, 7.8], [0, 1.6, 0], 50, '0.5625', 'split', '轻仰拍全身，以侧光强化姿态。'],
  [108, '秀场定格', '时尚封面', 'runway', [0, 1.8, 7.4], [0, 1.65, 0], 50, '0.5625', 'rim', '正面全身，秀场停步与明晰轮廓。'],
  [109, '收腰线条', '时尚封面', 'fashionWaist', [0, 2.1, 6], [0, 2, 0], 60, '0.5625', 'split', '收腰中景，强调肩腰曲线。'],
  [110, '松弛重心', '时尚封面', 'fashionWeightShift', [0.3, 1.9, 7.1], [0, 1.65, 0], 50, '0.5625', 'soft', '略偏机位的全身重心站姿。'],
  [111, '背面廓形', '写真集', 'fashionBack', [0, 1.8, 7], [0, 1.65, 0], 50, '0.5625', 'even', '背面全身，均匀照明呈现整体廓形。'],
  [112, '侧面剪影线', '写真集', 'fashionSide', [0, 1.8, 7], [0, 1.65, 0], 50, '0.5625', 'rim', '侧身全身，以轮廓光突出侧面线条。'],
  [113, '向前一步', '写真集', 'fashionStep', [0.4, 1.8, 7.4], [0, 1.65, 0], 50, '0.5625', 'soft', '迈步全身，脚下保留取景余量。'],
  [114, '转身停格', '写真集', 'fashionTurn', [0, 2, 6.4], [0, 1.9, 0], 55, '0.5625', 'rim', '转身中全景，肩背与回望形成层次。'],
  [115, '展开廓形', '写真集', 'fashionSleeves', [0, 1.9, 7.6], [0, 1.7, 0], 50, '1', 'even', '方形全身，为展开的双臂保留横向空间。'],
  [116, '山式平衡', '其他', 'mountain', [0, 1.8, 7.2], [0, 1.65, 0], 50, '0.5625', 'even', '动作练习：正面山式，全身均匀布光。'],
  [117, '单腿树式', '其他', 'treeLeft', [0.3, 2, 8.5], [0, 1.85, 0], 50, '0.5625', 'soft', '动作练习：单腿平衡，头顶与足部留白。'],
  [118, '战士横幅', '其他', 'warrior', [0, 2, 8.5], [0, 1.65, 0], 50, '1.333333', 'split', '动作练习：横幅展开，容纳弓步与双臂。'],
  [119, '舞台律动', '其他', 'dance', [0.5, 2, 8], [0, 1.7, 0], 50, '1', 'rim', '动作练习：方形舞蹈定格，轮廓光强调肢体。'],
  [120, '芭蕾延伸', '其他', 'arabesque', [0, 2.1, 9], [0, 1.7, 0], 50, '1.333333', 'soft', '动作练习：横幅燕式，完整呈现手脚延伸。'],
];

export function createBuiltInShots(poseLibrary, thumbnails = {}) {
  const lighting = {
    soft: [[-3.2, 4.5, 4.5, 6.5], [3.5, 3.3, 3.5, 3.5], [1, 4.5, -3, 3]],
    split: [[-4.5, 3.8, 2.5, 7], [4, 3, 3, 1.8], [1, 4.2, -3, 4]],
    rim: [[-3.5, 4.2, 4, 5.5], [3.8, 3.2, 3.8, 2.5], [0.5, 4.5, -3.4, 7]],
    even: [[-3, 4.2, 4.5, 6], [3, 4.2, 4.5, 5], [0, 4.5, -3, 2.5]],
  };
  return BUILT_IN_SHOTS.map(([code, name, category, poseId, cameraPosition, target, focal, aspect, lightStyle, notes]) => {
    const pose = poseLibrary.poses.find(entry => entry.id === poseId);
    if (!pose) throw new Error(`内置组合缺少姿势：${poseId}`);
    const id = `shot-${code.toString(16).padStart(32, '0')}`;
    return {
      id, name, category, notes, sourceName: `内置手动编排 · ${pose.name}`,
      thumbnail: thumbnails[id] ?? '',
      scene: {
        jointPose: { format: 'studio-pose', version: 1, units: 'radians', rotation: pose.rotation ?? 0,
          placement: structuredClone(pose.placement ?? { grounded: true, height: 0 }), joints: structuredClone(pose.joints) },
        cameraPosition: [...cameraPosition], target: [...target], focal, aspect, exposure: 0.5,
        backdrop: '#eef2f4', props: [],
        lights: Object.fromEntries(['key', 'fill', 'rim'].map((key, index) => {
          const [position, height, depth, intensity] = lighting[lightStyle][index];
          return [key, { enabled: true, color: '#ffffff', position, height, depth, intensity }];
        })),
      },
    };
  });
}

export async function loadBuiltInShots(poseLibrary) {
  const response = await fetch(new URL('../assets/shots/thumbnails.json', import.meta.url), { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('无法加载内置组合预览');
  const presets = createBuiltInShots(poseLibrary, await response.json());
  if (!presets.every(validShot)) throw new Error('内置组合数据无效');
  return presets;
}

export function createShotProject(preset) {
  const scene = structuredClone(preset.scene);
  return { version: 1, state: {
    ...scene, pose: 'aiReference', poseCustomized: true, poseSaveTarget: null,
    rotation: scene.jointPose.rotation * 180 / Math.PI,
    props: scene.props.map((prop, index) => ({ ...prop, id: `prop-${preset.id}-${index}` })),
    dof: 0, background: null, backdrop: '#eef2f4', autoOrbit: false, showRigs: false, removeShadows: false,
  } };
}

export function validShot(preset) {
  const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  const vector = (value, limit) => Array.isArray(value) && value.length === 3 && value.every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= limit);
  if (!preset || !/^shot-[a-f0-9]{32}$/.test(preset.id) || !text(preset.name, 80)
    || !SHOT_CATEGORIES.includes(preset.category) || !text(preset.notes, 1200) || !text(preset.sourceName, 160)
    || typeof preset.thumbnail !== 'string' || preset.thumbnail.length > 200000 || !/^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(preset.thumbnail)) return false;
  const scene = preset.scene;
  if (!scene || !Array.isArray(scene.props) || !vector(scene.cameraPosition, 100) || !vector(scene.target, 20)
    || Math.hypot(...scene.cameraPosition.map((value, axis) => value - scene.target[axis])) < 0.1) return false;
  const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === expected.split(',').sort().join(',');
  const number = (value, low, high) => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
  if (!keys(preset, 'id,name,category,notes,sourceName,scene,thumbnail')
    || !keys(scene, 'jointPose,cameraPosition,target,focal,aspect,exposure,backdrop,props,lights')
    || !keys(scene.jointPose, 'format,version,units,rotation,placement,joints')
    || !keys(scene.jointPose.placement, 'grounded,height') || !number(scene.jointPose.placement.height, -20, 20)
    || !number(scene.focal, 24, 100) || !number(scene.exposure, 0.125, 2) || typeof scene.aspect !== 'string'
    || typeof scene.backdrop !== 'string' || !/^#[0-9a-f]{6}$/i.test(scene.backdrop)
    || !scene.props.every(prop => keys(prop, 'type,position,rotation,size,color'))
    || !keys(scene.lights, 'key,fill,rim') || !Object.values(scene.lights).every(light => keys(light, 'enabled,intensity,color,position,height,depth')
      && number(light.intensity, 0, 12) && number(light.position, -6, 6) && number(light.height, 1, 6) && number(light.depth, -4, 6))) return false;
  try { return validProject(createShotProject(preset), { poses: {}, characters: {}, lightDefinitions: LIGHT_DEFINITIONS }); }
  catch { return false; }
}