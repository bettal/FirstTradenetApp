export default function SlidePanel({ open, onClose, title, children, footer = null, width }) {
  return (
    <>
      <div className={`slide-overlay ${open ? 'slide-overlay--open' : ''}`} onClick={onClose} />
      <div className={`slide-panel ${open ? 'slide-panel--open' : ''}`} style={width ? { width } : undefined}>
        <div className="slide-panel__header">
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600 }}>{title}</h3>
          <button className="btn btn-ghost btn-icon" onClick={onClose} style={{ fontSize: '1.25rem' }}>
            &times;
          </button>
        </div>
        <div className="slide-panel__body">
          {children}
        </div>
        {footer && <div className="slide-panel__footer">{footer}</div>}
      </div>
    </>
  );
}
