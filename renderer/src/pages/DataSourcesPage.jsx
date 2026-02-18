import React, { useState, useMemo } from 'react';
import useDataSources from '../hooks/useDataSources';
import DataSourceList from '../components/DataSourceList';
import DataSourceForm from '../components/DataSourceForm';
import ConfirmDialog from '../components/ConfirmDialog';

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 8, padding: '0 4px',
};

const btnAdd = {
  padding: '7px 18px', borderRadius: 4, border: 'none',
  background: '#0d6efd', color: '#fff', cursor: 'pointer', fontSize: 14,
};

const inputSearch = {
  padding: '5px 10px', borderRadius: 4, border: '1px solid #ccc',
  fontSize: 13, width: 200,
};

export default function DataSourcesPage() {
  const { list, loading, error, add, update, remove, toggle, validate, checkNow, getStats } = useDataSources();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState(null);   // null = default (creation order)
  const [sortDir, setSortDir] = useState('asc');

  const handleAdd = () => {
    setEditTarget(null);
    setShowForm(true);
  };

  const handleEdit = (ds) => {
    setEditTarget(ds);
    setShowForm(true);
  };

  const handleSave = async (form) => {
    if (editTarget) {
      const { id, ...fields } = form;
      await update(id, fields);
    } else {
      await add(form);
    }
    setShowForm(false);
    setEditTarget(null);
  };

  const handleDelete = async () => {
    if (deleteTarget) {
      await remove(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  const handleSort = (column) => {
    if (sortBy !== column) {
      // New column: start with asc
      setSortBy(column);
      setSortDir('asc');
    } else if (sortDir === 'asc') {
      setSortDir('desc');
    } else {
      // desc → back to original order
      setSortBy(null);
      setSortDir('asc');
    }
  };

  const filteredList = useMemo(() => {
    let result = [...list];

    // Filter by search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(ds =>
        ds.name.toLowerCase().includes(q) || ds.url.toLowerCase().includes(q)
      );
    }

    // Sort
    if (sortBy) {
      result.sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'name') {
          cmp = a.name.localeCompare(b.name);
        } else if (sortBy === 'type') {
          cmp = a.type.localeCompare(b.type);
        } else if (sortBy === 'status') {
          cmp = (a.enabled ? 1 : 0) - (b.enabled ? 1 : 0);
        }
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [list, search, sortBy, sortDir]);

  const enabledCount = list.filter(ds => ds.enabled).length;
  const disabledCount = list.length - enabledCount;

  if (loading) {
    return <div style={{ padding: 24, color: '#888' }}>載入中...</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <div style={headerStyle}>
        <h2 style={{ margin: 0 }}>資料源管理</h2>
        <button style={btnAdd} onClick={handleAdd}>+ 新增來源</button>
      </div>

      {/* Stats row */}
      <div style={{ fontSize: 13, color: '#666', marginBottom: 12, padding: '0 4px' }}>
        共 {list.length} 個來源　啟用 {enabledCount}　停用 {disabledCount}
      </div>

      {/* Search toolbar */}
      <div style={{ marginBottom: 12, padding: '0 4px' }}>
        <input
          style={inputSearch}
          placeholder="搜尋名稱..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <div style={{ color: '#dc3545', marginBottom: 12 }}>Error: {error}</div>}

      <DataSourceList
        list={filteredList}
        onEdit={handleEdit}
        onDelete={(ds) => setDeleteTarget(ds)}
        onToggle={toggle}
        onCheckNow={checkNow}
        getStats={getStats}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={handleSort}
      />

      {showForm && (
        <DataSourceForm
          initial={editTarget}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditTarget(null); }}
          onValidate={validate}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="刪除資料源"
          message={`確定要刪除「${deleteTarget.name}」嗎？此操作無法復原。`}
          confirmLabel="刪除"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
