export const CSS_VARS = `
  :root {
    --color-primary: #1e3a5f;
    --color-accent: #2d6be4;
    --color-accent-hover: #1e5bcc;
    --color-bg-page: #eef2f8;
    --color-bg-surface: #ffffff;
    --color-bg-sidebar: #f4f7fc;
    --color-bg-active: #dce8fc;
    --color-bg-hover: #f0f5fc;
    --color-border: #cdd7e8;
    --color-border-light: #e4ecf5;
    --color-text-primary: #1a2332;
    --color-text-secondary: #485e78;
    --color-text-muted: #7a8fa8;
    --color-active-accent: #2d6be4;
    --color-badge-bg: #2d6be4;
    --color-badge-text: #ffffff;
    --color-success: #237c4f;
    --color-danger: #b83232;
    --color-code-bg: #f0f4f8;
    --shadow-surface: 0 1px 3px rgba(30,58,95,0.08);
    --font-size-base: 14px;
  }

  .dark {
    --color-primary: #93b8f0;
    --color-accent: #5b9af5;
    --color-accent-hover: #7ab2f8;
    --color-bg-page: #0d1829;
    --color-bg-surface: #192840;
    --color-bg-sidebar: #111e31;
    --color-bg-active: #1d3257;
    --color-bg-hover: #172540;
    --color-border: #253c5c;
    --color-border-light: #1e3050;
    --color-text-primary: #dce8f5;
    --color-text-secondary: #8baec8;
    --color-text-muted: #5e7d9a;
    --color-active-accent: #5b9af5;
    --color-badge-bg: #2d6be4;
    --color-badge-text: #ffffff;
    --color-success: #4ade80;
    --color-danger: #f87171;
    --color-code-bg: #152035;
    --shadow-surface: 0 1px 3px rgba(0,0,0,0.4);
  }

  .font-small { --font-size-base: 12px; }
  .font-medium { --font-size-base: 14px; }
  .font-large { --font-size-base: 16px; }

  *, *::before, *::after { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    font-size: var(--font-size-base);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft JhengHei", "PingFang TC", sans-serif;
    background: var(--color-bg-page);
    color: var(--color-text-primary);
    transition: background 0.2s, color 0.2s;
  }

  #root { height: 100%; }
`;

export const FONT_SIZES = { small: '12px', medium: '14px', large: '16px' };
