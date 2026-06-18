export default function GlassInput({ label, error, hint, type = 'text', className = '', children, ...props }) {
  return (
    <div className="form-group">
      {label && <label className="form-label">{label}</label>}
      {type === 'textarea' ? (
        <textarea className={`glass-textarea ${className}`} {...props} />
      ) : type === 'select' ? (
        <select className={`glass-select ${className}`} {...props}>
          {children}
        </select>
      ) : (
        <input type={type} className={`glass-input ${className}`} {...props} />
      )}
      {hint && <span className="form-hint">{hint}</span>}
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}
