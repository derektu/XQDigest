import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() =>
    localStorage.getItem('theme-mode') || 'light'
  );
  const [fontSize, setFontSize] = useState(() =>
    localStorage.getItem('theme-font-size') || 'medium'
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark');
    document.body.className = `font-${fontSize}`;
    localStorage.setItem('theme-mode', mode);
    localStorage.setItem('theme-font-size', fontSize);
  }, [mode, fontSize]);

  const toggleTheme = () => setMode(m => m === 'light' ? 'dark' : 'light');

  return (
    <ThemeContext.Provider value={{ mode, fontSize, toggleTheme, setFontSize }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
