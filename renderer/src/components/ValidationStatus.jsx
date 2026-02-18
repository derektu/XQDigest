import React from 'react';

export default function ValidationStatus({ result, loading }) {
  if (loading) {
    return <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>驗證中...</span>;
  }
  if (!result) return null;

  if (result.valid) {
    return (
      <span style={{ color: 'var(--color-success)', fontSize: 13 }}>
        ✓ {result.info || '驗證通過'}
      </span>
    );
  }
  return (
    <span style={{ color: 'var(--color-danger)', fontSize: 13 }}>
      ✗ {result.error || '驗證失敗'}
    </span>
  );
}
