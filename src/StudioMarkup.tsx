export { Topbar } from './layout/StudioHeader';
export { Viewport } from './layout/StudioViewport';
export { CreationPanel } from './panels/ScenePanels';
export { CameraPanel } from './panels/CameraPanels';

export function AssetDialogs() {
  return (<div className="asset-dialogs"><dialog id="library-dialog" className="library-dialog" aria-labelledby="library-title">
  </dialog><dialog id="retouch-dialog" className="retouch-dialog" aria-labelledby="retouch-title"></dialog></div>);
}
