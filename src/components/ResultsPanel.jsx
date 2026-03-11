import React, { useState } from 'react';
import StatsCard from './StatsCard.jsx';
import Charts from './Charts.jsx';

// build and download an xlsx file with styled headers and zebra-striped rows
async function exportToXlsx(packagesPurchased) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Energy Procurement Optimizer';

  const ws = wb.addWorksheet('Purchased Packages');

  // columns
  ws.columns = [
    { header: '#',           key: 'num',      width: 8  },
    { header: 'Start Hour',  key: 'start',    width: 14 },
    { header: 'Duration (h)',key: 'duration',  width: 14 },
    { header: 'Max Energy (MWh)', key: 'energy', width: 18 },
    { header: 'Discount (%)',key: 'discount',  width: 14 },
    { header: 'Fee ($)',     key: 'fee',       width: 12 },
  ];

  // header row styling
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4a4a6a' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF888888' } },
    };
  });
  headerRow.height = 24;

  // data rows
  const lightBg = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
  const darkBg  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

  packagesPurchased.forEach((pkg, i) => {
    const row = ws.addRow({
      num: i + 1,
      start: pkg.startIndex,
      duration: pkg.durationHours,
      energy: pkg.maxEnergyMWh,
      discount: pkg.discountPercent,
      fee: parseFloat(pkg.fee.toFixed(2)),
    });

    const fill = i % 2 === 0 ? lightBg : darkBg;
    row.eachCell((cell) => {
      cell.fill = fill;
      cell.font = { size: 10, color: { argb: 'FF333333' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  });

  // freeze the header row
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // generate and download
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'purchased_packages.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

export default function ResultsPanel({ result }) {
  const [showRawJSON, setShowRawJSON] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = JSON.stringify(result, null, 2);
    // try modern clipboard API first, fall back to textarea trick
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  };

  const fallbackCopy = (text, onSuccess) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    onSuccess();
  };

  const { totalCost, statistics: stats, meta, packagesPurchased } = result;

  const coveragePercent = stats.totalDemandMWh > 0
    ? ((stats.energyCoveredByPackagesMWh / stats.totalDemandMWh) * 100).toFixed(1)
    : '0.0';

  const savingsPercent = meta.baseSpotCost > 0
    ? ((stats.totalSavings / meta.baseSpotCost) * 100).toFixed(2)
    : '0.00';

  return (
    <>
      {/* big total cost */}
      <div className="card total-cost-card">
        <div className="card-title">Optimized Total Cost</div>
        <div className="total-cost-value">
          ${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className="meta-row" style={{ marginTop: '12px' }}>
          <span className="meta-tag">solver: {meta.solverUsed}</span>
          <span className="meta-tag">timeline: {meta.timelineHours} hours</span>
          <span className="meta-tag">packages bought: {meta.packagesPurchasedCount}</span>
          {meta.timings?.total && <span className="meta-tag">time: {meta.timings.total}ms</span>}
        </div>
      </div>

      {/* stats grid */}
      <div className="stats-grid">
        <StatsCard
          label="Total Demand"
          value={stats.totalDemandMWh}
          sub="MWh"
        />
        <StatsCard
          label="Package Coverage"
          value={stats.energyCoveredByPackagesMWh}
          color="accent"
          sub={`${coveragePercent}% of total demand`}
        />
        <StatsCard
          label="Spot Energy"
          value={stats.spotEnergyMWh}
          color="warning"
          sub="MWh at market price"
        />
        <StatsCard
          label="Base Spot Cost"
          value={`$${meta.baseSpotCost.toLocaleString()}`}
          sub="without any packages"
        />
        <StatsCard
          label="Total Savings"
          value={`$${stats.totalSavings.toLocaleString()}`}
          color="success"
          sub={`${savingsPercent}% reduction`}
        />
        <StatsCard
          label="Fees Paid"
          value={`$${stats.totalFeesPaid.toLocaleString()}`}
          sub="package activation fees"
        />
      </div>

      {/* charts — financial visualization */}
      {result.charts && <Charts charts={result.charts} />}

      {/* purchased packages table — scrollable with export */}
      {packagesPurchased.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              Purchased Packages ({packagesPurchased.length})
            </div>
            <button
              className="btn"
              onClick={() => exportToXlsx(packagesPurchased)}
              style={{ fontSize: '12px', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
              title="Export to Excel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export XLSX
            </button>
          </div>
          <div style={{ maxHeight: '420px', overflowY: 'auto', overflowX: 'auto' }}>
            <table className="results-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Start Hour</th>
                  <th>Duration</th>
                  <th>Max Energy</th>
                  <th>Discount</th>
                  <th>Fee</th>
                </tr>
              </thead>
              <tbody>
                {packagesPurchased.map((pkg, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{pkg.startIndex}</td>
                    <td>{pkg.durationHours}h</td>
                    <td>{pkg.maxEnergyMWh} MWh</td>
                    <td>{pkg.discountPercent}%</td>
                    <td>${pkg.fee.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* raw json toggle */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Raw JSON Output</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {showRawJSON && (
              <button className="btn" onClick={handleCopy} style={{ fontSize: '12px', padding: '6px 12px' }}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            )}
            <button className="btn" onClick={() => setShowRawJSON(!showRawJSON)} style={{ fontSize: '12px', padding: '6px 12px' }}>
              {showRawJSON ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        {showRawJSON && (
          <pre className="json-output" style={{ marginTop: '12px' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    </>
  );
}
