const STYLESHEET_ID = 'tether-styles';
const STYLESHEET_NAME = './styles.css';

export function mountStyles(root = document.head) {
  if (!root) return;

  if (root.querySelector(`#${STYLESHEET_ID}`)) return;

  const href = new URL(STYLESHEET_NAME, import.meta.url).href;
  const existingByHref = Array.from(root.querySelectorAll('link[rel="stylesheet"]')).find(
    (link) => link.href === href,
  );
  if (existingByHref) {
    existingByHref.id = STYLESHEET_ID;
    return;
  }

  const link = document.createElement('link');
  link.id = STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = href;
  root.appendChild(link);
}
