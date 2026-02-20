import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import FeedPage from './pages/FeedPage';
import DataSourcesPage from './pages/DataSourcesPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/feed" element={<FeedPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/datasources" element={<Navigate to="/settings?tab=datasources" replace />} />
        <Route path="*" element={<Navigate to="/feed" replace />} />
      </Routes>
    </HashRouter>
  );
}
