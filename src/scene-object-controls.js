import { MathUtils } from 'three';
import { CHARACTERS } from './character.js';
import { PROP_MODELS } from './project-schema.js';

export function createSceneObjectControls({ objects, defaultActor, onStart, onChange, onBusy, isBlocked, announce }) {
  const fields = document.querySelector('#scene-object-fields');
  const list = document.querySelector('#scene-object-list');
  const addType = document.querySelector('#scene-object-type');
  let pending = false;
  for (const model of ['mannequinFemale', 'mannequin', 'pixiv', 'seed', 'quaternius']) addType.add(new Option(CHARACTERS[model].name, `character:${model}`));
  for (const [model, definition] of Object.entries(PROP_MODELS)) addType.add(new Option(definition.name, `prop:${model}`));

  function update() {
    fields.disabled = pending || objects.busy || isBlocked();
    const selected = objects.active;
    list.replaceChildren(...objects.entries.map(entry => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scene-object-item';
      button.dataset.objectId = entry.id;
      button.setAttribute('aria-pressed', String(entry === selected));
      const icon = document.createElement('i');
      icon.dataset.lucide = entry.character ? 'person-standing' : 'box';
      const name = document.createElement('span');
      name.textContent = entry.name;
      const state = document.createElement('small');
      state.textContent = `${entry.visible ? '' : '隐藏'}${entry.locked ? ' 锁定' : ''}`;
      button.append(icon, name, state);
      return button;
    }));
    document.querySelector('#scene-object-count').textContent = `${objects.people.length} 人 · ${objects.entries.length} 对象`;
    document.querySelector('#scene-object-add').disabled = objects.entries.length >= 16 || addType.value.startsWith('character:') && objects.people.length >= 4;
    if (!selected) return;
    const setValue = (id, value) => { const input = document.querySelector(id); if (document.activeElement !== input) input.value = value; };
    setValue('#scene-object-name', selected.name);
    document.querySelector('#scene-object-name').disabled = selected.locked;
    document.querySelector('#scene-object-visible').checked = selected.visible;
    document.querySelector('#scene-object-locked').checked = selected.locked;
    document.querySelector('#scene-object-delete').disabled = selected.locked || selected.character && objects.people.length === 1;
    document.querySelector('#scene-object-copy').disabled = objects.entries.length >= 16 || selected.character && objects.people.length >= 4;
    for (const axis of ['x', 'y', 'z']) {
      const position = document.querySelector(`#object-position-${axis}`);
      setValue(`#object-position-${axis}`, Number((selected.character && axis === 'y' ? selected.character.height : selected.group.position[axis]).toFixed(3)));
      position.disabled = selected.locked || !!selected.character && axis === 'y';
      const rotation = document.querySelector(`#object-rotation-${axis}`);
      setValue(`#object-rotation-${axis}`, Number(MathUtils.radToDeg(selected.group.rotation[axis]).toFixed(1)));
      rotation.disabled = selected.locked || !!selected.character && axis !== 'y';
    }
    setValue('#scene-object-scale', selected.group.scale.x);
    document.querySelector('#scene-object-scale').disabled = selected.locked || !!selected.character;
    document.querySelectorAll('[data-object-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.objectMode === objects.gizmo.getMode()));
      button.disabled = selected.locked;
    });
    window.lucide?.createIcons({ root: list });
  }

  async function run(operation) {
    if (pending || objects.busy || isBlocked()) return;
    pending = true;
    onBusy(true);
    update();
    try { await operation(); }
    catch (error) { announce(error.message); }
    finally { pending = false; onBusy(false); update(); }
  }

  list.addEventListener('click', event => {
    const button = event.target.closest('[data-object-id]');
    if (button && !isBlocked() && !pending) objects.select(button.dataset.objectId);
  });
  addType.addEventListener('change', update);
  document.querySelector('#scene-object-add').addEventListener('click', () => run(async () => {
    const [kind, model] = addType.value.split(':');
    const snapshot = kind === 'character' ? defaultActor(model) : { kind, model, name: PROP_MODELS[model].name, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
    snapshot.position[0] = MathUtils.clamp((objects.active?.group.position.x ?? 0) + 1.5, -1000, 1000);
    const entry = await objects.add(snapshot);
    if (entry) announce(`已添加${entry.name}`);
  }));
  document.querySelector('#scene-object-copy').addEventListener('click', () => run(async () => {
    const snapshot = objects.snapshot(objects.active);
    snapshot.name = `${snapshot.name.slice(0, 75)} 副本`;
    snapshot.position[0] = MathUtils.clamp(snapshot.position[0] + 1.5, -1000, 1000);
    const entry = await objects.add(snapshot);
    if (entry) announce(`已复制${entry.name}`);
  }));
  document.querySelector('#scene-object-delete').addEventListener('click', () => run(() => objects.removeSelected()));
  document.querySelector('#scene-object-name').addEventListener('change', event => {
    if (!objects.active || objects.active.locked) return;
    const value = event.target.value.trim();
    if (value) { onStart(); objects.active.name = value; onChange(); }
    event.target.value = objects.active.name;
    update();
  });
  for (const property of ['visible', 'locked']) document.querySelector(`#scene-object-${property}`).addEventListener('change', event => {
    onStart();
    objects.active[property] = event.target.checked;
    objects.active.group.visible = objects.active.visible;
    objects.refreshEditors();
    onChange();
    update();
  });
  document.querySelectorAll('[data-object-mode]').forEach(button => button.addEventListener('click', () => {
    objects.gizmo.setMode(button.dataset.objectMode);
    objects.setJointEditing(false);
    onChange();
    update();
  }));
  for (const kind of ['position', 'rotation']) for (const axis of ['x', 'y', 'z']) {
    const input = document.querySelector(`#object-${kind}-${axis}`);
    input.addEventListener('focus', onStart);
    input.addEventListener('input', () => {
      const entry = objects.active;
      if (!entry || input.disabled || !input.value || !input.validity.valid) return;
      entry.group[kind][axis] = kind === 'rotation' ? MathUtils.degToRad(Number(input.value)) : Number(input.value);
      onChange();
    });
    input.addEventListener('change', update);
  }
  const scale = document.querySelector('#scene-object-scale');
  scale.addEventListener('focus', onStart);
  scale.addEventListener('input', () => {
    if (scale.disabled || !scale.value || !scale.validity.valid) return;
    objects.active.group.scale.setScalar(Number(scale.value));
    onChange();
  });
  update();
  return { update, get busy() { return pending; } };
}