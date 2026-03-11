import { createReadStream } from 'fs';
import { readFile } from 'fs/promises';
import { createInterface } from 'readline';

// stream-based CSV reader — we don't want to load 500k rows into a string
// readline gives us line-by-line access without buffering the whole file

export async function parsePricesCSV(filePath) {
  const timestamps = [];
  const prices = [];

  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let header = true;
  for await (const line of rl) {
    if (header) { header = false; continue; }
    const comma = line.indexOf(',');
    if (comma === -1) continue;

    timestamps.push(line.slice(0, comma).trim());
    prices.push(parseFloat(line.slice(comma + 1)));
  }

  // Float64Array is noticeably faster for large numeric arrays
  // than regular JS arrays — less GC pressure, better cache locality
  return { timestamps, prices: Float64Array.from(prices) };
}

export async function parseDemandCSV(filePath) {
  const values = [];

  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let header = true;
  for await (const line of rl) {
    if (header) { header = false; continue; }
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    values.push(parseFloat(line.slice(comma + 1)));
  }

  return Float64Array.from(values);
}

export async function parsePackagesJSON(filePath) {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

// alternative: parse from in-memory strings (used by the web API)
export function parsePricesFromString(content) {
  const lines = content.trim().split('\n');
  const timestamps = [];
  const prices = [];

  for (let i = 1; i < lines.length; i++) {
    const comma = lines[i].indexOf(',');
    if (comma === -1) continue;
    timestamps.push(lines[i].slice(0, comma).trim());
    prices.push(parseFloat(lines[i].slice(comma + 1)));
  }

  return { timestamps, prices: Float64Array.from(prices) };
}

export function parseDemandFromString(content) {
  const lines = content.trim().split('\n');
  const values = [];

  for (let i = 1; i < lines.length; i++) {
    const comma = lines[i].indexOf(',');
    if (comma === -1) continue;
    values.push(parseFloat(lines[i].slice(comma + 1)));
  }

  return Float64Array.from(values);
}
