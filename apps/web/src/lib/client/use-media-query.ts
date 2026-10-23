'use client';

import * as React from 'react';

/** `useMediaQuery('(min-width: 1024px)')`. `initial` is what the server (and first paint) assumes. */
export function useMediaQuery(query: string, initial = false): boolean {
  const [match, setMatch] = React.useState(initial);
  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}
