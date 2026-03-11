import { buildPrefixSums } from './utils.js';

// pruning with grouped duration approach + peak-price injection
//
// groups packages by duration for shared computation, then for each group:
//   1. finds top window positions by prefix-sum spot cost (good for big-energy packages)
//   2. injects positions around globally highest-priced hours (good for small-energy packages)
//   3. builds sorted cumulative tables once per window, evaluates all group packages via binary search
//   4. neighborhood refinement around each package's best candidates

export function generateCandidates(prices, demand, packages, opts = {}) {
  const { topK = 5, verbose = false } = opts;
  const T = prices.length;

  // precompute spot costs and prefix sums
  const spotCosts = new Float64Array(T);
  let maxPrice = 0;
  for (let i = 0; i < T; i++) {
    spotCosts[i] = prices[i] * demand[i];
    if (prices[i] > maxPrice) maxPrice = prices[i];
  }

  const prefixSpotCost = buildPrefixSums(spotCosts);
  const prefixDemand = buildPrefixSums(demand);

  // find globally highest-priced hours — these are important for small-energy packages
  // that benefit most from hitting extreme price spikes
  const peakCount = Math.min(300, Math.ceil(T / 2000));
  const peakHours = findTopPriceHours(prices, demand, peakCount);

  // group packages by duration
  const durationGroups = new Map();
  let skippedByBound = 0;
  let skippedByDuration = 0;

  for (let pi = 0; pi < packages.length; pi++) {
    const pkg = packages[pi];
    const { durationHours, maxEnergyMWh, fee, discountPercent } = pkg;

    if (T - durationHours + 1 <= 0) {
      skippedByDuration++;
      continue;
    }

    // upper bound: best-case scenario for this package
    const optimistic = maxEnergyMWh * maxPrice * (discountPercent / 100);
    if (optimistic <= fee) {
      skippedByBound++;
      continue;
    }

    if (!durationGroups.has(durationHours)) {
      durationGroups.set(durationHours, []);
    }
    durationGroups.get(durationHours).push(pi);
  }

  // positions per group — diminishing returns beyond ~400
  // real quality gain comes from greedy lookAhead, not more positions here
  const positionsPerGroup = Math.min(400, Math.max(50, Math.ceil(T / 500)));

  const candidates = [];
  let totalEvaluations = 0;

  for (const [dur, pkgIndices] of durationGroups) {
    const validStarts = T - dur + 1;

    // get positions by total spot cost (primary strategy)
    const topPositions = findTopPositions(prefixSpotCost, dur, validStarts, positionsPerGroup);

    // inject positions around peak-price hours — helps small-energy packages
    // that care about individual hour prices more than aggregate window cost
    const positionSet = new Set(topPositions);
    for (const ph of peakHours) {
      const earliest = Math.max(0, ph - dur + 1);
      const latest = Math.min(validStarts - 1, ph);
      // just add the position that centers the peak in the window
      const center = Math.floor((earliest + latest) / 2);
      if (center >= 0 && center < validStarts) positionSet.add(center);
    }

    const allPositions = Array.from(positionSet);

    // pre-allocate reusable buffers for this duration group
    // avoids GC pressure from millions of small objects
    const hPrices = new Float64Array(dur);
    const hAvails = new Float64Array(dur);
    const hIndices = new Uint32Array(dur);
    const cumEnergy = new Float64Array(dur + 1);
    const cumValue = new Float64Array(dur + 1);

    for (const s of allPositions) {
      // collect hours with demand into flat arrays (no object allocation)
      let n = 0;
      for (let t = s; t < s + dur; t++) {
        if (demand[t] > 0 && prices[t] > 0) {
          hPrices[n] = prices[t];
          hAvails[n] = demand[t];
          hIndices[n] = n;
          n++;
        }
      }
      if (n === 0) continue;

      // sort indices by price descending — avoids moving float data around
      const idx = Array.from(hIndices.subarray(0, n));
      idx.sort((a, b) => hPrices[b] - hPrices[a]);

      // build cumulative tables using sorted order
      cumEnergy[0] = 0;
      cumValue[0] = 0;
      for (let i = 0; i < n; i++) {
        const j = idx[i];
        cumEnergy[i + 1] = cumEnergy[i] + hAvails[j];
        cumValue[i + 1] = cumValue[i] + hAvails[j] * hPrices[j];
      }

      const totalWindowEnergy = cumEnergy[n];

      // evaluate each package at this position
      for (const pi of pkgIndices) {
        const pkg = packages[pi];
        totalEvaluations++;

        let saving;
        if (pkg.maxEnergyMWh >= totalWindowEnergy) {
          saving = cumValue[n] * (pkg.discountPercent / 100) - pkg.fee;
        } else {
          // binary search for the cutoff point in the cumulative energy table
          const maxE = pkg.maxEnergyMWh;
          let lo = 0, hi = n;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cumEnergy[mid + 1] <= maxE) lo = mid + 1;
            else hi = mid;
          }
          // lo = fully covered hours
          saving = cumValue[lo] * (pkg.discountPercent / 100);
          const remaining = maxE - cumEnergy[lo];
          if (remaining > 0 && lo < n) {
            saving += remaining * hPrices[idx[lo]] * (pkg.discountPercent / 100);
          }
          saving -= pkg.fee;
        }

        if (saving > 0) {
          if (!pkg._candidates) pkg._candidates = [];
          pkg._candidates.push({ startIndex: s, saving });
        }
      }
    }

    // neighborhood refinement + topK collection per package
    // only refine the most promising packages — neighbor search is expensive (O(D log D) each)
    // so we skip it for packages with low initial savings
    const groupBestSavings = [];
    for (const pi of pkgIndices) {
      const pkg = packages[pi];
      if (pkg._candidates && pkg._candidates.length > 0) {
        pkg._candidates.sort((a, b) => b.saving - a.saving);
        groupBestSavings.push(pkg._candidates[0].saving);
      }
    }
    // find the threshold: only refine top 15% of packages in this group
    groupBestSavings.sort((a, b) => b - a);
    const refineThreshold = groupBestSavings[Math.min(Math.floor(groupBestSavings.length * 0.15), groupBestSavings.length - 1)] || Infinity;

    for (const pi of pkgIndices) {
      const pkg = packages[pi];
      if (!pkg._candidates || pkg._candidates.length === 0) continue;

      // neighborhood search only for top performers — saves massive sorting overhead
      if (pkg._candidates[0].saving >= refineThreshold) {
        const bestStart = pkg._candidates[0].startIndex;
        const neighborRange = Math.min(dur, 24);
        const step = Math.max(1, Math.floor(neighborRange / 6));
        const evaluated = new Set(pkg._candidates.map(c => c.startIndex));

        for (let offset = -neighborRange; offset <= neighborRange; offset += step) {
          const ns = bestStart + offset;
          if (ns >= 0 && ns < validStarts && !evaluated.has(ns)) {
            const saving = evaluateExact(prices, demand, ns, dur, pkg.maxEnergyMWh, pkg.discountPercent) - pkg.fee;
            if (saving > 0) {
              pkg._candidates.push({ startIndex: ns, saving });
            }
          }
        }
      }

      // deduplicate and take topK
      pkg._candidates.sort((a, b) => b.saving - a.saving);
      const seen = new Set();
      let added = 0;

      for (const c of pkg._candidates) {
        if (seen.has(c.startIndex)) continue;
        seen.add(c.startIndex);

        candidates.push({
          packageIndex: pi,
          startIndex: c.startIndex,
          estimatedSaving: c.saving,
          pkg: {
            durationHours: pkg.durationHours,
            maxEnergyMWh: pkg.maxEnergyMWh,
            fee: pkg.fee,
            discountPercent: pkg.discountPercent,
          },
        });

        added++;
        if (added >= topK) break;
      }

      delete pkg._candidates;
    }
  }

  candidates.sort((a, b) => b.estimatedSaving - a.estimatedSaving);

  if (verbose) {
    console.log(`  Pruning: ${skippedByBound} killed by bound, ${skippedByDuration} by duration`);
    console.log(`  Duration groups: ${durationGroups.size}, positions/group: ~${positionsPerGroup}+peaks`);
    console.log(`  Evaluations: ${totalEvaluations}, candidates: ${candidates.length}`);
  }

  return candidates;
}

