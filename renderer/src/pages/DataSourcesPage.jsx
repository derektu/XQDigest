import React, { useState, useMemo, useEffect, useRef } from 'react';
import useDataSources from '../hooks/useDataSources';
import DataSourceList from '../components/DataSourceList';
import DataSourceForm from '../components/DataSourceForm';
import ConfirmDialog from '../components/ConfirmDialog';
import { app as appApi } from '../ipc';

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  marginBottom: 8, padding: '0 4px',
};

const btnAdd = {
  padding: '7px 18px', borderRadius: 4, border: 'none',
  background: 'var(--color-accent)', color: '#fff', cursor: 'pointer',
  fontSize: 'var(--font-size-base)', fontWeight: 500,
  transition: 'background 0.15s',
};

const btnSecondary = {
  padding: '7px 14px', borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', cursor: 'pointer',
  fontSize: 'var(--font-size-base)', fontWeight: 500,
  transition: 'background 0.15s',
};

const inputSearch = {
  padding: '5px 10px', borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-primary)',
  fontSize: 'var(--font-size-base)', width: 200,
};

/**
 * 資料源管理核心邏輯（無 page wrapper）
 * 可嵌入 SettingsPage 或獨立使用
 */
export function DataSourcesContent() {
  const { list, loading, error, add, update, remove, toggle, validate, checkNow, getStats, exportSources, importSources } = useDataSources();
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteData, setDeleteData] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [isPackaged, setIsPackaged] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    appApi.getVersion().then(data => setIsPackaged(!!data.isPackaged)).catch(() => {});
  }, []);

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
      await remove(deleteTarget.id, deleteData);
      setDeleteTarget(null);
      setDeleteData(false);
    }
  };

  const handleExport = async () => {
    try {
      await exportSources();
    } catch (err) {
      alert(`匯出失敗：${err.message}`);
    }
  };

  const handleImport = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed.sources || !Array.isArray(parsed.sources)) {
        alert('檔案格式錯誤，請選擇有效的匯出檔案');
        return;
      }
      const { imported, skipped, errors } = await importSources(parsed.sources);
      let msg = `成功匯入 ${imported} 筆`;
      if (skipped > 0) msg += `，跳過 ${skipped} 筆（URL 重複）`;
      if (errors && errors.length > 0) {
        msg += `\n\n失敗 ${errors.length} 筆：\n` + errors.map(e => `• ${e.name}：${e.reason}`).join('\n');
      }
      alert(msg);
    } catch (_err) {
      alert('檔案格式錯誤，請選擇有效的匯出檔案');
    }
  };

  const handleSort = (column) => {
    if (sortBy !== column) {
      setSortBy(column);
      setSortDir('asc');
    } else if (sortDir === 'asc') {
      setSortDir('desc');
    } else {
      setSortBy(null);
      setSortDir('asc');
    }
  };

  const filteredList = useMemo(() => {
    let result = [...list];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(ds =>
        ds.name.toLowerCase().includes(q) || ds.url.toLowerCase().includes(q)
      );
    }

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
    return <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>載入中...</div>;
  }

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <div style={headerStyle}>
        <h2 style={{ margin: 0, color: 'var(--color-text-primary)' }}>資料源管理</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btnSecondary} onClick={handleImport}>匯入</button>
          <button style={btnSecondary} onClick={handleExport}>匯出</button>
          <button style={btnAdd} onClick={handleAdd}>+ 新增來源</button>
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12, padding: '0 4px' }}>
        共 {list.length} 個來源　啟用 {enabledCount}　停用 {disabledCount}
      </div>

      <div style={{ marginBottom: 12, padding: '0 4px' }}>
        <input
          style={inputSearch}
          placeholder="搜尋名稱..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <div style={{ color: 'var(--color-danger)', marginBottom: 12 }}>Error: {error}</div>}

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
          isPackaged={isPackaged}
          existingSources={list}
        />
      )}

      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />

      {deleteTarget && (
        <ConfirmDialog
          title="刪除資料源"
          message={`確定要刪除「${deleteTarget.name}」嗎？此操作無法復原。`}
          confirmLabel="刪除"
          danger
          onConfirm={handleDelete}
          onCancel={() => { setDeleteTarget(null); setDeleteData(false); }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={deleteData} onChange={e => setDeleteData(e.target.checked)} />
            同時刪除此來源所有已儲存的文章
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * DataSourcesPage wrapper（向後相容）
 */
export default function DataSourcesPage() {
  return <DataSourcesContent />;
}
