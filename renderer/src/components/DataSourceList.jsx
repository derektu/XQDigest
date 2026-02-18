import React, { useState, useEffect } from 'react';

const tableStyle = {
  width: '100%', borderCollapse: 'collapse',
  fontSize: 'var(--font-size-base)',
};

const tdStyle = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--color-border-light)',
  color: 'var(--color-text-primary)',
};

const btnSmall = {
  padding: '3px 10px', borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer', fontSize: 12, marginRight: 4,
  transition: 'border-color 0.15s',
};

const btnDanger = {
  ...btnSmall,
  color: 'var(--color-danger)',
  borderColor: 'var(--color-danger)',
};

const TYPE_LABELS = { youtube: 'YT', rss: 'RSS' };
const TYPE_BADGE = {
  youtube: { background: 'rgba(192,57,43,0.1)', color: '#c0392b', border: '1px solid rgba(192,57,43,0.25)' },
  rss:     { background: 'rgba(192,96,0,0.1)',  color: '#c06000', border: '1px solid rgba(192,96,0,0.25)' },
};

function SortIndicator({ column, sortBy, sortDir }) {
  if (sortBy !== column) return <span style={{ color: 'var(--color-border)', marginLeft: 4 }}>↕</span>;
  return <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
}

function SortableTh({ column, label, sortBy, sortDir, onSort }) {
  const isActive = sortBy === column;
  return (
    <th
      onClick={() => onSort(column)}
      style={{
        textAlign: 'left', padding: '8px 12px',
        borderBottom: '2px solid var(--color-border)',
        color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
        fontSize: 12,
        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
      }}
    >
      {label}
      <SortIndicator column={column} sortBy={sortBy} sortDir={sortDir} />
    </th>
  );
}

function PlainTh({ children }) {
  return (
    <th style={{
      textAlign: 'left', padding: '8px 12px',
      borderBottom: '2px solid var(--color-border)',
      color: 'var(--color-text-secondary)', fontSize: 12,
    }}>
      {children}
    </th>
  );
}

function StatsCell({ id, getStats }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    getStats(id).then(setStats).catch(() => {});
  }, [id, getStats]);
  if (!stats) return <span style={{ color: 'var(--color-text-muted)' }}>-</span>;
  return <span>{stats.totalItems} 筆</span>;
}

export default function DataSourceList({ list, onEdit, onDelete, onToggle, onCheckNow, getStats, sortBy, sortDir, onSort }) {
  if (list.length === 0) {
    return <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 40 }}>尚無資料源，點擊右上角新增</p>;
  }

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <SortableTh column="name" label="名稱" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortableTh column="type" label="類型" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <SortableTh column="status" label="狀態" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
          <PlainTh>項目數</PlainTh>
          <PlainTh>操作</PlainTh>
        </tr>
      </thead>
      <tbody>
        {list.map((ds) => (
          <tr key={ds.id}>
            <td style={tdStyle}>
              <div>{ds.name}</div>
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{ds.id}</div>
            </td>
            <td style={tdStyle}>
              <span style={{
                display: 'inline-block', padding: '1px 8px', borderRadius: 12,
                fontSize: 11, fontWeight: 600,
                ...(TYPE_BADGE[ds.type] || { background: 'var(--color-bg-hover)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }),
              }}>
                {TYPE_LABELS[ds.type] || ds.type}
              </span>
            </td>
            <td style={tdStyle}>
              <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={ds.enabled}
                  onChange={() => onToggle(ds.id, !ds.enabled)}
                />
                <span style={{ color: ds.enabled ? 'var(--color-success)' : 'var(--color-text-muted)', fontSize: 12 }}>
                  {ds.enabled ? '啟用' : '停用'}
                </span>
              </label>
            </td>
            <td style={tdStyle}>
              <StatsCell id={ds.id} getStats={getStats} />
            </td>
            <td style={tdStyle}>
              <button style={btnSmall} onClick={() => onEdit(ds)}>編輯</button>
              <button style={btnSmall} onClick={() => onCheckNow(ds.id)}>立即檢查</button>
              <button style={btnDanger} onClick={() => onDelete(ds)}>刪除</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
