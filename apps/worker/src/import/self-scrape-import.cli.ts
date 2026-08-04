import { pathToFileURL } from 'node:url';

import { prisma } from '@xhs/database';

import { importSelfScrapeFile } from './self-scrape-import.service';

export function parseSelfScrapeImportArgs(args: string[]) {
  let file: string | undefined;
  let accountPlatformId: string | undefined;
  let commit = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--commit') { commit = true; continue; }
    if (argument === '--file' || argument === '--account') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
      if (argument === '--file') file = value;
      else accountPlatformId = value;
      index += 1;
      continue;
    }
    throw new Error(`unsupported argument: ${argument}`);
  }
  if (!file || !accountPlatformId) throw new Error('usage: --file <my_notes.jsonl> --account <platformId> [--commit]');
  return { file, accountPlatformId, commit };
}

async function main() {
  try {
    const summary = await importSelfScrapeFile({ ...parseSelfScrapeImportArgs(process.argv.slice(2)), db: prisma });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
