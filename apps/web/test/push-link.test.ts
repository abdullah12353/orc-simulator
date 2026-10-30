// Pushes and install on the client (#42): tapping a push opens `/?world=<id>&story=<no>`, and the opt-in
// offers only what this device can do (iOS Safari can only take pushes once installed to the home screen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installHint, pushSupport, storyLink, withoutStoryLink, type Permission } from '../src/push-link.ts';

const WORLD = '6f1c1e5e-6d5b-4c1e-9a52-3b0a3c5c1f00';

test('a push link names a world and a story', () => {
  assert.deepEqual(storyLink(`?world=${WORLD}&story=42`), { worldId: WORLD, storyNo: 42 });
  assert.equal(storyLink(''), null);
  assert.equal(storyLink(`?world=${WORLD}`), null);
  assert.equal(storyLink(`?world=${WORLD}&story=abc`), null);
  assert.equal(storyLink(`?world=${WORLD}&story=-3`), null);
  assert.equal(storyLink('?world=not-a-uuid&story=4'), null);
});

test('closing the story drops the link but keeps anything else in the URL', () => {
  assert.equal(withoutStoryLink(`/?world=${WORLD}&story=42`), '/');
  assert.equal(withoutStoryLink(`/?world=${WORLD}&story=42&x=1`), '/?x=1');
});

const device = {
  serviceWorker: true,
  pushManager: true,
  notification: true,
  standalone: false,
  ios: false,
  permission: 'default' as Permission,
  vapidKey: 'BPub',
};

test('what the push opt-in can offer on this device', () => {
  assert.equal(pushSupport(device), 'available');
  assert.equal(pushSupport({ ...device, vapidKey: '' }), 'not_configured', 'no VAPID key: say so, never subscribe');
  assert.equal(pushSupport({ ...device, permission: 'denied' }), 'blocked');
  assert.equal(pushSupport({ ...device, serviceWorker: false }), 'unsupported');
  // iOS Safari exposes push only to a home-screen app.
  assert.equal(pushSupport({ ...device, ios: true, pushManager: false }), 'install_first');
  assert.equal(pushSupport({ ...device, ios: true, standalone: true }), 'available');
});

test('how to install: the browser prompt where there is one, Add to Home Screen on iOS, nothing once installed', () => {
  assert.equal(installHint({ standalone: true, ios: false, canPrompt: true }), null);
  assert.equal(installHint({ standalone: false, ios: false, canPrompt: true }), 'prompt');
  assert.equal(installHint({ standalone: false, ios: true, canPrompt: false }), 'ios');
  assert.equal(installHint({ standalone: false, ios: false, canPrompt: false }), null);
});
