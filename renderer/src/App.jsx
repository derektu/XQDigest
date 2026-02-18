import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import FeedPage from './pages/FeedPage';
import DataSourcesPage from './pages/DataSourcesPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/feed" element={<FeedPage />} />
        <Route path="/datasources" element={<DataSourcesPage />} />
        <Route path="*" element={<Navigate to="/feed" replace />} />
      </Routes>
    </HashRouter>
  );
}
