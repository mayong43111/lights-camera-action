export function createPoseBrowser(catalog, onSelect, root = document) {
  const library = root.querySelector('#pose-library');
  const folderSelect = root.querySelector('#pose-folder');
  const folderNav = root.querySelector('#pose-folders');
  const search = root.querySelector('#pose-search');
  const clear = root.querySelector('#pose-search-clear');
  const results = root.querySelector('#pose-controls');
  const dialog = root.querySelector('#pose-dialog');
  const expand = root.querySelector('#pose-expand');
  const folders = new Map([['', catalog.poses.length]]);
  const entries = new Map(catalog.poses.map((pose) => [pose.id, pose]));
  const buttons = catalog.poses.map((pose) => {
    folders.set(pose.folder, (folders.get(pose.folder) ?? 0) + 1);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pose-button';
    button.dataset.pose = pose.id;
    button.dataset.folder = pose.folder;
    button.setAttribute('aria-pressed', 'false');
    const icon = document.createElement('i');
    icon.className = 'pose-glyph';
    icon.dataset.lucide = pose.icon || 'user-round';
    icon.setAttribute('aria-hidden', 'true');
    const name = document.createElement('b');
    name.textContent = pose.name;
    const check = document.createElement('i');
    check.dataset.lucide = 'check';
    check.className = 'pose-check';
    check.setAttribute('aria-hidden', 'true');
    button.append(icon, name, check);
    return button;
  });
  results.replaceChildren(...buttons);
  folderSelect.replaceChildren();
  folderNav.replaceChildren();
  for (const [folder, count] of folders) {
    const label = folder || '全部姿势';
    folderSelect.add(new Option(`${label} (${count})`, folder));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pose-folder-button';
    button.dataset.folder = folder;
    const icon = document.createElement('i');
    icon.dataset.lucide = folder ? 'folder' : 'layers';
    icon.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.textContent = label;
    const total = document.createElement('small');
    total.textContent = count;
    button.append(icon, name, total);
    button.addEventListener('click', () => {
      folderSelect.value = folder;
      updateResults();
    });
    folderNav.append(button);
  }

  function updateResults() {
    const query = search.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const button of buttons) {
      const pose = entries.get(button.dataset.pose);
      const matchesFolder = !folderSelect.value || pose.folder === folderSelect.value;
      const matchesSearch = `${pose.name} ${pose.folder}`.toLocaleLowerCase().includes(query);
      button.hidden = !matchesFolder || !matchesSearch;
      if (!button.hidden) visible++;
    }
    folderNav.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.folder === folderSelect.value)));
    root.querySelector('#pose-count').textContent = `${folderSelect.value || '全部姿势'} · ${visible} / ${folders.get(folderSelect.value)}`;
    root.querySelector('#pose-empty').hidden = visible > 0;
    clear.hidden = !search.value;
    results.scrollTop = 0;
  }

  function setSelection(id) {
    for (const button of buttons) {
      const selected = button.dataset.pose === id;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    root.querySelector('#pose-state').textContent = entries.get(id)?.name ?? '自定义姿势';
  }

  results.addEventListener('click', (event) => {
    const button = event.target.closest('[data-pose]');
    if (!button) return;
    onSelect(entries.get(button.dataset.pose));
    dialog.close();
  });
  folderSelect.addEventListener('change', updateResults);
  search.addEventListener('input', updateResults);
  clear.addEventListener('click', () => {
    search.value = '';
    updateResults();
    search.focus();
  });
  expand.addEventListener('click', () => {
    root.querySelector('#pose-dialog-body').append(library);
    dialog.showModal();
    search.focus();
  });
  root.querySelector('#pose-dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dialog.close();
  });
  dialog.addEventListener('close', () => {
    root.querySelector('#pose-library-home').append(library);
    expand.focus({ preventScroll: true });
  });
  dialog.addEventListener('click', (event) => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  updateResults();
  return { setSelection };
}