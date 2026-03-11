#!/usr/bin/env node

// CLI entry point — run the solver from the command line
// usage: node run.js [--prices path] [--demand path] [--packages path] [--no-bnb]

import { solve } from './solver/index.js';
import { resolve } from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    prices: 'data/prices.csv',
    demand: 'data/demand.csv',
    packages: 'data/packages.json',
    bnb: true,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--prices':   opts.prices = args[++i]; break;
      case '--demand':   opts.demand = args[++i]; break;
      case '--packages': opts.packages = args[++i]; break;
      case '--no-bnb':   opts.bnb = false; break;
      case '--help':
        console.log('Usage: node run.js [options]');
        console.log('  --prices   <path>  Path to prices.csv (default: data/prices.csv)');
        console.log('  --demand   <path>  Path to demand.csv (default: data/demand.csv)');
        console.log('  --packages <path>  Path to packages.json (default: data/packages.json)');
        console.log('  --no-bnb           Disable branch-and-bound refinement');
        process.exit(0);
    }
  }

  return opts;
}

async function main() {
  const args = parseArgs();

  console.log('Energy Procurement Optimizer');
  console.log('============================\n');

  try {
    const result = await solve(
      {
        files: {
          prices: resolve(args.prices),
          demand: resolve(args.demand),
          packages: resolve(args.packages),
        },
      },
      {
        enableBnB: args.bnb,
        verbose: true,
      }
    );

    console.log('\n--- RESULT ---\n');
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
