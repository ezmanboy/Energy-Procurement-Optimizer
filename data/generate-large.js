#!/usr/bin/env node

// generates large-scale test data for benchmarking and stress testing
//
// usage:
//   node data/generate-large.js                     # defaults: 500k hours, 10k packages
//   node data/generate-large.js 1000000 50000       # custom: 1M hours, 50k packages
//   node data/generate-large.js --preset million     # presets: small, medium, large, million
//
// writes to data/bench-prices.csv, data/bench-demand.csv, data/bench-packages.json

import { createWriteStream, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const presets = {
  small:   { hours: 1000,    packages: 50 },
  medium:  { hours: 10000,   packages: 500 },
  large:   { hours: 100000,  packages: 5000 },
  million: { hours: 500000,  packages: 10000 },
  stress:  { hours: 500000,  packages: 100000 },
};

// figure out what the user wants
let hours, numPackages;
const arg1 = process.argv[2];

if (arg1 === '--preset' || presets[arg1]) {
  const name = arg1 === '--preset' ? process.argv[3] : arg1;
  const preset = presets[name];
  if (!preset) {
    console.error(`Unknown preset: ${name}. Available: ${Object.keys(presets).join(', ')}`);
    process.exit(1);
  }
  hours = preset.hours;
  numPackages = preset.packages;
  console.log(`Using preset "${name}"`);
} else {
  hours = parseInt(arg1) || 500000;
  numPackages = parseInt(process.argv[3]) || 10000;
}

console.log(`Generating: ${hours.toLocaleString()} hours, ${numPackages.toLocaleString()} packages`);
console.log('This might take a bit for large datasets...\n');

// stream-write CSVs to avoid blowing up memory on million-row files
async function writePricesCSV(filePath, count) {
  return new Promise((resolve2, reject) => {
    const ws = createWriteStream(filePath);
    const baseDate = new Date('2025-01-01T00:00:00Z').getTime();

    ws.write('timestamp,price\n');

    let i = 0;
    const batchSize = 10000;

    function writeBatch() {
      let ok = true;
      while (i < count && ok) {
        const ts = new Date(baseDate + i * 3600000).toISOString();
        const hour = (i % 24);

        // realistic-ish pricing: base pattern + seasonal drift + random noise
        let base = 60 + 30 * Math.sin((hour - 6) * Math.PI / 12);
        if (hour >= 8 && hour <= 20) base += 15;
        // slow drift over time (simulates seasons)
        base += 10 * Math.sin(i / (24 * 90) * Math.PI);
        const noise = (Math.random() - 0.5) * 25;
        const price = Math.max(3, base + noise);

        ok = ws.write(`${ts},${price.toFixed(2)}\n`);
        i++;

        if (i % 100000 === 0) {
          process.stdout.write(`  prices: ${(i / count * 100).toFixed(0)}%\r`);
        }
      }
      if (i < count) {
        ws.once('drain', writeBatch);
      } else {
        ws.end();
      }
    }

    ws.on('finish', () => {
      console.log(`  prices.csv: ${count.toLocaleString()} rows`);
      resolve2();
    });
    ws.on('error', reject);
    writeBatch();
  });
}

async function writeDemandCSV(filePath, count) {
  return new Promise((resolve2, reject) => {
    const ws = createWriteStream(filePath);
    const baseDate = new Date('2025-01-01T00:00:00Z').getTime();

    ws.write('timestamp,demandMWh\n');

    let i = 0;

    function writeBatch() {
      let ok = true;
      while (i < count && ok) {
        const ts = new Date(baseDate + i * 3600000).toISOString();
        const hour = (i % 24);

        let base = 8 + 6 * Math.sin((hour - 4) * Math.PI / 12);
        if (hour >= 9 && hour <= 18) base += 4;
        // weekly pattern (weekends have lower demand)
        const dayOfWeek = Math.floor(i / 24) % 7;
        if (dayOfWeek >= 5) base *= 0.7;
        const noise = (Math.random() - 0.5) * 3;
        const demand = Math.max(0.5, base + noise);

        ok = ws.write(`${ts},${demand.toFixed(2)}\n`);
        i++;

        if (i % 100000 === 0) {
          process.stdout.write(`  demand: ${(i / count * 100).toFixed(0)}%\r`);
        }
      }
      if (i < count) {
        ws.once('drain', writeBatch);
      } else {
        ws.end();
      }
    }

    ws.on('finish', () => {
      console.log(`  demand.csv: ${count.toLocaleString()} rows`);
      resolve2();
    });
    ws.on('error', reject);
    writeBatch();
  });
}

function writePackagesJSON(filePath, count) {
  // for packages we can buffer in memory — even 100k packages is only ~10MB JSON
  const packages = [];

  for (let i = 0; i < count; i++) {
    const kind = Math.random();
    let durationHours;

    if (kind < 0.4) {
      durationHours = Math.floor(Math.random() * 12) + 2;   // 2-14h (short)
    } else if (kind < 0.75) {
      durationHours = Math.floor(Math.random() * 48) + 12;  // 12-60h (medium)
    } else {
      durationHours = Math.floor(Math.random() * 168) + 24;  // 24-192h (long)
    }

    const maxEnergyMWh = Math.round((Math.random() * 150 + 5) * 10) / 10;
    const discountPercent = Math.round((Math.random() * 30 + 3) * 10) / 10;  // 3-33%
    const fee = Math.round((Math.random() * 80 + 2) * 100) / 100;

    packages.push({ durationHours, maxEnergyMWh, fee, discountPercent });

    if (i % 10000 === 0 && i > 0) {
      process.stdout.write(`  packages: ${(i / count * 100).toFixed(0)}%\r`);
    }
  }

  const json = JSON.stringify(packages);
  writeFileSync(filePath, json);
  console.log(`  packages.json: ${count.toLocaleString()} packages (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
}

const t0 = Date.now();

await writePricesCSV(resolve(__dirname, 'bench-prices.csv'), hours);
await writeDemandCSV(resolve(__dirname, 'bench-demand.csv'), hours);
await writePackagesJSON(resolve(__dirname, 'bench-packages.json'), numPackages);

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nDone in ${elapsed}s. Files written to data/ directory.`);
