import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dataSources, engine as engineIpc, app as appIpc } from '../ipc';
import ThemeControls from './ThemeControls';

const styles = {
  nav: {
    width: 200,
    minWidth: 200,
    borderRight: '1px solid var(--color-border)',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: 'var(--color-bg-sidebar)',
    flexShrink: 0,
  },
  logoArea: {
    padding: '14px 16px 10px',
    borderBottom: '1px solid var(--color-border-light)',
    flexShrink: 0,
  },
  logoTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: 'var(--color-primary)',
    letterSpacing: '0.02em',
  },
  logoSubtitle: {
    fontSize: 10,
    color: 'var(--color-text-muted)',
    marginTop: 2,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  sectionHeader: {
    padding: '10px 16px 6px',
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--color-text-muted)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  item: (active) => ({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '7px 16px',
    cursor: 'pointer',
    background: active ? 'var(--color-bg-active)' : 'transparent',
    borderLeft: active ? '3px solid var(--color-active-accent)' : '3px solid transparent',
    fontSize: 'var(--font-size-base)',
    color: active ? 'var(--color-active-accent)' : 'var(--color-text-primary)',
    transition: 'background 0.15s, color 0.15s',
  }),
  name: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
    minWidth: 0,
  },
  badge: {
    fontSize: 10,
    background: 'var(--color-badge-bg)',
    color: 'var(--color-badge-text)',
    borderRadius: 10,
    padding: '1px 6px',
    marginLeft: 6,
    flexShrink: 0,
    fontWeight: 600,
  },
  sourceList: {
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
  },
  footer: {
    marginTop: 'auto',
    borderTop: '1px solid var(--color-border)',
    flexShrink: 0,
  },
  footerLink: {
    display: 'block',
    fontSize: 12,
    color: 'var(--color-accent)',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    padding: '10px 16px',
    textAlign: 'left',
    width: '100%',
    transition: 'color 0.15s',
  },
  llmWarning: {
    padding: '8px 14px',
    background: 'rgba(255,160,0,0.12)',
    borderTop: '1px solid rgba(255,160,0,0.3)',
    fontSize: 11,
    color: '#c97c00',
    cursor: 'pointer',
    lineHeight: 1.4,
  },
};

export default function SourceNav({ selectedSourceId, onSelect, unreadCounts }) {
  const navigate = useNavigate();
  const [sources, setSources] = useState([]);
  const [llmConfigured, setLlmConfigured] = useState(true);
  const [version, setVersion] = useState(null);

  useEffect(() => {
    appIpc.getVersion().then(r => setVersion(r.version)).catch(() => {});
  }, []);

  useEffect(() => {
    dataSources.list()
      .then(data => setSources(data))
      .catch(() => setSources([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      engineIpc.getStatus()
        .then(s => { if (!cancelled) setLlmConfigured(s.llmConfigured); })
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const allUnread = unreadCounts?.all ?? 0;

  return (
    <nav style={styles.nav}>
      <div style={styles.logoArea}>
        <div style={styles.logoTitle}>XQDigest</div>
        <div style={styles.logoSubtitle}>財經資訊摘要</div>
        {version && (
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>v{version}</div>
        )}
      </div>

      <div style={styles.sectionHeader}>來源</div>

      <div style={styles.sourceList}>
        <div
          style={styles.item(selectedSourceId === null)}
          onClick={() => onSelect(null)}
        >
          <span style={styles.name}>全部</span>
          {allUnread > 0 && <span style={styles.badge}>{allUnread}</span>}
        </div>

        {sources.map(ds => {
          const unread = unreadCounts?.bySource?.[ds.id] ?? 0;
          return (
            <div
              key={ds.id}
              style={styles.item(selectedSourceId === ds.id)}
              onClick={() => onSelect(ds.id)}
            >
              <span style={styles.name}>{ds.name}</span>
              {unread > 0 && <span style={styles.badge}>{unread}</span>}
            </div>
          );
        })}
      </div>

      <div style={styles.footer}>
        {!llmConfigured && (
          <div style={styles.llmWarning} onClick={() => navigate('/settings?tab=llm')}>
            ⚠ LLM 尚未設定 → 前往設定
          </div>
        )}
        <ThemeControls />
        <div style={{ borderTop: '1px solid var(--color-border-light)' }}>
          <button style={styles.footerLink} onClick={() => navigate('/settings')}>
            ⚙ 設定
          </button>
        </div>
      </div>
    </nav>
  );
}
