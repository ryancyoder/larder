import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'

// Booted, so whatever the recovery reload was for is behind us. Clearing the
// flag means a future stale deploy can heal itself the same way.
try {
  sessionStorage.removeItem('larder-recovering')
} catch {
  // No sessionStorage in private mode; nothing to clear.
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
