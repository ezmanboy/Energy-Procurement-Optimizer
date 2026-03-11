import { parsePricesCSV, parseDemandCSV, parsePackagesJSON } from './parser.js';
import { parsePricesFromString, parseDemandFromString } from './parser.js';
import { buildPrefixSums, buildSpotCosts, round } from './utils.js';
import { generateCandidates } from './pruning.js';
import { solveGreedy } from './greedy.js';
import { solveBnB } from './bnb.js';

// main solver — ties everything together
//
// the approach is a two-stage hybrid:
//   stage 1: aggressive pruning + candidate generation (fast, narrows down the search)
//   stage 2: sequential greedy with lazy re-evaluation (good solution)
//   stage 2b (optional): branch-and-bound refinement on small candidate sets
//
// this is not provably optimal for the general case, but it handles
// overlapping packages, respects all constraints, and scales to large inputs.

export async function solve(input, options = {}) {
  const {
    topK = 5,
    bnbTimeLimit = 5000,
    enableBnB = true,
    greedyLookAhead = 3000,
    verbose = true,
    onProgress = null,
  } = options;

  const log = verbose ? console.log.bind(console) : () => {};
  // progress callback — used by the web UI to stream status updates
  const progress = (msg) => {
    log(msg);
    if (onProgress) onProgress(msg);
  };

  const timings = {};
  const t0 = Date.now();

  // --- step 1: parse input data ---
  progress('[1/5] Parsing input data...');
  let prices, demand, timestamps, packages;

  if (input.files) {
    const results = await Promise.all([
      parsePricesCSV(input.files.prices),
      parseDemandCSV(input.files.demand),
      parsePackagesJSON(input.files.packages),
    ]);
    ({ timestamps, prices } = results[0]);
    demand = results[1];
    packages = results[2];
  } else if (input.buffers) {
    const priceData = parsePricesFromString(input.buffers.prices);
    timestamps = priceData.timestamps;
    prices = priceData.prices;
    demand = parseDemandFromString(input.buffers.demand);
    packages = JSON.parse(input.buffers.packages);
  } else {
    throw new Error('Need either file paths or buffer data');
  }

  const T = prices.length;
  timings.parse = Date.now() - t0;
  progress(`  Loaded ${T} hours, ${packages.length} packages (${timings.parse}ms)`);

  if (demand.length !== T) {
    throw new Error(`Mismatch: ${T} price rows but ${demand.length} demand rows`);
  }

  // --- step 2: compute baseline (all-spot cost) ---
  progress('[2/5] Computing baseline spot cost...');
  const spotCosts = buildSpotCosts(prices, demand);
  let baseSpotCost = 0;
  let totalDemand = 0;
  for (let t = 0; t < T; t++) {
    baseSpotCost += spotCosts[t];
    totalDemand += demand[t];
  }
  progress(`  Base spot cost: $${baseSpotCost.toFixed(2)}, demand: ${totalDemand.toFixed(1)} MWh`);

  // --- step 3: generate and prune candidates ---
  progress('[3/5] Pruning & generating candidates...');
  const t3 = Date.now();
  const candidates = generateCandidates(prices, demand, packages, { topK, verbose });
  timings.pruning = Date.now() - t3;
  progress(`  ${candidates.length} candidates survived (${timings.pruning}ms)`);

  if (candidates.length === 0) {
    progress('  No profitable packages — all demand at spot price');
    const out = buildOutput(baseSpotCost, [], T, totalDemand, baseSpotCost, timings, 'spot-only');
    out.meta.totalPackagesAvailable = packages.length;
    out.charts = buildChartData(prices, demand, demand, timestamps, T);
    return out;
  }

  // --- step 4: sequential greedy ---
  progress('[4/5] Running greedy solver...');
  const t4 = Date.now();
  const greedyResult = solveGreedy(prices, demand, candidates, {
    lookAhead: greedyLookAhead,
    verbose,
  });
  timings.greedy = Date.now() - t4;

  const greedyCost = baseSpotCost - greedyResult.totalNetSaving;
  progress(`  Greedy: $${greedyCost.toFixed(2)}, ${greedyResult.purchased.length} packages, ${greedyResult.rounds} rounds (${timings.greedy}ms)`);

  // --- step 5: branch-and-bound refinement ---
  let finalCost = greedyCost;
  let finalPurchased = greedyResult.purchased;
  let solverUsed = 'sequential-greedy';

  if (enableBnB && candidates.length <= 60) {
    progress(`[5/5] Branch-and-bound on ${candidates.length} candidates (limit: ${bnbTimeLimit}ms)...`);
    const t5 = Date.now();

    const bnbResult = solveBnB(
      prices, demand, candidates,
      greedyResult.totalNetSaving,
      { timeLimit: bnbTimeLimit, verbose }
    );
    timings.bnb = Date.now() - t5;

    if (bnbResult.improved) {
      const bnbPurchased = reconstructBnBSolution(
        prices, demand, bnbResult.bestSolution, bnbResult.shortlist
      );
      const bnbCost = baseSpotCost - bnbResult.bestSaving;

      if (bnbCost < finalCost) {
        finalCost = bnbCost;
        finalPurchased = bnbPurchased;
        solverUsed = 'branch-and-bound';
        progress(`  B&B improved: $${bnbCost.toFixed(2)} (was $${greedyCost.toFixed(2)})`);
      }
    } else {
      progress(`  B&B: ${bnbResult.nodesExplored} nodes, no improvement (${timings.bnb}ms)`);
    }
  } else if (enableBnB) {
    progress('[5/5] Skipping B&B — too many candidates for exact search');
  } else {
    progress('[5/5] B&B disabled by config');
  }

  timings.total = Date.now() - t0;
  progress(`Finished in ${timings.total}ms — solver: ${solverUsed}`);

  const output = buildOutput(finalCost, finalPurchased, T, totalDemand, baseSpotCost, timings, solverUsed);
  output.meta.totalPackagesAvailable = packages.length;

  // generate aggregated chart data for the frontend
  // we bucket by day (or larger) to keep the payload reasonable
  output.charts = buildChartData(prices, demand, greedyResult.remainingDemand, timestamps, T);

  return output;
}

