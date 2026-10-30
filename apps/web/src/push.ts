// Pushes and install in the browser (#42). The service worker (public/sw.js) shows pushes and opens their
// story; this module registers it, opts a device in or out for one world (`subscribe_push` /
// `unsubscribe_push`, owner-only rows), and catches Android Chrome's install prompt.
// Not checked by hand on a phone.
import { useEffect, useState } from 'react';
import { installHint, pushSupport, type DeviceInfo, type PushSupport } from './push-link.ts';
import { supabase } from './supabase.ts';

const VAPID_KEY = ((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '').trim();

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e: unknown) => console.warn('service worker not registered', e));
  });
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function deviceInfo(): DeviceInfo {
  return {
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
    standalone: isStandalone(),
    ios: isIos(),
    permission: 'Notification' in window ? Notification.permission : 'default',
    vapidKey: VAPID_KEY,
  };
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js'));
}

/** Is this device opted in for this world? (The browser's subscription AND our row for it.) */
export async function isSubscribed(worldId: string): Promise<boolean> {
  if (pushSupport(deviceInfo()) !== 'available') return false;
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return false;
  const { data } = await supabase.rpc('my_player', { w: worldId });
  if (!data) return false;
  const { data: rows } = await supabase.from('push_subscriptions').select('id').eq('player_id', data as string).eq('endpoint', sub.endpoint);
  return (rows ?? []).length > 0;
}

/** Asks for permission (must run from a tap), subscribes this device and tells the server. */
export async function enablePushes(worldId: string): Promise<void> {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site.');
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_KEY) }));
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const { error } = await supabase.rpc('subscribe_push', {
    p_world: worldId,
    p_endpoint: json.endpoint ?? sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
  });
  if (error) throw new Error(error.message);
}

/** Opts this device out for this world. The browser subscription stays (other worlds may use it). */
export async function disablePushes(worldId: string): Promise<void> {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  const { error } = await supabase.rpc('unsubscribe_push', { p_world: worldId, p_endpoint: sub.endpoint });
  if (error) throw new Error(error.message);
}

export function usePushSupport(): PushSupport {
  const [support] = useState(() => pushSupport(deviceInfo()));
  return support;
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own button
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/** How to install here: 'prompt' (call `install()`), 'ios' (explain Add to Home Screen), or null. */
export function useInstall(): { hint: 'prompt' | 'ios' | null; install: () => Promise<void> } {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const hint = installHint({ standalone: isStandalone(), ios: isIos(), canPrompt: deferred !== null });
  return {
    hint,
    install: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      listeners.forEach((l) => l());
    },
  };
}
