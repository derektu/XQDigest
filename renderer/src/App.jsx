import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import DataSourcesPage from './pages/DataSourcesPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/datasources" element={<DataSourcesPage />} />
        <Route path="*" element={<Navigate to="/datasources" replace />} />
      </Routes>
    </HashRouter>
  );
}
