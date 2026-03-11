#!/usr/bin/env node

// generates sample data for testing the solver
// usage: node data/generate.js [hours] [numPackages]
//
// defaults to 168 hours (1 week) and 20 packages

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const hours = parseInt(process.argv[2]) || 168;
const numPackages = parseInt(process.argv[3]) || 20;

console.log(`Generating sample data: ${hours} hours, ${numPackages} packages`);

// prices follow a rough daily pattern with some noise
// peak hours (8-20) are more expensive, night is cheaper
function generatePrices(count) {
  const lines = ['timestamp,price'];
  const baseDate = new Date('2025-01-01T00:00:00Z');

  for (let i = 0; i < count; i++) {
    const date = new Date(baseDate.getTime() + i * 3600000);
    const hour = date.getUTCHours();

    // base price with daily pattern
    let base = 60 + 30 * Math.sin((hour - 6) * Math.PI / 12);
    if (hour >= 8 && hour <= 20) base += 15;

    // some random noise
    const noise = (Math.random() - 0.5) * 20;
    const price = Math.max(5, base + noise);

    lines.push(`${date.toISOString()},${price.toFixed(2)}`);
  }

  return lines.join('\n');
}

// demand also follows a pattern — higher during the day
function generateDemand(count) {
  const lines = ['timestamp,demandMWh'];
  const baseDate = new Date('2025-01-01T00:00:00Z');

  for (let i = 0; i < count; i++) {
    const date = new Date(baseDate.getTime() + i * 3600000);
    const hour = date.getUTCHours();

    let base = 8 + 6 * Math.sin((hour - 4) * Math.PI / 12);
    if (hour >= 9 && hour <= 18) base += 4;

    const noise = (Math.random() - 0.5) * 3;
    const demand = Math.max(1, base + noise);

    lines.push(`${date.toISOString()},${demand.toFixed(2)}`);
  }

  return lines.join('\n');
}

// generate a mix of short and long packages with varying parameters
function generatePackages(count) {
  const packages = [];

  for (let i = 0; i < count; i++) {
    const isLong = Math.random() < 0.3;

    const durationHours = isLong
      ? Math.floor(Math.random() * 48) + 12   // 12-60 hours
      : Math.floor(Math.random() * 12) + 2;    // 2-14 hours

    const maxEnergyMWh = Math.round((Math.random() * 80 + 10) * 10) / 10;
    const discountPercent = Math.round((Math.random() * 25 + 5) * 10) / 10;  // 5-30%
    const fee = Math.round((Math.random() * 50 + 5) * 100) / 100;

    packages.push({ durationHours, maxEnergyMWh, fee, discountPercent });
  }

  return JSON.stringify(packages, null, 2);
}

const pricesCSV = generatePrices(hours);
const demandCSV = generateDemand(hours);
const packagesJSON = generatePackages(numPackages);

writeFileSync(resolve(__dirname, 'prices.csv'), pricesCSV);
writeFileSync(resolve(__dirname, 'demand.csv'), demandCSV);
writeFileSync(resolve(__dirname, 'packages.json'), packagesJSON);

console.log('Done! Files written to data/ directory');
console.log(`  prices.csv:    ${hours} rows`);
console.log(`  demand.csv:    ${hours} rows`);
console.log(`  packages.json: ${numPackages} packages`);