function reconstructBnBSolution(prices, demandOriginal, solutionIndices, shortlist) {
  const demand = new Float64Array(demandOriginal);
  const purchased = [];
  for (const idx of solutionIndices) {
    const c = shortlist[idx];
    const { durationHours, maxEnergyMWh, fee, discountPercent } = c.pkg;
    const end = Math.min(c.startIndex + durationHours, prices.length);

    const hours = [];
    for (let t = c.startIndex; t < end; t++) {
      if (demand[t] > 0 && prices[t] > 0) {
        hours.push({ price: prices[t], avail: demand[t], t });
      }
    }
    hours.sort((a, b) => b.price - a.price);

    let energy = maxEnergyMWh;
    let grossSaving = 0;
    let totalAlloc = 0;

    for (const h of hours) {
      if (energy <= 1e-9) break;
      const take = Math.min(h.avail, energy);
      grossSaving += take * h.price * (discountPercent / 100);
      demand[h.t] -= take;
      totalAlloc += take;
      energy -= take;
    }

    purchased.push({
      startIndex: c.startIndex,
      durationHours, maxEnergyMWh, fee, discountPercent,
      _energyAllocated: totalAlloc,
      _grossSaving: grossSaving,
      _netSaving: grossSaving - fee,
    });
  }
  return purchased;
}

