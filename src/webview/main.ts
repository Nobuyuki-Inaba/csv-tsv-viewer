import type { HostToWebview, WebviewToHost } from '../shared/protocol';
import { mount } from './render';
import './table.css';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();
const api = { postMessage: (message: WebviewToHost) => vscode.postMessage(message) };

const root = document.getElementById('root');
if (root) {
  const update = mount(root, api);

  window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
    if (event.data.type === 'init') update(event.data);
  });

  api.postMessage({ type: 'ready' });
}
