import './ui/style.css';
import { App } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('Element #app fehlt.');

void new App(root).init();

// Service Worker nur im Build: macht die App nach dem ersten Laden offline nutzbar.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js', { scope: './' });
  });
}
