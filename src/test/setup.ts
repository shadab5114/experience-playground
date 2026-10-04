import '@testing-library/jest-dom/vitest'

// jsdom has no `matchMedia`, but pds-core's `useViewport` (TitleLockup,
// Accordion, ListGroup, Tilelet, …) calls it on first render. Stub it as a
// desktop viewport that never changes, so component tests exercise the real
// pds-core components instead of crashing on the media query.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
