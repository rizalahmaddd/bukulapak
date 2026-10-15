import { render } from 'preact';
import './styles.css';
import { App } from './app';
import { openWorkspace } from './store/data';
import { meta } from './store/meta';
import { startSyncEngine, syncNow } from './store/sync';
import { startLiveSync } from './store/live';
import { loadConfig } from './store/api';
import { updateReady } from './ui/kit';

async function boot() {
  render(<App />, document.getElementById('app')!);
  await openWorkspace(meta.value.active);
  startSyncEngine();
  void syncNow();
  startLiveSync();
  void loadConfig();
  if (navigator.storage?.persist) void navigator.storage.persist();
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    // sw.js calls clients.claim(), so on a first visit the controller is already set by the time the
    // new worker reports "activated". Only an existing controller means an older version is being replaced.
    const hadController = !!navigator.serviceWorker.controller;
    const reg = await navigator.serviceWorker.register('/sw.js');
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'activated' && hadController) updateReady.value = true;
      });
    });
  }
}

void boot();
