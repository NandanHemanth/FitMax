import type { SpaceHome } from './home';

export const HOME_KEY = 'fitmax.space.home';

/** Opens the 3D interior designer at the CoStar home nearest this place (from Places, "FitMax this home"). */
export function openSpace(home: SpaceHome) {
  try {
    sessionStorage.setItem(HOME_KEY, JSON.stringify(home));
  } catch {
    /* storage blocked: the builder falls back to its default home */
  }
  location.hash = '/interior';
}
