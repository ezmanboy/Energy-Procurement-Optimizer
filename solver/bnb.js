import { allocatePackageEnergy } from './utils.js';

// branch-and-bound on a shortlist of candidates
//
// the idea: after greedy gives us a good solution, we try to improve it
// by exploring combinations of candidates more carefully. we branch on
// "buy this candidate or skip it" and prune branches that can't possibly
// beat our current best.
//
// this only makes sense when the shortlist is small (say, under 50-100 items).
// for anything bigger the search space blows up.

export function solveBnB(prices, demandOriginal, candidates, initialBestSaving, opts = {}) {
  const { timeLimit = 5000, maxCandidates = 40, verbose = false } = opts;
  const T = prices.length;
  const startTime = Date.now();

  // take only the top candidates — bnb can't handle thousands
  const shortlist = candidates.slice(0, maxCandidates);

  let bestSaving = initialBestSaving;
  let bestSolution = null;
  let nodesExplored = 0;
  let pruned = 0;

  function branch(idx, demand, selected, currentNetSaving) {
    nodesExplored++;

    // bail out if we're running out of time
    // check every 200 nodes — frequent enough to respect the time limit
    if (nodesExplored % 200 === 0 && Date.now() - startTime > timeLimit) {
      return;
    }

    // base case — evaluated all candidates
    if (idx >= shortlist.length) {
      if (currentNetSaving > bestSaving) {
        bestSaving = currentNetSaving;
        bestSolution = [...selected];
      }
      return;
    }

    // upper bound: optimistic estimate of what remaining candidates could add
    // we just sum up all their estimated savings (ignoring demand conflicts)
    let optimisticRemaining = 0;
    for (let i = idx; i < shortlist.length; i++) {
      if (shortlist[i].estimatedSaving > 0) {
        optimisticRemaining += shortlist[i].estimatedSaving;
      }
    }

    // can we possibly beat the best known solution?
    if (currentNetSaving + optimisticRemaining <= bestSaving) {
      pruned++;
      return;
    }

    const c = shortlist[idx];

    // branch 1: buy this candidate
    const result = allocatePackageEnergy(
      prices, demand,
      c.startIndex, c.pkg.durationHours,
      c.pkg.maxEnergyMWh, c.pkg.discountPercent
    );

    const netSaving = result.grossSaving - c.pkg.fee;

    if (netSaving > 0) {
      // apply allocation to demand
      const newDemand = new Float64Array(demand);
      for (const a of result.allocations) {
        newDemand[a.t] -= a.amount;
      }

      selected.push(idx);
      branch(idx + 1, newDemand, selected, currentNetSaving + netSaving);
      selected.pop();
    }

    // branch 2: skip this candidate
    branch(idx + 1, demand, selected, currentNetSaving);
  }

  const demand = new Float64Array(demandOriginal);
  branch(0, demand, [], 0);

  const elapsed = Date.now() - startTime;

  if (verbose) {
    console.log(`  B&B: ${nodesExplored} nodes, ${pruned} pruned, ${elapsed}ms`);
    console.log(`  B&B improved: ${bestSolution !== null}, best saving: ${bestSaving.toFixed(2)}`);
  }

  return {
    bestSaving,
    bestSolution,   // indices into shortlist
    shortlist,
    nodesExplored,
    pruned,
    timeMs: elapsed,
    improved: bestSolution !== null && bestSaving > initialBestSaving,
  };
}
