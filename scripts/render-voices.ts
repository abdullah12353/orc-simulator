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
// Designing the voices (prompts in voices/test-cast.ts DESIGNS), instead of the web UI:
//   npm run voices -- --design krug vorgash three Voice Design previews each, in voices/designs/
//   npm run voices -- --save krug 2         save preview 2 to your account and write its voice ID
// The API key comes from ELEVENLABS_API_KEY, or a git-ignored .env.voices holding ELEVENLABS_API_KEY=….
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
import { DESIGNS, SWAP_LINES, TEST_CAST } from '../voices/test-cast.ts';

const ROOT = join(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'apps', 'web', 'public');
const TAKES = join(ROOT, 'voices', 'takes');
const DESIGNED = join(ROOT, 'voices', 'designs');
const IDS = join(ROOT, 'voices', 'voice-ids.json');
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

async function api(path: string, body: object): Promise<Response> {
  const res = await fetch(`https://api.elevenlabs.io${path}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey(), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) fail(`ElevenLabs ${res.status} on ${path}: ${await res.text()}`);
  return res;
}

async function render(key: string, voiceId: string, text: string) {
  const res = await api(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, { text, model_id: MODEL });
  writeFileSync(join(TAKES, `${key}.mp3`), Buffer.from(await res.arrayBuffer()));
}

/** Three Voice Design previews of each voice, as voices/designs/<voice>-<n>.mp3 (about 250 credits a voice). */
async function design(voices: string[]) {
  if (!voices.length) fail(`name the voices to design: ${Object.keys(DESIGNS).join(', ')}`);
  for (const v of voices) if (!DESIGNS[v]) fail(`${v} has no design prompt in voices/test-cast.ts`);
  mkdirSync(DESIGNED, { recursive: true });
  for (const v of voices) {
    const { description, preview } = DESIGNS[v]!;
    if (preview.length < 100 || preview.length > 1000) fail(`${v}'s preview text is ${preview.length} characters; it needs 100 to 1000`);
    console.log(`${v}: designing…`);
    const res = await api('/v1/text-to-voice/design', { voice_description: description, text: preview, model_id: 'eleven_ttv_v3' });
    const { previews } = (await res.json()) as { previews: { audio_base_64: string; generated_voice_id: string }[] };
    previews.forEach((p, i) => {
      writeFileSync(join(DESIGNED, `${v}-${i + 1}.mp3`), Buffer.from(p.audio_base_64, 'base64'));
      console.log(`  → voices/designs/${v}-${i + 1}.mp3`);
    });
    writeFileSync(join(DESIGNED, `${v}.json`), JSON.stringify({ description, generated: previews.map((p) => p.generated_voice_id) }, null, 2));
  }
  console.log(`Listen, then save the best: npm run voices -- --save ${voices[0]} <1-3>`);
}

/** Saves a preview as a voice in the account, writes its ID, and clears the old voice's takes. */
async function save(voice: string, n: number) {
  const file = join(DESIGNED, `${voice}.json`);
  if (!existsSync(file)) fail(`no designs for ${voice} yet: npm run voices -- --design ${voice}`);
  const { description, generated }: { description: string; generated: string[] } = JSON.parse(readFileSync(file, 'utf8'));
  const chosen = generated[n - 1] ?? fail(`pick 1 to ${generated.length}`);
  const name = content.cast.find((c) => c.id === voice)?.name ?? 'Announcer';
  const res = await api('/v1/text-to-voice', {
    voice_name: name,
    voice_description: description,
    generated_voice_id: chosen,
    played_not_selected_voice_ids: generated.filter((g) => g !== chosen),
  });
  const { voice_id } = (await res.json()) as { voice_id: string };
  const ids: Record<string, string> = JSON.parse(readFileSync(IDS, 'utf8'));
  const old = ids[voice];
  ids[voice] = voice_id;
  writeFileSync(IDS, `${JSON.stringify(ids, null, 2)}
`);
  console.log(`Saved ${name} (${voice_id}) in voices/voice-ids.json.`);
  if (old) console.log(`It replaces ${old}: delete that one in My Voices to free its slot.`);
  const stale = existsSync(TAKES) ? readdirSync(TAKES).filter((f) => f.startsWith(`${voice}-`)) : [];
  for (const f of stale) rmSync(join(TAKES, f));
  if (stale.length) console.log(`Cleared ${stale.length} take(s) from the old voice; npm run voices re-renders them.`);
}

const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !['--model', '--pick', '--save'].includes(all[i - 1]!));
if (process.argv.includes('--design')) {
  await design(positional);
  process.exit(0);
}
const saving = flag('--save');
if (saving) {
  await save(saving, Number(positional[0]));
  process.exit(0);
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

const ids: Record<string, string> = JSON.parse(readFileSync(IDS, 'utf8'));
const args = positional;
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
