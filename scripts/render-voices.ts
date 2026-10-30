// Renders the voice test's lines (voices/test-cast.ts) with ElevenLabs text to speech, through voices you
// designed and saved in the ElevenLabs web UI (their IDs go in voices/voice-ids.json). Each line's MP3
// master lands in voices/takes/; the main take is also trimmed, loudness-matched and converted (ffmpeg)
// into the PWA's audio bank, replacing that placeholder. `npm run audio:placeholders` without `--missing`
// would write the placeholders back over them.
//   npm run voices -- --dry                 count the characters (credits), render nothing
//   npm run voices                          every voice with an ID; skips takes that already exist
//   npm run voices -- krug announcer        just those voices
//   npm run voices -- krug-taunt            re-render one take, even if it exists
//   npm run voices -- --pick krug-shout~2   use an alternative take as the game file (no API call)
// The API key comes from ELEVENLABS_API_KEY, or a git-ignored .env.voices holding ELEVENLABS_API_KEY=….
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  BARK_EMOTIONS,
  STINGERS,
  barkPath,
  content,
  epithetPath,
  introShoutPath,
  introSignaturePath,
  stingerPath,
} from '@orc/content';
import { SWAP_LINES, TEST_CAST } from '../voices/test-cast.ts';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'apps', 'web', 'public');
const TAKES = join(ROOT, 'voices', 'takes');
const MODEL = flag('--model') ?? 'eleven_v3';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** Every voice's lines, keyed by take name (`krug-taunt`). Captains get their catchphrase and the swap lines. */
function allTakes(): Map<string, { voice: string; line: string; text: string }> {
  const takes = new Map<string, { voice: string; line: string; text: string }>();
  for (const [voice, lines] of Object.entries(TEST_CAST)) {
    const card = content.cast.find((c) => c.id === voice);
    if (voice !== 'announcer' && !card) fail(`voices/test-cast.ts: ${voice} isn't in the cast`);
    const withExtras = card ? { ...lines, signature: lines.signature ?? card.catchphrase, ...SWAP_LINES } : lines;
    for (const [line, text] of Object.entries(withExtras)) takes.set(`${voice}-${line}`, { voice, line, text });
  }
  return takes;
}

/** Where a main take goes in the audio bank. Alternatives (`~2`) and swap-audit lines stay in takes/. */
function gamePath(voice: string, line: string): string | null {
  if (line.includes('~') || line.startsWith('swap-')) return null;
  if (voice === 'announcer') {
    const [kind, ...rest] = line.split('-');
    const key = rest.join('-');
    if (kind === 'stinger' && (STINGERS as readonly string[]).includes(key)) return stingerPath(key as never);
    if (kind === 'epithet' && key in content.banks.epithets) return epithetPath(key);
    return fail(`announcer line ${line}: not a stinger-<${STINGERS.join('|')}> or a known epithet-<key>`);
  }
  if ((BARK_EMOTIONS as readonly string[]).includes(line)) return barkPath(voice, line as never);
  if (line === 'shout') return introShoutPath(voice);
  if (line === 'shout-alias-0' || line === 'shout-alias-1') return introShoutPath(voice, line.endsWith('0') ? 0 : 1);
  if (line === 'signature') return introSignaturePath(voice);
  return fail(`${voice} line ${line}: not a bark (${BARK_EMOTIONS.join(', ')}), shout, shout-alias-0/1 or signature`);
}

/** MP3 master → a short, trimmed, loudness-matched mono WAV at the bank's path. */
function toGameFile(take: string, voice: string, line: string) {
  const dest = gamePath(voice, line.replace(/~\d+$/, ''));
  if (!dest) return;
  const out = join(PUBLIC, dest);
  mkdirSync(dirname(out), { recursive: true });
  const trim = 'silenceremove=start_periods=1:start_threshold=-45dB';
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', join(TAKES, `${take}.mp3`), '-af', `${trim},areverse,${trim},areverse,loudnorm=I=-16:TP=-1.5`,
      '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', out],
    { stdio: 'inherit' },
  );
  if (r.error) fail('ffmpeg not found. Install it (winget install Gyan.FFmpeg), open a new terminal, and re-run.');
  if (r.status !== 0) fail(`ffmpeg failed on ${take}`);
  console.log(`  → apps/web/public/${dest}`);
}

function apiKey(): string {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const file = join(ROOT, '.env.voices');
  const line = existsSync(file) && readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith('ELEVENLABS_API_KEY='));
  return line ? line.slice('ELEVENLABS_API_KEY='.length).trim().replace(/^['"]|['"]$/g, '') : fail('no ELEVENLABS_API_KEY (env or .env.voices)');
}

async function render(key: string, voiceId: string, text: string) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey(), 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: MODEL }),
  });
  if (!res.ok) fail(`${key}: ElevenLabs ${res.status} ${await res.text()}`);
  writeFileSync(join(TAKES, `${key}.mp3`), Buffer.from(await res.arrayBuffer()));
}

const takes = allTakes();
const pick = flag('--pick');
if (pick) {
  const t = takes.get(pick) ?? fail(`no take called ${pick}`);
  if (!existsSync(join(TAKES, `${pick}.mp3`))) fail(`${pick} hasn't been rendered yet`);
  console.log(pick);
  toGameFile(pick, t.voice, t.line);
  process.exit(0);
}

const ids: Record<string, string> = JSON.parse(readFileSync(join(ROOT, 'voices', 'voice-ids.json'), 'utf8'));
const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--model');
for (const a of args) if (!(a in TEST_CAST) && !takes.has(a)) fail(`${a} is neither a voice (${Object.keys(TEST_CAST).join(', ')}) nor a take`);

const chosen = [...takes].filter(([key, t]) => {
  if (args.length && !args.includes(t.voice) && !args.includes(key)) return false;
  if (!ids[t.voice]) return false;
  return args.includes(key) || !existsSync(join(TAKES, `${key}.mp3`));
});
const missingIds = Object.keys(TEST_CAST).filter((v) => !ids[v] && (!args.length || args.some((a) => a === v || takes.get(a)?.voice === v)));
if (missingIds.length) console.log(`No voice ID yet for: ${missingIds.join(', ')} (voices/voice-ids.json). Skipping those.`);

const chars = chosen.reduce((n, [, t]) => n + t.text.length, 0);
console.log(`${chosen.length} take(s), ${chars} characters (about ${chars} credits on ${MODEL}).`);
if (process.argv.includes('--dry') || !chosen.length) process.exit(0);

mkdirSync(TAKES, { recursive: true });
for (const [key, t] of chosen) {
  console.log(`${key}: ${t.text}`);
  await render(key, ids[t.voice]!, t.text);
  toGameFile(key, t.voice, t.line);
}
console.log(`Done. Listen in voices/takes/; the main takes are in the game.`);
