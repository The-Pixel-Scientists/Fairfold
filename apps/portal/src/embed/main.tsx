// SPDX-License-Identifier: AGPL-3.0-or-later

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '../main.css';
import { EmbedApp } from './EmbedApp.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('The page has no #root element to show the form in.');

createRoot(root).render(
  <StrictMode>
    <EmbedApp />
  </StrictMode>,
);
