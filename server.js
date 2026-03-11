import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { solve } from './solver/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// serve the built frontend if it exists
const distPath = resolve(__dirname, 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
}

// health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// we keep a simple in-memory store of active solve jobs
// so the frontend can poll for status updates
const jobs = new Map();
let jobIdCounter = 0;

// start a solve job — returns immediately with a job ID
app.post('/api/solve',
  upload.fields([
    { name: 'prices', maxCount: 1 },
    { name: 'demand', maxCount: 1 },
    { name: 'packages', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      if (!req.files?.prices?.[0] || !req.files?.demand?.[0] || !req.files?.packages?.[0]) {
        return res.status(400).json({
          error: 'Missing files. Need: prices (CSV), demand (CSV), packages (JSON)',
        });
      }

      const buffers = {
        prices: req.files.prices[0].buffer.toString('utf-8'),
        demand: req.files.demand[0].buffer.toString('utf-8'),
        packages: req.files.packages[0].buffer.toString('utf-8'),
      };

      const options = {
        enableBnB: req.body?.enableBnB !== 'false',
        topK: parseInt(req.body?.topK) || 5,
        bnbTimeLimit: parseInt(req.body?.bnbTimeLimit) || 5000,
        verbose: false,
      };

      // figure out input sizes for the status log
      const priceLines = buffers.prices.trim().split('\n').length - 1;
      const pkgCount = JSON.parse(buffers.packages).length;

      const jobId = ++jobIdCounter;
      const job = {
        id: jobId,
        status: 'running',
        startedAt: Date.now(),
        logs: [],
        result: null,
        error: null,
        inputInfo: { hours: priceLines, packages: pkgCount },
      };
      jobs.set(jobId, job);

      const pushLog = (msg) => {
        job.logs.push({ ts: Date.now() - job.startedAt, msg });
      };

      pushLog(`Job started: ${priceLines} hours, ${pkgCount} packages`);
      pushLog('Parsing input data...');

      console.log(`[API] Job #${jobId}: ${priceLines} hours, ${pkgCount} packages`);

      // run the solver with a custom logger that feeds our status log
      const solveOptions = {
        ...options,
        verbose: false,
        onProgress: pushLog, // the solver will call this at each step
      };

      // run async so we can return the job ID immediately
      solve({ buffers }, solveOptions)
        .then((result) => {
          job.status = 'done';
          job.result = result;
          job.finishedAt = Date.now();
          pushLog(`Done — total cost: $${result.totalCost.toLocaleString()}`);
          console.log(`[API] Job #${jobId} done in ${job.finishedAt - job.startedAt}ms`);
        })
        .catch((err) => {
          job.status = 'error';
          job.error = err.message;
          pushLog(`Error: ${err.message}`);
          console.error(`[API] Job #${jobId} error:`, err);
        });

      res.json({ jobId });
    } catch (err) {
      console.error('[API] Solve error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// poll for job status — the frontend hits this on an interval
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(parseInt(req.params.id));
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.json({
    id: job.id,
    status: job.status,
    elapsed: Date.now() - job.startedAt,
    logs: job.logs,
    inputInfo: job.inputInfo,
    result: job.status === 'done' ? job.result : null,
    error: job.error,
  });
});

// catch-all: serve index.html for client-side routing
if (existsSync(distPath)) {
  app.get('*', (req, res) => {
    res.sendFile(resolve(distPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (existsSync(distPath)) {
    console.log('Serving built frontend from /dist');
  } else {
    console.log('No build found — run "npm run build" for production, or "npm run dev" for development');
  }
});
