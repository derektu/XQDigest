import React, { useState, useEffect, useRef } from 'react';
import ValidationStatus from './ValidationStatus';
import ConfirmDialog from './ConfirmDialog';

const formStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.5)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const modalStyle = {
  background: 'var(--color-bg-surface)',
  borderRadius: 8, padding: '24px 28px',
  width: 520, maxHeight: '85vh', overflow: 'auto',
  boxShadow: 'var(--shadow-surface)',
  border: '1px solid var(--color-border)',
};

const fieldStyle = { marginBottom: 14 };
const labelStyle = { display: 'block', marginBottom: 4, fontWeight: 500, fontSize: 13, color: 'var(--color-text-secondary)' };
const inputStyle = {
  width: '100%', padding: '6px 10px', borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-page)',
  color: 'var(--color-text-primary)',
  fontSize: 'var(--font-size-base)', boxSizing: 'border-box',
};
const btnRow = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 };
const btnPrimary = {
  padding: '7px 18px', borderRadius: 4, border: 'none',
  background: 'var(--color-accent)', color: '#fff', cursor: 'pointer',
  fontSize: 'var(--font-size-base)', fontWeight: 500,
};
const btnSecondary = {
  padding: '7px 18px', borderRadius: 4,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-surface)',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer', fontSize: 'var(--font-size-base)',
};

function generateId(type, name) {
  const prefix = type === 'youtube' ? 'yt' : 'rss';
  const slug = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20);
  if (slug) return `${prefix}-${slug}`;
  return `${prefix}-${Date.now().toString(36)}`;
}

const MIN_CHECK_INTERVAL = import.meta.env.DEV ? 1 : 5; // 分鐘

const DEFAULTS = {
  id: '', type: 'youtube', name: '', url: '',
  checkInterval: 60, maxItems: 10, lookbackDays: 7,
  prompt: '', enabled: true,
};

