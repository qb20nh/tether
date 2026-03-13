import './styles.css';

export function mountStyles(
  _root: ParentNode | null = typeof document !== 'undefined' ? document.head : null,
): void {
  // Vite automatically handles CSS injection via the import above.
}
