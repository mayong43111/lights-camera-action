import { MathUtils } from 'three';
import { CHARACTERS } from './character.js';
import { PROP_MODELS } from './project-schema.js';

export function createSceneObjectControls({ objects, defaultActor, replaceCharacter, onStart, onChange, onBusy, isBlocked, announce }) {
  const fields = document.querySelector('#scene-object-fields');
  const list = document.querySelector('#scene-object-list');
  const picker = document.querySelector('#scene-model-picker');
  const pickerStatus = document.querySelector('#scene-picker-status');
  let pending = false;
  let pickerMode = 'add';
  let pickerKind = 'character';
  let replacementTarget = null;
  const previewFor = model => document.querySelector(`[data-character="${model}"] img`)?.getAttribute('src');

  function updatePicker() {
    const blocked = pending || objects.busy || isBlocked();
    document.querySelector('#scene-picker-title').textContent = pickerMode === 'add' ? '添加对象' : '更换人偶';
    document.querySelector('#scene-picker-tabs').hidden = pickerMode === 'replace';
    document.querySelector('#character-controls').hidden = pickerKind !== 'character';
    document.querySelector('#prop-controls').hidden = pickerKind !== 'prop';
    document.querySelector('#model-credit').hidden = pickerKind !== 'character';
    document.querySelectorAll('[data-picker-kind]').forEach(button => {
      button.setAttribute('aria-selected', String(button.dataset.pickerKind === pickerKind));
      button.disabled = blocked;
    });
    picker.querySelectorAll('[data-character], [data-prop]').forEach(button => {
      button.disabled = blocked || pickerMode === 'add' && (objects.entries.length >= 16 || button.dataset.character && objects.people.length >= 4);
    });
    document.querySelector('#scene-picker-close').disabled = blocked;
  }

  function openPicker(mode) {
    const selected = objects.active;
    if (pending || objects.busy || isBlocked() || mode === 'replace' && (!selected?.character || selected.locked || !selected.visible)) return;
    pickerMode = mode;
    pickerKind = mode === 'add' && objects.people.length >= 4 ? 'prop' : 'character';
    replacementTarget = selected?.id;
    pickerStatus.textContent = '';
    updatePicker();
    picker.showModal();
  }

  function update() {
    fields.disabled = pending || objects.busy || isBlocked();
    const selected = objects.active;
    list.replaceChildren(...objects.entries.map(entry => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scene-object-item';
      button.dataset.objectId = entry.id;
      button.setAttribute('aria-pressed', String(entry === selected));
      button.title = entry.name;
      const preview = entry.character && previewFor(entry.character.id);
      const icon = document.createElement(preview ? 'img' : 'i');
      if (preview) { icon.src = preview; icon.alt = ''; }
      else icon.dataset.lucide = entry.character ? 'person-standing' : 'box';
      const name = document.createElement('span');
      name.textContent = entry.name;
      const state = document.createElement('small');
      for (const [show, symbol, label] of [[!entry.visible, 'eye-off', '已隐藏'], [entry.locked, 'lock-keyhole', '已锁定']]) {
        if (!show) continue;
        const indicator = document.createElement('i');
        indicator.dataset.lucide = symbol;
        indicator.setAttribute('aria-label', label);
        indicator.setAttribute('title', label);
        state.append(indicator);
      }
      button.append(icon, name, state);
      return button;
    }));
    document.querySelector('#scene-object-count').textContent = `${objects.entries.length} 个`;
    document.querySelector('#scene-object-count').title = `${objects.people.length} 个人物，${objects.entries.length - objects.people.length} 个道具`;
    document.querySelector('#scene-object-add').disabled = objects.entries.length >= 16;
    updatePicker();
    if (!selected) return;
    const setValue = (id, value) => { const input = document.querySelector(id); if (document.activeElement !== input) input.value = value; };
    setValue('#scene-object-name', selected.name);
    document.querySelector('#scene-object-name').disabled = selected.locked;
    document.querySelector('#scene-object-visible').checked = selected.visible;
    document.querySelector('#scene-object-locked').checked = selected.locked;
    document.querySelector('#scene-object-delete').disabled = selected.locked || selected.character && objects.people.length === 1;
    document.querySelector('#scene-object-copy').disabled = objects.entries.length >= 16 || selected.character && objects.people.length >= 4;
    const modelButton = document.querySelector('#scene-object-model');
    const modelName = selected.character ? CHARACTERS[selected.character.id].name : PROP_MODELS[selected.model].name;
    modelButton.disabled = !selected.character || selected.locked || !selected.visible;
    modelButton.title = selected.character ? `更换${selected.name}的人偶` : modelName;
    modelButton.setAttribute('aria-label', modelButton.title);
    document.querySelector('#scene-object-model-name').textContent = modelName;
    document.querySelector('#scene-model-chevron').hidden = modelButton.disabled;
    const preview = selected.character && previewFor(selected.character.id);
    const image = document.querySelector('#scene-object-model-image');
    image.hidden = !preview;
    if (preview) image.src = preview;
    document.querySelector('#scene-object-model-icon').toggleAttribute('hidden', !!preview);
    for (const axis of ['x', 'y', 'z']) {
      const position = document.querySelector(`#object-position-${axis}`);
      setValue(`#object-position-${axis}`, Number((selected.character && axis === 'y' ? selected.character.height : selected.group.position[axis]).toFixed(3)));
      position.disabled = selected.locked || !!selected.character && axis === 'y';
      position.closest('label').hidden = !!selected.character && axis === 'y';
      const rotation = document.querySelector(`#object-rotation-${axis}`);
      setValue(`#object-rotation-${axis}`, Number(MathUtils.radToDeg(selected.group.rotation[axis]).toFixed(1)));
      rotation.disabled = selected.locked || !!selected.character && axis !== 'y';
      rotation.closest('label').hidden = !!selected.character && axis !== 'y';
    }
    document.querySelector('#object-yaw-label').textContent = selected.character ? '朝向' : '旋转 Y';
    setValue('#scene-object-scale', selected.group.scale.x);
    document.querySelector('#scene-object-scale').disabled = selected.locked || !!selected.character;
    document.querySelector('.object-scale').hidden = !!selected.character;
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
    catch (error) { pickerStatus.textContent = error.message; announce(error.message); }
    finally { pending = false; onBusy(false); update(); }
  }

  list.addEventListener('click', event => {
    const button = event.target.closest('[data-object-id]');
    if (button && !isBlocked() && !pending) objects.select(button.dataset.objectId);
  });
  document.querySelector('#scene-object-add').addEventListener('click', () => openPicker('add'));
  document.querySelector('#scene-object-model').addEventListener('click', () => openPicker('replace'));
  document.querySelector('#scene-picker-close').addEventListener('click', () => picker.close());
  picker.addEventListener('cancel', event => { if (pending || objects.busy) event.preventDefault(); });
  document.querySelectorAll('[data-picker-kind]').forEach(button => button.addEventListener('click', () => {
    pickerKind = button.dataset.pickerKind;
    updatePicker();
  }));
  picker.addEventListener('click', event => {
    const button = event.target.closest('[data-character], [data-prop]');
    if (!button || button.disabled) return;
    run(async () => {
      const model = button.dataset.character ?? button.dataset.prop;
      if (pickerMode === 'replace') {
        const selected = objects.active;
        if (selected?.id !== replacementTarget || !selected.character || selected.locked || !selected.visible) throw new Error('选中人物已变化，请重新选择。');
        if (!await replaceCharacter(model)) throw new Error('人偶更换失败，请重试。');
      } else {
        const kind = button.dataset.character ? 'character' : 'prop';
        const snapshot = kind === 'character' ? defaultActor(model) : { kind, model, name: PROP_MODELS[model].name, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
        snapshot.position[0] = MathUtils.clamp((objects.active?.group.position.x ?? 0) + 1.5, -1000, 1000);
        const entry = await objects.add(snapshot);
        if (entry) announce(`已添加${entry.name}`);
      }
      picker.close();
    });
  });
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