export function createPoseSaveControls({ getEntry, getFolders, capturePose, isAvailable, save, saveAs, announce, root = document }) {
  const saveButton = root.querySelector('#pose-save');
  const saveAsButton = root.querySelector('#pose-save-as');
  const dialog = root.querySelector('#pose-save-dialog');
  const form = root.querySelector('#pose-save-form');
  const nameInput = root.querySelector('#pose-save-name');
  const folderInput = root.querySelector('#pose-save-folder');
  const error = root.querySelector('#pose-save-error');
  let snapshot = null;

  function update() {
    const entry = getEntry();
    saveButton.disabled = !isAvailable() || !entry;
    saveAsButton.disabled = !isAvailable();
    saveButton.title = entry ? `保存“${entry.name}”` : '请先另存为新姿势';
    saveButton.setAttribute('aria-label', saveButton.title);
  }

  saveButton.addEventListener('click', () => {
    if (!isAvailable() || !getEntry()) return;
    try { save(capturePose()); } catch (failure) { announce(failure.message); }
  });
  saveAsButton.addEventListener('click', () => {
    if (!isAvailable()) return;
    snapshot = capturePose();
    const entry = getEntry();
    nameInput.value = entry ? `${entry.name.slice(0, 75)} 副本` : '新姿势';
    folderInput.value = entry?.folder ?? '我的姿势';
    const options = getFolders().map((folder) => new Option(folder, folder));
    root.querySelector('#pose-save-folders').replaceChildren(...options);
    error.textContent = '';
    dialog.showModal();
    nameInput.focus();
    nameInput.select();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!snapshot || !isAvailable()) return;
    try {
      saveAs({ name: nameInput.value, folder: folderInput.value }, snapshot);
      dialog.close();
    } catch (failure) {
      error.textContent = failure.message;
    }
  });
  root.querySelector('#pose-save-cancel').addEventListener('click', () => dialog.close());
  root.querySelector('#pose-save-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    snapshot = null;
    saveAsButton.focus({ preventScroll: true });
  });
  update();
  return { update };
}