// aggregate time-series data for frontend charts
// for large timelines we bucket into days or weeks to keep the payload small
function buildChartData(prices, demand, remainingDemand, timestamps, T) {
  // decide bucket size based on timeline length
  let bucketSize;
  let bucketLabel;
  if (T <= 168) {
    bucketSize = 1;           // hourly
    bucketLabel = 'hour';
  } else if (T <= 2000) {
    bucketSize = 24;          // daily
    bucketLabel = 'day';
  } else if (T <= 20000) {
    bucketSize = 168;         // weekly
    bucketLabel = 'week';
  } else {
    bucketSize = 720;         // monthly-ish
    bucketLabel = 'month';
  }

  const numBuckets = Math.ceil(T / bucketSize);

  // price & demand over time
  const timeline = [];
  // cost breakdown: spot vs package-covered
  const costBreakdown = [];
  // package coverage per bucket
  const coverage = [];

  for (let b = 0; b < numBuckets; b++) {
    const start = b * bucketSize;
    const end = Math.min(start + bucketSize, T);
    const count = end - start;

    let sumPrice = 0, sumDemand = 0, sumRemaining = 0, sumSpotCost = 0, sumOptimizedCost = 0;
    let maxPrice = 0, minPrice = Infinity;

    for (let t = start; t < end; t++) {
      sumPrice += prices[t];
      sumDemand += demand[t];
      sumRemaining += remainingDemand[t];
      sumSpotCost += prices[t] * demand[t];
      // remaining demand is bought at spot, covered demand was bought at discount
      sumOptimizedCost += prices[t] * remainingDemand[t];
      if (prices[t] > maxPrice) maxPrice = prices[t];
      if (prices[t] < minPrice) minPrice = prices[t];
    }

    const coveredDemand = sumDemand - sumRemaining;
    const label = bucketSize === 1
      ? (timestamps?.[start]?.slice(5, 16) || `h${start}`)
      : `${bucketLabel} ${b + 1}`;

    timeline.push({
      label,
      avgPrice: round(sumPrice / count),
      maxPrice: round(maxPrice),
      minPrice: round(minPrice),
      demand: round(sumDemand),
    });

    costBreakdown.push({
      label,
      spotCost: round(sumSpotCost),
      optimizedCost: round(sumOptimizedCost),
      savings: round(sumSpotCost - sumOptimizedCost),
    });

    coverage.push({
      label,
      packageCovered: round(coveredDemand),
      spotPurchased: round(sumRemaining),
      coveragePercent: sumDemand > 0 ? round((coveredDemand / sumDemand) * 100) : 0,
    });
  }

  // package distribution by discount tier (for pie/bar chart)
  // this one doesn't need time bucketing
  const discountTiers = [
    { tier: '0-5%', count: 0, totalEnergy: 0 },
    { tier: '5-10%', count: 0, totalEnergy: 0 },
    { tier: '10-15%', count: 0, totalEnergy: 0 },
    { tier: '15-20%', count: 0, totalEnergy: 0 },
    { tier: '20-25%', count: 0, totalEnergy: 0 },
    { tier: '25%+', count: 0, totalEnergy: 0 },
  ];

  return { timeline, costBreakdown, coverage, bucketLabel, discountTiers };
}

function buildOutput(totalCost, purchased, T, totalDemand, baseSpotCost, timings, solverUsed) {
  let energyCovered = 0;
  let totalFees = 0;

  for (const p of purchased) {
    energyCovered += p._energyAllocated || 0;
    totalFees += p.fee;
  }

  const spotEnergy = totalDemand - energyCovered;
  const totalSavings = baseSpotCost - totalCost;

  return {
    totalCost: round(totalCost),
    packagesPurchased: purchased.map(p => ({
      startIndex: p.startIndex,
      durationHours: p.durationHours,
      maxEnergyMWh: p.maxEnergyMWh,
      fee: p.fee,
      discountPercent: p.discountPercent,
    })),
    statistics: {
      totalDemandMWh: round(totalDemand),
      energyCoveredByPackagesMWh: round(energyCovered),
      spotEnergyMWh: round(spotEnergy),
      totalFeesPaid: round(totalFees),
      totalSavings: round(totalSavings),
    },
    meta: {
      solverUsed,
      timelineHours: T,
      totalPackagesAvailable: 0,
      packagesPurchasedCount: purchased.length,
      baseSpotCost: round(baseSpotCost),
      timings,
    },
  };
}
