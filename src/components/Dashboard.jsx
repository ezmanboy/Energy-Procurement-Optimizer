import React, { useState, useCallback, useRef, useEffect } from 'react';
import FileUpload from './FileUpload.jsx';
import ResultsPanel from './ResultsPanel.jsx';
import StatsCard from './StatsCard.jsx';
import NumberInput from './NumberInput.jsx';

// phase labels so the user knows what's happening during upload + solve
const PHASE_IDLE = 'idle';
const PHASE_UPLOADING = 'uploading';
const PHASE_PROCESSING = 'processing';
const PHASE_DONE = 'done';
const PHASE_ERROR = 'error';

// css class for the timer tag — flashes green on completion, then fades back
function timerTagClass(phase) {
  if (phase === PHASE_UPLOADING || phase === PHASE_PROCESSING) return 'status-pulse';
  if (phase === PHASE_DONE) return 'status-done-flash';
  if (phase === PHASE_ERROR) return 'status-error';
  return '';
}

export default function Dashboard() {
  const [files, setFiles] = useState({ prices: null, demand: null, packages: null });
  const [config, setConfig] = useState({
    enableBnB: true,
    topK: 5,
    bnbTimeLimit: 5000,
  });
  const [result, setResult] = useState(null);
  const [phase, setPhase] = useState(PHASE_IDLE);
  const [error, setError] = useState(null);

  // status log
  const [logs, setLogs] = useState([]);
  const [jobElapsed, setJobElapsed] = useState(0);
  const [jobInfo, setJobInfo] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const pollRef = useRef(null);
  const logEndRef = useRef(null);
  const timerRef = useRef(null);
  const localElapsedRef = useRef(0);

  const allFilesReady = files.prices && files.demand && files.packages;
  const loading = phase === PHASE_UPLOADING || phase === PHASE_PROCESSING;

  const handleFileChange = useCallback((key, file) => {
    setFiles(prev => ({ ...prev, [key]: file }));
    setError(null);
  }, []);

  // local timer that ticks every 100ms so the user always sees time moving
  const startLocalTimer = () => {
    localElapsedRef.current = 0;
    timerRef.current = setInterval(() => {
      localElapsedRef.current += 100;
      setJobElapsed(localElapsedRef.current);
    }, 100);
  };

  const stopLocalTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
  };

  // poll job status
  const startPolling = (jobId) => {
    const poll = async () => {
      try {
        const resp = await fetch(`/api/jobs/${jobId}`);
        const data = await resp.json();

        setLogs(data.logs || []);
        setJobInfo(data.inputInfo || null);

        if (data.status === 'done') {
          setResult(data.result);
          setPhase(PHASE_DONE);
          setJobElapsed(data.elapsed || localElapsedRef.current);
          stopLocalTimer();
          clearInterval(pollRef.current);
          return;
        }
        if (data.status === 'error') {
          setError(data.error);
          setPhase(PHASE_ERROR);
          stopLocalTimer();
          clearInterval(pollRef.current);
          return;
        }
      } catch (err) {
        // network issue — keep polling
      }
    };

    pollRef.current = setInterval(poll, 250);
    poll();
  };

  // auto-scroll log
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      stopLocalTimer();
    };
  }, []);

  const handleSolve = async () => {
    if (!allFilesReady) return;

    setPhase(PHASE_UPLOADING);
    setError(null);
    setResult(null);
    setLogs([]);
    setJobElapsed(0);
    setJobInfo(null);
    setUploadProgress(0);
    startLocalTimer();

    // add a client-side log entry for the upload phase
    setLogs([{ ts: 0, msg: 'Uploading files to server...' }]);

    try {
      const formData = new FormData();
      formData.append('prices', files.prices);
      formData.append('demand', files.demand);
      formData.append('packages', files.packages);
      formData.append('enableBnB', config.enableBnB.toString());
      formData.append('topK', config.topK.toString());
      formData.append('bnbTimeLimit', config.bnbTimeLimit.toString());

      // use XMLHttpRequest for upload progress tracking
      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/solve');

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(pct);
            if (pct < 100) {
              setLogs([{ ts: localElapsedRef.current, msg: `Uploading files... ${pct}%` }]);
            } else {
              setLogs([{ ts: localElapsedRef.current, msg: 'Upload complete, starting solver...' }]);
            }
          }
        };

        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText);
            if (xhr.status >= 400) reject(new Error(json.error || 'Server error'));
            else resolve(json);
          } catch (e) {
            reject(new Error('Invalid server response'));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(formData);
      });

      setPhase(PHASE_PROCESSING);
      startPolling(data.jobId);
    } catch (err) {
      setError(err.message);
      setPhase(PHASE_ERROR);
      stopLocalTimer();
    }
  };

  const handleReset = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    stopLocalTimer();
    setFiles({ prices: null, demand: null, packages: null });
    setResult(null);
    setError(null);
    setPhase(PHASE_IDLE);
    setLogs([]);
    setJobElapsed(0);
    setJobInfo(null);
    setUploadProgress(0);
  };

  const formatMs = (ms) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
  };

  const phaseLabel = () => {
    switch (phase) {
      case PHASE_UPLOADING: return `uploading ${uploadProgress}%`;
      case PHASE_PROCESSING: return `solving ${formatMs(jobElapsed)}`;
      case PHASE_DONE: return `completed ${formatMs(jobElapsed)}`;
      case PHASE_ERROR: return 'error';
      default: return '';
    }
  };

  // total file sizes for display
  const totalFileSize = allFilesReady
    ? files.prices.size + files.demand.size + files.packages.size
    : 0;
  const fileSizeLabel = totalFileSize > 0
    ? totalFileSize > 1024 * 1024
      ? `${(totalFileSize / 1024 / 1024).toFixed(1)} MB total`
      : `${(totalFileSize / 1024).toFixed(1)} KB total`
    : '';

  return (
    <div className="dashboard">
      {/* upload section */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Input Data</div>
          {fileSizeLabel && <span className="meta-tag">{fileSizeLabel}</span>}
        </div>
        <div className="file-grid">
          <FileUpload
            label="prices.csv"
            hint="hourly electricity prices"
            accept=".csv"
            file={files.prices}
            onChange={(f) => handleFileChange('prices', f)}
          />
          <FileUpload
            label="demand.csv"
            hint="hourly consumption data"
            accept=".csv"
            file={files.demand}
            onChange={(f) => handleFileChange('demand', f)}
          />
          <FileUpload
            label="packages.json"
            hint="available discount packages"
            accept=".json"
            file={files.packages}
            onChange={(f) => handleFileChange('packages', f)}
          />
        </div>
      </div>

      {/* config + run */}
      <div className="dashboard-row">
        <div className="card">
          <div className="card-title">Solver Configuration</div>
          <div className="config-grid">
            <div className="config-field">
              <label>Top K starts per package</label>
              <NumberInput
                value={config.topK}
                onChange={(v) => setConfig(prev => ({ ...prev, topK: v }))}
                min={1}
                max={50}
                step={1}
              />
              <span className="config-hint">
                How many start positions to evaluate per package. Higher = more thorough but slower.
              </span>
            </div>
            <div className="config-field">
              <label>B&B time limit</label>
              <NumberInput
                value={config.bnbTimeLimit}
                onChange={(v) => setConfig(prev => ({ ...prev, bnbTimeLimit: v }))}
                min={500}
                max={30000}
                step={500}
              />
              <span className="config-hint">
                Max time (ms) for the branch-and-bound refinement pass. Longer = potentially better result.
              </span>
            </div>
          </div>
          <div style={{ marginTop: '14px' }}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={config.enableBnB}
                onChange={(e) => setConfig(prev => ({ ...prev, enableBnB: e.target.checked }))}
              />
              <span>Enable branch-and-bound refinement</span>
            </label>
            <span className="config-hint" style={{ marginLeft: '22px', display: 'block', marginTop: '4px' }}>
              Attempts to improve the greedy solution by exploring combinations. Only runs when the candidate list is small enough.
            </span>
          </div>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '16px' }}>
          <button
            className="btn btn-primary"
            disabled={!allFilesReady || loading}
            onClick={handleSolve}
            style={{ width: '100%', padding: '14px' }}
          >
            {phase === PHASE_UPLOADING ? 'Uploading...' : loading ? 'Solving...' : 'Run Optimization'}
          </button>
          <button
            className="btn"
            onClick={handleReset}
            style={{ width: '100%' }}
          >
            Reset
          </button>
          {!allFilesReady && (
            <p style={{ fontSize: '12px', fontWeight: 200, color: 'var(--text-muted)' }}>
              Upload all three files to begin
            </p>
          )}
        </div>
      </div>

      {/* status panel */}
      {(logs.length > 0 || loading) && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              {loading ? 'Solver Status' : 'Solver Log'}
            </div>
            <div className="meta-row" style={{ gap: '8px' }}>
              {jobInfo && (
                <span className="meta-tag">
                  {jobInfo.hours.toLocaleString()} hours / {jobInfo.packages.toLocaleString()} pkgs
                </span>
              )}
              <span className={`meta-tag ${timerTagClass(phase)}`}>
                {phaseLabel()}
              </span>
            </div>
          </div>

          {/* progress bar with timer */}
          {(phase === PHASE_UPLOADING || phase === PHASE_PROCESSING) && (
            <div style={{ marginBottom: '10px' }}>
              <div className="upload-progress-bar" style={{ marginBottom: '6px' }}>
                <div
                  className="upload-progress-fill"
                  style={{
                    width: phase === PHASE_UPLOADING ? `${uploadProgress}%` : '100%',
                    background: phase === PHASE_PROCESSING ? 'var(--accent)' : undefined,
                    transition: phase === PHASE_PROCESSING ? 'none' : undefined,
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: 300 }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  {phase === PHASE_UPLOADING ? `Uploading ${uploadProgress}%` : 'Solving...'}
                </span>
                <span style={{ color: 'var(--accent)', fontFamily: "'Fira Code', monospace", fontWeight: 400 }}>
                  {formatMs(jobElapsed)}
                </span>
              </div>
            </div>
          )}

          {/* log lines */}
          <div className="status-log">
            {logs.map((entry, i) => (
              <div key={i} className="status-log-line">
                <span className="status-log-time">{formatMs(entry.ts)}</span>
                <span className="status-log-msg">{entry.msg}</span>
              </div>
            ))}
            {phase === PHASE_PROCESSING && (
              <div className="status-log-line">
                <span className="status-log-time">{formatMs(jobElapsed)}</span>
                <span className="status-log-msg status-log-active">
                  <span className="dot-pulse"></span>
                  processing...
                </span>
              </div>
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* error */}
      {error && (
        <div className="card" style={{ borderColor: 'var(--error)', background: 'var(--error-dim)' }}>
          <div className="card-title" style={{ color: 'var(--error)' }}>Error</div>
          <p style={{ fontSize: '13px', fontWeight: 300, color: 'var(--text-secondary)' }}>{error}</p>
        </div>
      )}

      {/* results */}
      {result && !loading && <ResultsPanel result={result} />}
    </div>
  );
}
