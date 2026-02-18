import React from 'react';

const overlayStyle = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.4)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const dialogStyle = {
  background: '#fff', borderRadius: 8, padding: '24px 28px',
  minWidth: 340, maxWidth: 440, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
};

const btnRow = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 };

export default function ConfirmDialog({ title, message, onConfirm, onCancel, confirmLabel = '確認', danger = false }) {
  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 12px' }}>{title}</h3>
        <p style={{ margin: 0, color: '#555' }}>{message}</p>
        <div style={btnRow}>
          <button onClick={onCancel} style={{ padding: '6px 16px', borderRadius: 4, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>
            取消
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '6px 16px', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: danger ? '#dc3545' : '#0d6efd', color: '#fff',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
