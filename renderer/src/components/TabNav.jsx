import React from 'react';

const styles = {
  tabContainer: {
    display: 'flex',
    borderBottom: '1px solid var(--color-border)',
    background: 'var(--color-bg-surface)',
  },
  tab: (active) => ({
    padding: '12px 20px',
    cursor: 'pointer',
    fontSize: 'var(--font-size-base)',
    fontWeight: 500,
    color: active ? 'var(--color-accent)' : 'var(--color-text-muted)',
    borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
    background: 'none',
    border: 'none',
    transition: 'color 0.15s, border-color 0.15s',
    outline: 'none',
  }),
};

/**
 * Tab 導覽元件
 * @param {object} props
 * @param {Array<{id: string, label: string}>} props.tabs - Tab 列表
 * @param {string} props.activeTab - 當前啟用的 tab ID
 * @param {function} props.onTabChange - Tab 切換回調函數
 */
export default function TabNav({ tabs, activeTab, onTabChange }) {
  const handleKeyDown = (e, tabId) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onTabChange(tabId);
    }
  };

  return (
    <div style={styles.tabContainer}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          style={styles.tab(activeTab === tab.id)}
          onClick={() => onTabChange(tab.id)}
          onKeyDown={(e) => handleKeyDown(e, tab.id)}
          role="tab"
          aria-selected={activeTab === tab.id}
          tabIndex={activeTab === tab.id ? 0 : -1}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
