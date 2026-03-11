import React, { useState } from 'react';
import Dashboard from './components/Dashboard.jsx';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1>Energy Procurement Optimizer</h1>
          <span className="header-tag">hybrid solver v1.0</span>
        </div>
      </header>
      <main className="app-main">
        <Dashboard />
      </main>
      <footer className="app-footer">
        <div className="footer-content">
          <span>Developed by Vyacheslav Muranov</span>
          <a href="https://t.me/new_fores" target="_blank" rel="noopener noreferrer" className="footer-link">
            Telegram @new_fores
          </a>
        </div>
      </footer>
    </div>
  );
}
