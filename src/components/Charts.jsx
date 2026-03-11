import React, { useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';

// dark theme colors that match our UI
const COLORS = {
  spotCost: '#ef4444',
  optimizedCost: '#6366f1',
  savings: '#22c55e',
  demand: '#818cf8',
  packageCovered: '#6366f1',
  spotPurchased: '#f59e0b',
  price: '#a78bfa',
  priceRange: 'rgba(167, 139, 250, 0.15)',
  grid: 'rgba(255,255,255,0.08)',
  tick: '#a1a1aa',
};

// shared tooltip style
const tooltipStyle = {
  backgroundColor: '#1e1e2e',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '8px',
  fontSize: '12px',
  fontWeight: 300,
};

const TABS = [
  { key: 'cost', label: 'Cost Comparison' },
  { key: 'coverage', label: 'Package Coverage' },
  { key: 'prices', label: 'Price & Demand' },
];

export default function Charts({ charts }) {
  const [activeTab, setActiveTab] = useState('cost');

  if (!charts) return null;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div className="card-title" style={{ marginBottom: 0 }}>Analytics</div>
        <div className="chart-tabs">
          {TABS.map(tab => (
            <button
              key={tab.key}
              className={`chart-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-container">
        {activeTab === 'cost' && <CostChart data={charts.costBreakdown} bucket={charts.bucketLabel} />}
        {activeTab === 'coverage' && <CoverageChart data={charts.coverage} bucket={charts.bucketLabel} />}
        {activeTab === 'prices' && <PriceChart timeline={charts.timeline} bucket={charts.bucketLabel} />}
      </div>
    </div>
  );
}

function CostChart({ data, bucket }) {
  return (
    <>
      <p className="chart-description">
        Spot cost vs optimized cost per {bucket}. The green area shows your savings from package purchases.
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
          <XAxis
            dataKey="label"
            tick={{ fill: COLORS.tick, fontSize: 10, fontWeight: 300 }}
            interval="preserveStartEnd"
            tickLine={false}
          />
          <YAxis
            tick={{ fill: COLORS.tick, fontSize: 10, fontWeight: 300 }}
            tickLine={false}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => `$${v.toLocaleString()}`} />
          <Legend
            wrapperStyle={{ fontSize: '11px', fontWeight: 300, paddingTop: '8px' }}
          />
          <Area
            type="monotone"
            dataKey="spotCost"
            name="Spot Cost"
            fill="rgba(239,68,68,0.12)"
            stroke={COLORS.spotCost}
            strokeWidth={1.5}
          />
          <Area
            type="monotone"
            dataKey="optimizedCost"
            name="Optimized Cost"
            fill="rgba(99,102,241,0.12)"
            stroke={COLORS.optimizedCost}
            strokeWidth={1.5}
          />
          <Line
            type="monotone"
            dataKey="savings"
            name="Savings"
            stroke={COLORS.savings}
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}

function CoverageChart({ data, bucket }) {
  return (
    <>
      <p className="chart-description">
        Energy procurement breakdown: how much demand is covered by packages vs purchased at spot price.
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
          <XAxis
            dataKey="label"
            tick={{ fill: COLORS.tick, fontSize: 10, fontWeight: 300 }}
            interval="preserveStartEnd"
            tickLine={false}
          />
          <YAxis
            tick={{ fill: COLORS.tick, fontSize: 10, fontWeight: 300 }}
            tickLine={false}
            tickFormatter={(v) => `${v} MWh`}
          />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v.toLocaleString()} MWh`} />
          <Legend
            wrapperStyle={{ fontSize: '11px', fontWeight: 300, paddingTop: '8px' }}
          />
          <Bar
            dataKey="packageCovered"
            name="Package Covered"
            stackId="demand"
            fill={COLORS.packageCovered}
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="spotPurchased"
            name="Spot Purchased"
            stackId="demand"
            fill={COLORS.spotPurchased}
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

function PriceChart({ timeline, bucket }) {
  return (
    <>
      <p className="chart-description">
        Market price trends and demand over time ({bucket}ly aggregation).
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={timeline} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
          <XAxis
            dataKey="label"
            tick={{ fill: COLORS.tick, fontSize: 10, fontWeight: 300 }}
            interval="preserveStartEnd"
            tickLine={false}
          />
          <YAxis
            yAxisId="price"
            tick={{ fill: COLORS.tick, fontSize: 10, fontWeight: 300 }}
            tickLine={false}
            tickFormatter={(v) => `$${v}`}
          />
          <YAxis
            yAxisId="demand"
            orientation="right"
            tick={{ fill: COLORS.tick, fontSize: 10, fontWeight: 300 }}
            tickLine={false}
            tickFormatter={(v) => `${v} MWh`}
          />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend
            wrapperStyle={{ fontSize: '11px', fontWeight: 300, paddingTop: '8px' }}
          />
          <Area
            yAxisId="price"
            type="monotone"
            dataKey="maxPrice"
            name="Price Range"
            fill={COLORS.priceRange}
            stroke="none"
          />
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="avgPrice"
            name="Avg Price ($/MWh)"
            stroke={COLORS.price}
            strokeWidth={2}
            dot={false}
          />
          <Bar
            yAxisId="demand"
            dataKey="demand"
            name="Demand (MWh)"
            fill="rgba(129,140,248,0.3)"
            radius={[2, 2, 0, 0]}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}
