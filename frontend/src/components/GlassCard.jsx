export default function GlassCard({ children, className = '', interactive = false, onClick, style = {} }) {
  const classes = ['glass-card', className];
  if (interactive) classes.push('glass-card--interactive');
  return (
    <div className={classes.join(' ')} onClick={onClick} style={style}>
      {children}
    </div>
  );
}
