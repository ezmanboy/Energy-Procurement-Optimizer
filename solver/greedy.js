import { computeWindowSaving, allocatePackageEnergy } from './utils.js';

// sequential greedy with lazy re-evaluation
//
// the trick: we don't just blindly commit to each candidate based on its
// initial estimate. after buying a package and reducing demand, the actual
// value of remaining candidates changes. so before buying each one,
// we recalculate its saving against the current (updated) demand.
//
// this is basically the "re-evaluate top candidates" heuristic — not
// globally optimal, but surprisingly effective in practice.

export function solveGreedy(prices, demandOriginal, candidates, opts = {}) {
  const { lookAhead = 150, verbose = false } = opts;
  const T = prices.length;

  // work on a copy so we don't destroy the original demand array
  const demand = new Float64Array(demandOriginal);

  const purchased = [];
  let totalGrossSaving = 0;
  let totalFees = 0;
  let totalAllocated = 0;

  // working list of candidates we haven't processed yet
  const remaining = [...candidates];
  let round = 0;

  while (remaining.length > 0) {
    round++;

    // look at the top N candidates and re-evaluate them with current demand
    // checking ALL of them each round would be too slow
    const checkCount = Math.min(remaining.length, lookAhead);
    let bestIdx = -1;
    let bestActual = 0;

    for (let i = 0; i < checkCount; i++) {
      const c = remaining[i];
      const actual = computeWindowSaving(
        prices, demand,
        c.startIndex, c.pkg.durationHours,
        c.pkg.maxEnergyMWh, c.pkg.discountPercent
      ) - c.pkg.fee;

      if (actual > bestActual) {
        bestActual = actual;
        bestIdx = i;
      }
    }

    // nothing worth buying anymore
    if (bestIdx === -1 || bestActual <= 0) break;

    const chosen = remaining[bestIdx];
    remaining.splice(bestIdx, 1);

    // commit: allocate energy and update demand
    const result = allocatePackageEnergy(
      prices, demand,
      chosen.startIndex, chosen.pkg.durationHours,
      chosen.pkg.maxEnergyMWh, chosen.pkg.discountPercent
    );

    // actually reduce the demand for hours we covered
    for (const a of result.allocations) {
      demand[a.t] -= a.amount;
    }

    totalGrossSaving += result.grossSaving;
    totalFees += chosen.pkg.fee;
    totalAllocated += result.totalAllocated;

    purchased.push({
      startIndex: chosen.startIndex,
      durationHours: chosen.pkg.durationHours,
      maxEnergyMWh: chosen.pkg.maxEnergyMWh,
      fee: chosen.pkg.fee,
      discountPercent: chosen.pkg.discountPercent,
      // extra info for internal use
      _energyAllocated: result.totalAllocated,
      _grossSaving: result.grossSaving,
      _netSaving: result.grossSaving - chosen.pkg.fee,
    });

    if (verbose && round % 50 === 0) {
      console.log(`  Round ${round}: bought ${purchased.length} packages, gross saving ${totalGrossSaving.toFixed(2)}`);
    }
  }

  return {
    purchased,
    totalGrossSaving,
    totalFees,
    totalAllocated,
    // net saving = discount savings minus fees paid
    totalNetSaving: totalGrossSaving - totalFees,
    remainingDemand: demand,
    rounds: round,
  };
}
