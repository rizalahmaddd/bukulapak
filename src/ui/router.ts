import { signal } from '@preact/signals';

function current() {
  return location.hash.replace(/^#/, '') || '/';
}

export const route = signal(current());

window.addEventListener('hashchange', () => {
  route.value = current();
  window.scrollTo(0, 0);
});

export function go(path: string, replace = false) {
  if (replace) {
    history.replaceState(null, '', `#${path}`);
    route.value = path;
  } else {
    location.hash = path;
  }
}

export function back(fallback = '/') {
  if (history.length > 1) history.back();
  else go(fallback, true);
}

export function match(pattern: string, path: string): Record<string, string> | null {
  const [p] = path.split('?');
  const a = pattern.split('/');
  const b = p.split('/');
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export function query(path: string): URLSearchParams {
  return new URLSearchParams(path.split('?')[1] ?? '');
}
