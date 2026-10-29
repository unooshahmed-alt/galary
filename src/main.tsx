import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Thaana font bundled with the app (also used when rendering PDFs)
import '@fontsource/noto-sans-thaana/400.css';
import '@fontsource/noto-sans-thaana/600.css';
import './index.css';
import { App } from './App';
import { I18nProvider } from './lib/i18n';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './components/Toast';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
