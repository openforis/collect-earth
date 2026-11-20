import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { lang } from './lib/i18n'

// The editor of a survey's configuration, for hosts to embed; in its own chunk so the Explorer, opened per plot, stays small.
// oxlint-disable-next-line react/only-export-components
const Configure = lazy(() => import('./configure/Configure'))

// The title, "Collect Earth Explorer", is a product name in every language.
document.documentElement.lang = lang

// Collect Earth reuses one tab and its addresses differ only in the fragment, which does not reload
// the page by itself: reload, so the next plot starts from clean state.
window.addEventListener('hashchange', () => window.location.reload())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname.replace(/\/+$/, '') === '/configure' ? (
      <Suspense fallback={null}>
        <Configure />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
