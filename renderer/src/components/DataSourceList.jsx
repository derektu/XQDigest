import React, { useState, useEffect } from 'react';

const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const tdStyle = { padding: '8px 12px', borderBottom: '1px solid #eee' };
const btnSmall = { padding: '3px 10px', borderRadius: 4, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: 12, marginRight: 4 };
const btnDanger = { ...btnSmall, color: '#dc3545', borderColor: '#dc3545' };

const TYPE_LABELS = { youtube: 'YT', rss: 'RSS' };

const SORTABLE_COLUMNS = ['name', 'type', 'status'];

function SortIndicator({ column, sortBy, sortDir }) {
  if (sortBy !== column) return <span style={{ color: '#ccc', marginLeft: 4 }}>↕</span>;
  return <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
}

function SortableTh({ column, label, sortBy, sortDir, onSort }) {
  const isActive = sortBy === column;
  return (
    <th
      onClick={() => onSort(column)}
      style={{
        textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #dee2e6',
        color: isActive ? '#0d6efd' : '#555', fontSize: 13,
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
    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #dee2e6', color: '#555', fontSize: 13 }}>
      {children}
    </th>
  );
}

function StatsCell({ id, getStats }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    getStats(id).then(setStats).catch(() => {});
  }, [id, getStats]);
  if (!stats) return <span style={{ color: '#999' }}>-</span>;
  return <span>{stats.totalItems} 筆</span>;
}

export default function DataSourceList({ list, onEdit, onDelete, onToggle, onCheckNow, getStats, sortBy, sortDir, onSort }) {
  if (list.length === 0) {
    return <p style={{ color: '#888', textAlign: 'center', padding: 40 }}>尚無資料源，點擊右上角新增</p>;
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
              <div style={{ fontSize: 11, color: '#999' }}>{ds.id}</div>
            </td>
            <td style={tdStyle}>
              <span style={{
                display: 'inline-block', padding: '1px 8px', borderRadius: 10,
                fontSize: 12, fontWeight: 500,
                background: ds.type === 'youtube' ? '#fee2e2' : '#dbeafe',
                color: ds.type === 'youtube' ? '#dc2626' : '#2563eb',
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
                <span style={{ color: ds.enabled ? '#198754' : '#999', fontSize: 13 }}>
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
