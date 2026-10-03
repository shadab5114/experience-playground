import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@shadab5114/pdesign-tokens/index.css'
import '@shadab5114/pds-core/index.css'
import './index.css'
import { App } from './app/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