// find top N hours by price (weighted by available demand so we don't pick dead hours)
function findTopPriceHours(prices, demand, count) {
  const T = prices.length;

  // we don't need a full sort — quick-select approach via sampling
  // sample a bunch of hours, find the price threshold, then full scan
  const sampleSize = Math.min(T, 50000);
  const step = Math.max(1, Math.floor(T / sampleSize));
  const samples = [];

  for (let i = 0; i < T; i += step) {
    if (demand[i] > 0) {
      samples.push(prices[i]);
    }
  }

  samples.sort((a, b) => b - a);
  const threshold = samples[Math.min(count * 3, samples.length - 1)] || 0;

  // full scan for hours above threshold
  const result = [];
  for (let i = 0; i < T; i++) {
    if (prices[i] >= threshold && demand[i] > 0) {
      result.push(i);
    }
  }

  // sort by price desc, take top count
  result.sort((a, b) => prices[b] - prices[a]);
  return result.slice(0, count);
}

// find top N positions by window spot cost for a given duration
function findTopPositions(prefixSpotCost, duration, validStarts, count) {
  if (validStarts <= count * 2) {
    const all = [];
    for (let s = 0; s < validStarts; s++) all.push(s);
    return all;
  }

  // sample to estimate threshold, then full scan
  const sampleSize = Math.min(validStarts, 50000);
  const sampleStep = Math.max(1, Math.floor(validStarts / sampleSize));
  const sampleCosts = new Float64Array(sampleSize);
  let idx = 0;

  for (let s = 0; s < validStarts && idx < sampleSize; s += sampleStep) {
    sampleCosts[idx++] = prefixSpotCost[s + duration] - prefixSpotCost[s];
  }

  const sorted = Array.from(sampleCosts.subarray(0, idx)).sort((a, b) => b - a);
  const threshIdx = Math.min(count - 1, sorted.length - 1);
  // lower margin (0.88 instead of 0.92) to catch more positions between samples
  const threshold = sorted[threshIdx] * 0.88;

  const positions = [];
  for (let s = 0; s < validStarts; s++) {
    const cost = prefixSpotCost[s + duration] - prefixSpotCost[s];
    if (cost >= threshold) {
      positions.push({ s, cost });
    }
  }

  positions.sort((a, b) => b.cost - a.cost);
  const result = positions.slice(0, count).map(p => p.s);

  // uniform diversity — cover the timeline evenly too
  const uStep = Math.max(1, Math.floor(validStarts / 50));
  for (let s = 0; s < validStarts; s += uStep) {
    result.push(s);
  }

  return [...new Set(result)];
}

// direct evaluation — greedy allocation to highest-priced hours
function evaluateExact(prices, demand, start, duration, maxEnergy, discountPct) {
  const end = Math.min(start + duration, prices.length);
  const hours = [];
  for (let t = start; t < end; t++) {
    if (demand[t] > 0 && prices[t] > 0) {
      hours.push({ price: prices[t], avail: demand[t] });
    }
  }
  hours.sort((a, b) => b.price - a.price);

  let energy = maxEnergy;
  let saving = 0;
  for (const h of hours) {
    if (energy <= 1e-9) break;
    const take = Math.min(h.avail, energy);
    saving += take * h.price * (discountPct / 100);
    energy -= take;
  }
  return saving;
}
