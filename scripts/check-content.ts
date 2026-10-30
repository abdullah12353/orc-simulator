// CI content check: fails if any slug the bundle uses is missing or a Template is malformed.
// Later tickets extend this with slugs stored in DB rows (data-model decision 6).
import { content, contentVersion, validateContent } from '@orc/content';

const errors = validateContent(content);
if (errors.length > 0) {
  console.error(`Content check failed with ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `Content OK: ${content.cast.length} Captains, ${content.templates.length} Templates, version ${contentVersion(content)}`,
);
