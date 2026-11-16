import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Collect Earth reuses one tab and its addresses differ only in the fragment, which does not reload
// the page by itself: reload, so the next plot starts from clean state.
window.addEventListener('hashchange', () => window.location.reload())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
