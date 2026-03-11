import React, { useState, useRef, useCallback, useEffect } from 'react';

// custom number input with styled increment/decrement buttons
// replaces the ugly browser-native spinners
export default function NumberInput({ value, onChange, min, max, step = 1, disabled }) {
  const [localValue, setLocalValue] = useState(String(value));
  const intervalRef = useRef(null);

  // sync external value changes
  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  const clamp = (v) => {
    let n = parseFloat(v);
    if (isNaN(n)) return value;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };

  const commit = (raw) => {
    const n = clamp(raw);
    setLocalValue(String(n));
    onChange(n);
  };

  const handleInputChange = (e) => {
    setLocalValue(e.target.value);
  };

  const handleBlur = () => {
    commit(localValue);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') commit(localValue);
    if (e.key === 'ArrowUp') { e.preventDefault(); commit(value + step); }
    if (e.key === 'ArrowDown') { e.preventDefault(); commit(value - step); }
  };

  const increment = () => commit(value + step);
  const decrement = () => commit(value - step);

  // hold-to-repeat: start repeating after 400ms, then every 80ms
  const startRepeat = useCallback((fn) => {
    fn();
    const timeout = setTimeout(() => {
      intervalRef.current = setInterval(fn, 80);
    }, 400);
    intervalRef.current = timeout;
  }, []);

  const stopRepeat = useCallback(() => {
    clearTimeout(intervalRef.current);
    clearInterval(intervalRef.current);
  }, []);

  return (
    <div className="num-input-wrapper">
      <button
        className="num-btn num-btn-dec"
        onMouseDown={() => startRepeat(decrement)}
        onMouseUp={stopRepeat}
        onMouseLeave={stopRepeat}
        disabled={disabled || (min !== undefined && value <= min)}
        tabIndex={-1}
        type="button"
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </button>
      <input
        type="text"
        inputMode="numeric"
        className="num-input-field"
        value={localValue}
        onChange={handleInputChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <button
        className="num-btn num-btn-inc"
        onMouseDown={() => startRepeat(increment)}
        onMouseUp={stopRepeat}
        onMouseLeave={stopRepeat}
        disabled={disabled || (max !== undefined && value >= max)}
        tabIndex={-1}
        type="button"
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 2v6M2 5h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </button>
    </div>
  );
}
