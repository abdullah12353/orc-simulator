// Pure rules for pushes and install (#42), kept DOM-free so they're tested in apps/web/test.
// A push's link is `/?world=<id>&story=<head no>` (the server's `storyUrl`); the service worker opens it.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The world and story a push asked to open, from `location.search`. */
export function storyLink(search: string): { worldId: string; storyNo: number } | null {
  const q = new URLSearchParams(search);
  const worldId = q.get('world') ?? '';
  const story = q.get('story') ?? '';
  if (!UUID.test(worldId) || !/^\d+$/.test(story)) return null;
  return { worldId, storyNo: Number(story) };
}

/** The same path with the push link's parameters dropped (for `history.replaceState` once it's closed). */
export function withoutStoryLink(pathAndSearch: string): string {
  const url = new URL(pathAndSearch, 'http://x');
  url.searchParams.delete('world');
  url.searchParams.delete('story');
  return url.pathname + url.search;
}

export type Permission = 'default' | 'granted' | 'denied';

export interface DeviceInfo {
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  /** Running as an installed app (display-mode standalone, or iOS's navigator.standalone). */
  standalone: boolean;
  ios: boolean;
  permission: Permission;
  /** VITE_VAPID_PUBLIC_KEY; empty until the operator sets the VAPID keys. */
  vapidKey: string;
}

export type PushSupport = 'available' | 'not_configured' | 'blocked' | 'install_first' | 'unsupported';

export function pushSupport(d: DeviceInfo): PushSupport {
  if (!d.vapidKey) return 'not_configured';
  // iOS Safari (16.4+) only exposes Push to a web app added to the home screen.
  if (d.ios && !d.standalone && !d.pushManager) return 'install_first';
  if (!d.serviceWorker || !d.pushManager || !d.notification) return 'unsupported';
  if (d.permission === 'denied') return 'blocked';
  return 'available';
}

/** 'prompt': the browser offered `beforeinstallprompt` (Android Chrome); 'ios': explain Add to Home Screen. */
export function installHint(d: { standalone: boolean; ios: boolean; canPrompt: boolean }): 'prompt' | 'ios' | null {
  if (d.standalone) return null;
  if (d.canPrompt) return 'prompt';
  if (d.ios) return 'ios';
  return null;
}
