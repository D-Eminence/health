import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/product-tokens.css'
import './styles/tokens.css'
import './styles/components.css'
import './docs.css'
import './koro/styles/koro.css'
import { KoroApp } from './koro/KoroApp'
createRoot(document.getElementById('root')!).render(<StrictMode><KoroApp /></StrictMode>)