export default function DataSourceForm({ initial, onSave, onCancel, onValidate }) {
  const isEdit = !!initial;
  const initialForm = { ...DEFAULTS, ...initial };
  if (initial?.checkInterval) {
    initialForm.checkInterval = Math.round(initial.checkInterval / 60);
  }
  const [form, setForm] = useState(initialForm);
  const mouseDownOnOverlay = useRef(false);
  const [idManual, setIdManual] = useState(isEdit);
  const [validation, setValidation] = useState(null);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [forceSaveConfirm, setForceSaveConfirm] = useState(null);
  const [rawInputs, setRawInputs] = useState({});

  const setNum = (key, raw) => {
    setRawInputs(r => ({ ...r, [key]: raw }));
    if (raw !== '') set(key, Number(raw));
  };
  const clearRaw = (key) => setRawInputs(r => { const n = { ...r }; delete n[key]; return n; });

  useEffect(() => {
    if (!isEdit && !idManual) {
      setForm(f => ({ ...f, id: generateId(f.type, f.name) }));
    }
  }, [form.type, form.name, isEdit, idManual]);

  const set = (key, value) => {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => ({ ...e, [key]: undefined }));
  };

  const handleValidate = async () => {
    setValidating(true);
    setValidation(null);
    try {
      const result = await onValidate(form.type, form.url);
      setValidation(result);
    } catch {
      setValidation({ valid: false, error: 'Validation request failed' });
    }
    setValidating(false);
  };

  const validate = () => {
    const errs = {};
    if (!form.id.trim()) errs.id = '必填';
    if (!/^[a-z0-9][a-z0-9-]*$/.test(form.id)) errs.id = '只允許小寫字母、數字、連字號';
    if (!form.name.trim()) errs.name = '必填';
    if (!form.url.trim()) errs.url = '必填';
    if (form.checkInterval < MIN_CHECK_INTERVAL) errs.checkInterval = `最少 ${MIN_CHECK_INTERVAL} 分鐘`;
    if (form.maxItems < 1) errs.maxItems = '最少 1';
    if (form.lookbackDays < 1) errs.lookbackDays = '最少 1 天';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const doSave = async () => {
    setSaving(true);
    try {
      await onSave({ ...form, checkInterval: form.checkInterval * 60 });
    } catch (err) {
      setErrors({ _general: err.message });
    }
    setSaving(false);
  };

  const handleSave = async () => {
    if (!validate()) return;

    if (validation === null && form.url.trim()) {
      setSaving(true);
      let result = null;
      try {
        result = await onValidate(form.type, form.url);
        setValidation(result);
      } catch {
        setSaving(false);
        setForceSaveConfirm({ error: '驗證請求失敗' });
        return;
      }
      setSaving(false);

      if (!result.valid) {
        setForceSaveConfirm({ error: result.error || '驗證未通過' });
        return;
      }
    }

    await doSave();
  };

  const errStyle = { color: 'var(--color-danger)', fontSize: 12 };

  return (
    <div
      style={formStyle}
      onMouseDown={(e) => { mouseDownOnOverlay.current = (e.target === e.currentTarget); }}
      onMouseUp={(e) => { if (e.target === e.currentTarget && mouseDownOnOverlay.current) onCancel(); }}
    >
      <div style={modalStyle} onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', color: 'var(--color-text-primary)' }}>
          {isEdit ? '編輯資料源' : '新增資料源'}
        </h3>

        {errors._general && <div style={{ ...errStyle, marginBottom: 12 }}>{errors._general}</div>}

        <div style={fieldStyle}>
          <label style={labelStyle}>類型</label>
          <select value={form.type} onChange={(e) => set('type', e.target.value)} style={inputStyle} disabled={isEdit}>
            <option value="youtube">YouTube</option>
            <option value="rss">RSS</option>
          </select>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>名稱</label>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} style={inputStyle} placeholder="例：My YouTube Channel" />
          {errors.name && <span style={errStyle}>{errors.name}</span>}
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>ID</label>
          <input
            value={form.id}
            onChange={(e) => { setIdManual(true); set('id', e.target.value); }}
            style={inputStyle}
            disabled={isEdit}
            placeholder="auto-generated"
          />
          {errors.id && <span style={errStyle}>{errors.id}</span>}
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>URL</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={form.url}
              onChange={(e) => { set('url', e.target.value); setValidation(null); }}
              style={{ ...inputStyle, flex: 1 }}
              placeholder={form.type === 'youtube' ? 'https://www.youtube.com/@channel' : 'https://example.com/feed'}
            />
            <button onClick={handleValidate} disabled={validating || !form.url.trim()} style={{ ...btnSecondary, whiteSpace: 'nowrap' }}>
              驗證
            </button>
          </div>
          {errors.url && <span style={errStyle}>{errors.url}</span>}
          {form.type === 'youtube' && (
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              支援格式：<br />
              https://www.youtube.com/@ChannelHandle<br />
              https://www.youtube.com/channel/UCxxxxxx<br />
              https://www.youtube.com/c/ChannelName
            </div>
          )}
          <div style={{ marginTop: 4 }}>
            <ValidationStatus result={validation} loading={validating} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ ...fieldStyle, flex: 1 }}>
            <label style={labelStyle}>檢查間隔 (分鐘)</label>
            <input type="number" value={rawInputs.checkInterval ?? form.checkInterval} onChange={(e) => setNum('checkInterval', e.target.value)} onBlur={() => clearRaw('checkInterval')} style={inputStyle} min={MIN_CHECK_INTERVAL} />
            {errors.checkInterval && <span style={errStyle}>{errors.checkInterval}</span>}
          </div>
          <div style={{ ...fieldStyle, flex: 1 }}>
            <label style={labelStyle}>最大項目數</label>
            <input type="number" value={rawInputs.maxItems ?? form.maxItems} onChange={(e) => setNum('maxItems', e.target.value)} onBlur={() => clearRaw('maxItems')} style={inputStyle} min={1} />
            {errors.maxItems && <span style={errStyle}>{errors.maxItems}</span>}
          </div>
          <div style={{ ...fieldStyle, flex: 1 }}>
            <label style={labelStyle}>回溯天數</label>
            <input type="number" value={rawInputs.lookbackDays ?? form.lookbackDays} onChange={(e) => setNum('lookbackDays', e.target.value)} onBlur={() => clearRaw('lookbackDays')} style={inputStyle} min={1} />
            {errors.lookbackDays && <span style={errStyle}>{errors.lookbackDays}</span>}
          </div>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>自訂 Prompt (選填)</label>
          <textarea value={form.prompt} onChange={(e) => set('prompt', e.target.value)} style={{ ...inputStyle, height: 60, resize: 'vertical' }} placeholder="留空使用全域 prompt" />
        </div>

        <div style={fieldStyle}>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            啟用
          </label>
        </div>

        <div style={btnRow}>
          <button onClick={onCancel} style={btnSecondary}>取消</button>
          <button onClick={handleSave} disabled={saving} style={btnPrimary}>
            {saving ? '儲存中...' : '儲存'}
          </button>
        </div>
      </div>

      {forceSaveConfirm && (
        <ConfirmDialog
          title="URL 驗證未通過"
          message={`URL 驗證未通過（${forceSaveConfirm.error}），確定仍要儲存嗎？`}
          confirmLabel="確定儲存"
          onConfirm={() => { setForceSaveConfirm(null); doSave(); }}
          onCancel={() => setForceSaveConfirm(null)}
        />
      )}
    </div>
  );
}
