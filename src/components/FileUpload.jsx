import React, { useRef, useState } from 'react';

export default function FileUpload({ label, hint, accept, file, onChange }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleClick = () => inputRef.current?.click();

  const handleChange = (e) => {
    const f = e.target.files?.[0];
    if (f) onChange(f);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onChange(f);
  };

  // show file size in a human-readable way
  const formatSize = (bytes) => {
    if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div
      className={`upload-zone ${file ? 'has-file' : ''} ${dragging ? 'dragging' : ''}`}
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
      />
      <label>{label}</label>
      {file ? (
        <div className="file-name">{file.name} ({formatSize(file.size)})</div>
      ) : (
        <>
          {hint && <div className="upload-hint">{hint}</div>}
          <div className="upload-action">click or drag to upload</div>
        </>
      )}
    </div>
  );
}
