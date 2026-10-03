import { useEffect, useState } from 'react';

export type Route =
  | { page: 'overview' }
  | { page: 'machine'; id: string }
  | { page: 'alerts' }
  | { page: 'maintenance' }
  | { page: 'whatif'; id?: string }
  | { page: 'compare' }
  | { page: 'model' }
  | { page: 'how' }
  | { page: 'impact' };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  switch (parts[0]) {
    case 'machine':
      return parts[1] ? { page: 'machine', id: decodeURIComponent(parts[1]) } : { page: 'overview' };
    case 'alerts':
      return { page: 'alerts' };
    case 'maintenance':
      return { page: 'maintenance' };
    case 'whatif':
      return { page: 'whatif', id: parts[1] ? decodeURIComponent(parts[1]) : undefined };
    case 'compare':
      return { page: 'compare' };
    case 'model':
      return { page: 'model' };
    case 'how':
      return { page: 'how' };
    case 'impact':
      return { page: 'impact' };
    default:
      return { page: 'overview' };
  }
}

export function href(route: Route): string {
  switch (route.page) {
    case 'machine':
      return `#/machine/${encodeURIComponent(route.id)}`;
    case 'whatif':
      return route.id ? `#/whatif/${encodeURIComponent(route.id)}` : '#/whatif';
    case 'overview':
      return '#/';
    default:
      return `#/${route.page}`;
  }
}

export function navigate(route: Route) {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
