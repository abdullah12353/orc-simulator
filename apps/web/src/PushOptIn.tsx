import { useEffect, useState } from 'react';
import { reasonText } from './invite-link.ts';
import { disablePushes, enablePushes, isSubscribed, useInstall, usePushSupport } from './push.ts';

// Install and push opt-in lines (#42), shown above a world's tabs. Pushes are only about your Stable and
// your own Meddles, at most 3 a day, never 23:00–08:00 London time, never about gold (D54).
// Not checked by hand on a phone.

export function InstallPrompt() {
  const { hint, install } = useInstall();
  if (hint === 'prompt') {
    return (
      <p className="install">
        Keep the fortress on your home screen. <button onClick={() => void install()}>Install the app</button>
      </p>
    );
  }
  if (hint === 'ios') {
    return <p className="install">To install: tap Share, then “Add to Home Screen”. Pushes on iPhone need the installed app.</p>;
  }
  return null;
}

export function PushOptIn({ worldId }: { worldId: string }) {
  const support = usePushSupport();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (support === 'available')
      void isSubscribed(worldId)
        .then((v) => !cancelled && setOn(v))
        .catch(() => !cancelled && setOn(false));
    return () => {
      cancelled = true;
    };
  }, [worldId, support]);

  // No VAPID key configured, or a browser without Web Push: say nothing rather than offer a dead switch.
  if (support === 'not_configured' || support === 'unsupported') return null;
  if (support === 'install_first') return null; // InstallPrompt already explains
  if (support === 'blocked') return <p className="pushes quiet">Notifications are blocked for this site in your browser settings.</p>;
  if (on === null) return null;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (on) await disablePushes(worldId);
      else await enablePushes(worldId);
      setOn(!on);
    } catch (e) {
      setError(reasonText({ message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <p className="pushes">
      {on
        ? 'Pushes are on for this fortress.'
        : 'Get a nudge when the Captains you back die, come back or take the throne, or when your Meddles land.'}{' '}
      <button className="link" disabled={busy} onClick={() => void toggle()}>
        {on ? 'Turn off' : 'Turn on pushes'}
      </button>
      {!on && <span className="quiet"> At most 3 a day, never at night.</span>}
      {error && <span className="error"> {error}</span>}
    </p>
  );
}
