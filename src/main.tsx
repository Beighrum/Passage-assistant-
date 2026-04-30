import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { primeRedirectResult } from './lib/firebase';
import './index.css';

// Prime Firebase redirect capture before React effects run (Safari/Brave redirect flows).
primeRedirectResult();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
