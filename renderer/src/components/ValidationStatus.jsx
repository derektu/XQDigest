import React from 'react';

export default function ValidationStatus({ result, loading }) {
  if (loading) {
    return <span style={{ color: '#666', fontSize: 13 }}>驗證中...</span>;
  }
  if (!result) return null;

  if (result.valid) {
    return (
      <span style={{ color: '#198754', fontSize: 13 }}>
        ✓ {result.info || '驗證通過'}
      </span>
    );
  }
  return (
    <span style={{ color: '#dc3545', fontSize: 13 }}>
      ✗ {result.error || '驗證失敗'}
    </span>
  );
}
