// prefix sums for fast range queries
// this is one of those things that saves a ton of time when you need
// to compute interval totals thousands of times

export function buildPrefixSums(arr) {
  const n = arr.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    prefix[i + 1] = prefix[i] + arr[i];
  }
  return prefix;
}

export function rangeSum(prefix, l, r) {
  return prefix[r + 1] - prefix[l];
}

// precompute price * demand products — we use this a lot so
// it makes sense to compute once and reuse
export function buildSpotCosts(prices, demand) {
  const n = prices.length;
  const costs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    costs[i] = prices[i] * demand[i];
  }
  return costs;
}

// given a time window, greedily assign package energy to the most expensive hours
// this is the fractional knapsack approach: sort by price, fill from the top
export function computeWindowSaving(prices, demand, start, duration, maxEnergy, discountPct) {
  const end = Math.min(start + duration, prices.length);

  // grab (price, available demand) for each hour in the window
  const hours = [];
  for (let t = start; t < end; t++) {
    if (demand[t] > 0 && prices[t] > 0) {
      hours.push({ price: prices[t], avail: demand[t], t });
    }
  }

  // sort descending by price — most expensive hours first
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

// same as above but also returns allocation details
// used when we actually commit to buying a package
export function allocatePackageEnergy(prices, demand, start, duration, maxEnergy, discountPct) {
  const end = Math.min(start + duration, prices.length);

  const hours = [];
  for (let t = start; t < end; t++) {
    if (demand[t] > 0 && prices[t] > 0) {
      hours.push({ price: prices[t], avail: demand[t], t });
    }
  }

  hours.sort((a, b) => b.price - a.price);

  let energy = maxEnergy;
  let grossSaving = 0;
  let totalAllocated = 0;
  const allocations = []; // which hours got how much

  for (const h of hours) {
    if (energy <= 1e-9) break;
    const take = Math.min(h.avail, energy);
    grossSaving += take * h.price * (discountPct / 100);
    totalAllocated += take;
    energy -= take;
    allocations.push({ t: h.t, amount: take });
  }

  return { grossSaving, totalAllocated, allocations };
}

// quick sanity check: round to N decimal places
export function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
