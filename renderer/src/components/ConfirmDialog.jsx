import React from 'react';

const overlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.5)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 1100,
};

const dialogStyle = {
  background: 'var(--color-bg-surface)',
  borderRadius: 8, padding: '24px 28px',
  minWidth: 340, maxWidth: 440,
  boxShadow: 'var(--shadow-surface)',
  border: '1px solid var(--color-border)',
};

const btnRow = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 };

export default function ConfirmDialog({ title, message, onConfirm, onCancel, confirmLabel = '確認', danger = false }) {
  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px', color: 'var(--color-text-primary)' }}>{title}</h3>
        <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: 14 }}>{message}</p>
        <div style={btnRow}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 16px', borderRadius: 4,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-surface)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '6px 16px', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: danger ? 'var(--color-danger)' : 'var(--color-accent)',
              color: '#fff',
              fontWeight: 500,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
