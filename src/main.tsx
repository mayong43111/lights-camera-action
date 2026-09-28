import { createRoot } from 'react-dom/client';
import { App } from './App';
import '../styles.css';
import './react.css';
import './layout/studio-layout.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
export function mountApplication(container: HTMLElement) {
	const application = createRoot(container);
	application.render(<App />);
	return application;
}
export const application = mountApplication(root);