import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthGate } from './auth';
import { I18nProvider } from './i18n';
import { LiveProvider } from './live';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AuthGate>
        <LiveProvider>
          <App />
        </LiveProvider>
      </AuthGate>
    </I18nProvider>
  </StrictMode>,
);

// Installable PWA; the service worker caches the app shell for offline use.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
