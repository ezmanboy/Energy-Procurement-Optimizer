#!/usr/bin/env node

// benchmark runner — tests the solver across different input sizes
// and produces a nice summary table
//
// usage: node benchmark.js
//
// this creates temporary test data, runs the solver, measures time and memory,
// then prints a markdown-compatible table you can paste into docs

import { solve } from './solver/index.js';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmpDir = resolve(__dirname, 'data', 'bench-tmp');

if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

// test configurations — each row is one benchmark
const configs = [
  { label: '168h / 20 pkg',     hours: 168,     packages: 20,     bnb: true  },
  { label: '1K h / 100 pkg',    hours: 1000,    packages: 100,    bnb: true  },
  { label: '5K h / 500 pkg',    hours: 5000,    packages: 500,    bnb: false },
  { label: '10K h / 1K pkg',    hours: 10000,   packages: 1000,   bnb: false },
  { label: '50K h / 5K pkg',    hours: 50000,   packages: 5000,   bnb: false },
  { label: '100K h / 10K pkg',  hours: 100000,  packages: 10000,  bnb: false },
  { label: '200K h / 20K pkg',  hours: 200000,  packages: 20000,  bnb: false },
  { label: '500K h / 50K pkg',  hours: 500000,  packages: 50000,  bnb: false },
];

// generate test data in memory (faster than writing/reading files for benchmarks)
function generateTestData(hours, numPackages) {
  const baseDate = new Date('2025-01-01T00:00:00Z').getTime();

  // prices CSV
  const priceLines = ['timestamp,price'];
  const demandLines = ['timestamp,demandMWh'];

  for (let i = 0; i < hours; i++) {
    const ts = new Date(baseDate + i * 3600000).toISOString();
    const hour = i % 24;

    let pBase = 60 + 30 * Math.sin((hour - 6) * Math.PI / 12);
    if (hour >= 8 && hour <= 20) pBase += 15;
    pBase += 10 * Math.sin(i / (24 * 90) * Math.PI);
    const price = Math.max(3, pBase + (Math.random() - 0.5) * 25);

    let dBase = 8 + 6 * Math.sin((hour - 4) * Math.PI / 12);
    if (hour >= 9 && hour <= 18) dBase += 4;
    if (Math.floor(i / 24) % 7 >= 5) dBase *= 0.7;
    const demand = Math.max(0.5, dBase + (Math.random() - 0.5) * 3);

    priceLines.push(`${ts},${price.toFixed(2)}`);
    demandLines.push(`${ts},${demand.toFixed(2)}`);
  }

  // packages
  const packages = [];
  for (let i = 0; i < numPackages; i++) {
    const kind = Math.random();
    let dur;
    if (kind < 0.4) dur = Math.floor(Math.random() * 12) + 2;
    else if (kind < 0.75) dur = Math.floor(Math.random() * 48) + 12;
    else dur = Math.floor(Math.random() * 168) + 24;

    packages.push({
      durationHours: dur,
      maxEnergyMWh: Math.round((Math.random() * 150 + 5) * 10) / 10,
      fee: Math.round((Math.random() * 80 + 2) * 100) / 100,
      discountPercent: Math.round((Math.random() * 30 + 3) * 10) / 10,
    });
  }

  return {
    prices: priceLines.join('\n'),
    demand: demandLines.join('\n'),
    packages: JSON.stringify(packages),
  };
}

// measure memory: we can only get a rough estimate from process.memoryUsage
function getMemMB() {
  const m = process.memoryUsage();
  return (m.heapUsed / 1024 / 1024).toFixed(1);
}

async function runBenchmark(config) {
  // force GC if possible
  if (global.gc) global.gc();

  const memBefore = parseFloat(getMemMB());

  // generate data
  const genStart = Date.now();
  const data = generateTestData(config.hours, config.packages);
  const genTime = Date.now() - genStart;

  // run solver
  const solveStart = Date.now();
  const result = await solve({ buffers: data }, {
    enableBnB: config.bnb,
    verbose: false,
    topK: 5,
    bnbTimeLimit: 3000,
  });
  const solveTime = Date.now() - solveStart;

  const memAfter = parseFloat(getMemMB());

  return {
    label: config.label,
    hours: config.hours,
    packages: config.packages,
    genTime,
    solveTime,
    totalTime: genTime + solveTime,
    memDelta: (memAfter - memBefore).toFixed(1),
    memTotal: memAfter.toFixed(1),
    pkgsBought: result.meta.packagesPurchasedCount,
    savingsPercent: result.meta.baseSpotCost > 0
      ? ((result.statistics.totalSavings / result.meta.baseSpotCost) * 100).toFixed(2)
      : '0',
    solver: result.meta.solverUsed,
    timings: result.meta.timings,
  };
}

// main
console.log('Energy Procurement Optimizer — Benchmark Suite');
console.log('================================================\n');
console.log(`Node.js ${process.version} on ${process.platform} ${process.arch}`);
console.log(`Date: ${new Date().toISOString()}\n`);

const results = [];

for (const config of configs) {
  process.stdout.write(`Running: ${config.label}... `);
  try {
    const r = await runBenchmark(config);
    console.log(`${r.solveTime}ms (${r.solver})`);
    results.push(r);
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    results.push({ label: config.label, error: err.message });
  }
}

// print results table
console.log('\n\n## Benchmark Results\n');
console.log('| Input Size | Solve Time | Parse | Prune | Greedy | B&B | Pkgs Bought | Savings | Heap MB | Solver |');
console.log('|---|---|---|---|---|---|---|---|---|---|');

for (const r of results) {
  if (r.error) {
    console.log(`| ${r.label} | ERROR | - | - | - | - | - | - | - | ${r.error} |`);
    continue;
  }
  const t = r.timings;
  console.log(
    `| ${r.label} ` +
    `| ${r.solveTime}ms ` +
    `| ${t.parse || '-'}ms ` +
    `| ${t.pruning || '-'}ms ` +
    `| ${t.greedy || '-'}ms ` +
    `| ${t.bnb || '-'}ms ` +
    `| ${r.pkgsBought} ` +
    `| ${r.savingsPercent}% ` +
    `| ${r.memTotal} ` +
    `| ${r.solver} |`
  );
}

console.log('\n_Note: "Solve Time" includes parsing. B&B is only enabled for small candidate sets._');
console.log('_Data is randomly generated — results vary between runs._\n');

// also write JSON for programmatic use
const outPath = resolve(__dirname, 'data', 'benchmark-results.json');
writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`Raw results saved to: ${outPath}`);
