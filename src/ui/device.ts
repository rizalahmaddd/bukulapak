import { signal } from '@preact/signals';

export type Device = 'mobile' | 'tablet' | 'desktop';

// Keep these in sync with the @media breakpoints in styles.css.
const tabletQuery = window.matchMedia('(min-width: 744px)');
const desktopQuery = window.matchMedia('(min-width: 1180px)');

function current(): Device {
  return desktopQuery.matches ? 'desktop' : tabletQuery.matches ? 'tablet' : 'mobile';
}

export const device = signal<Device>(current());

const update = () => (device.value = current());
tabletQuery.addEventListener('change', update);
desktopQuery.addEventListener('change', update);
