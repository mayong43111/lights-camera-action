interface Window {
  lucide?: { createIcons(): void };
  studioIdentity?: string;
}

interface WindowEventMap {
  'studio:panel-change': CustomEvent<string>;
  'studio:retouch-busy': CustomEvent<boolean>;
}