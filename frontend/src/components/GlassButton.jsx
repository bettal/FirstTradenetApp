export default function GlassButton({ children, variant = 'primary', size, icon, className = '', ...props }) {
  const classes = ['btn', `btn-${variant}`];
  if (size === 'sm') classes.push('btn-sm');
  if (icon) classes.push('btn-icon');
  if (className) classes.push(className);
  return (
    <button className={classes.join(' ')} {...props}>
      {children}
    </button>
  );
}
