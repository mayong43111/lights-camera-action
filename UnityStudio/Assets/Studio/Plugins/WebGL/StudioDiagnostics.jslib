mergeInto(LibraryManager.library, {
  StudioPublishState: function (json) {
    window.studioState = JSON.parse(UTF8ToString(json));
    window.dispatchEvent(new CustomEvent("studio-state", { detail: window.studioState }));
  }
});