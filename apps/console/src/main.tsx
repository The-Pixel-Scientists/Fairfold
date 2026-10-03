// SPDX-License-Identifier: AGPL-3.0-or-later

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import './main.css';

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element to show the console in.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
