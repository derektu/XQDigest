import React from 'react';
import { useTheme } from '../ThemeContext';

const FONT_OPTIONS = [
  { key: 'small', label: 'A⁻' },
  { key: 'medium', label: 'A' },
  { key: 'large', label: 'A⁺' },
];

export default function ThemeControls() {
  const { mode, fontSize, toggleTheme, setFontSize } = useTheme();

  const containerStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 12px',
  };

  const iconBtnStyle = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    padding: '3px 6px',
    borderRadius: 4,
    color: 'var(--color-text-secondary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s, color 0.15s',
  };

  const fontBtnStyle = (active) => ({
    background: active ? 'var(--color-bg-active)' : 'none',
    border: '1px solid ' + (active ? 'var(--color-accent)' : 'var(--color-border)'),
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: active ? 700 : 400,
    padding: '2px 6px',
    borderRadius: 4,
    color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
    transition: 'all 0.15s',
    lineHeight: '16px',
  });

  return (
    <div style={containerStyle}>
      <button
        style={iconBtnStyle}
        onClick={toggleTheme}
        title={mode === 'light' ? '切換深色模式' : '切換淺色模式'}
      >
        {mode === 'light' ? '🌙' : '☀️'}
      </button>
      <div style={{ display: 'flex', gap: 3, marginLeft: 2 }}>
        {FONT_OPTIONS.map(opt => (
          <button
            key={opt.key}
            style={fontBtnStyle(fontSize === opt.key)}
            onClick={() => setFontSize(opt.key)}
            title={`字體：${opt.key}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
