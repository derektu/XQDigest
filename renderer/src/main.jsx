import React from 'react';
import { createRoot } from 'react-dom/client';
import { CSS_VARS } from './theme';
import { ThemeProvider } from './ThemeContext';
import App from './App';

// Inject CSS custom properties
const styleEl = document.createElement('style');
styleEl.textContent = CSS_VARS;
document.head.appendChild(styleEl);

const root = createRoot(document.getElementById('root'));
root.render(
  <ThemeProvider>
    <App />
  </ThemeProvider>
);
