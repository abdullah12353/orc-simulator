import { useEffect, useState } from 'react';
import { audio } from './audio.ts';

/** The set pieces' sound toggle (remembered on this device). */
export function MuteButton() {
  const [muted, setMuted] = useState(audio.muted);
  useEffect(() => audio.onMutedChange(setMuted), []);
  return <button onClick={() => audio.setMuted(!muted)}>{muted ? 'Sound off' : 'Sound on'}</button>;
}
