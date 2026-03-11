import React from 'react';

// simple stat card — nothing fancy, just a labeled number
export default function StatsCard({ label, value, color, sub, className }) {
  return (
    <div className={`stat-card ${className || ''}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color || ''}`}>
        {typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : value}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
