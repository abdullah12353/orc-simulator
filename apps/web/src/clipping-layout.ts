// The pure parts of a Clipping's shared image (#41): word wrap against a measuring function (the
// canvas's in the browser) and the file name it's shared or saved as. DOM-free, so it's unit-tested.

/** Greedy word wrap: as many words per line as fit `maxWidth`; a word too long for any line stands alone. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** `gutter-herald-<story>-<headline slug>.png`. */
export function clippingFileName({ storyNo, headline }: { storyNo: number; headline: string }): string {
  const slug = headline
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `gutter-herald-${storyNo}${slug ? `-${slug}` : ''}.png`;
}
