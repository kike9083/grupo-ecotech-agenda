import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * PR6 task 6.9 (source scan — the project's literal-sync precedent) — proves
 * the coupling rules no test doubles can:
 *
 * - `reminders.ts` (the scheduler) references NO provider symbol and imports
 *   only the channel contract (spec `notification-channels` → "Scheduler
 *   depends only on the interface" / "No provider coupling");
 * - the ONLY send call site in `src/` is the scheduler itself — pages,
 *   components, search, calendar and admin code never notify anyone (spec
 *   `record-visibility` → "Notification isolation": viewing, listing and
 *   searching must not send);
 * - the contract file stays import-free, so a new channel implementation can
 *   never drag a provider into scheduling (`Additional channels are
 *   additive`).
 *
 * Read through `readFileSync` + path walks: no module imports, so the scan
 * also guards against accidental dependency cycles.
 */

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));

function read(relative: string): string {
  return readFileSync(join(SRC_DIR, relative), 'utf8');
}

/** Every non-test `.ts`/`.tsx` file under `src/`, POSIX-relative. */
function sourceFiles(): string[] {
  return (readdirSync(SRC_DIR, { recursive: true }) as string[])
    .map((entry) => entry.replace(/\\/g, '/'))
    .filter((entry) => /\.tsx?$/.test(entry) && !entry.includes('.test.'));
}

function filesMatching(pattern: RegExp): string[] {
  return sourceFiles().filter((file) => pattern.test(read(file)));
}

describe('scheduler has no provider coupling (spec notification-channels → No provider coupling)', () => {
  it('reminders.ts never mentions a provider', () => {
    expect(read('lib/reminders.ts')).not.toMatch(/telegram/i);
  });

  it('reminders.ts imports only the channel contract', () => {
    const imports = read('lib/reminders.ts')
      .split('\n')
      .filter((line) => line.startsWith('import '));
    expect(imports.length).toBeGreaterThan(0);
    for (const statement of imports) {
      expect(statement).toContain("'./notification-channel'");
      expect(statement).toContain('type ');
    }
  });

  it('the channel contract file imports nothing at all', () => {
    const contract = read('lib/notification-channel.ts');
    expect(contract).not.toMatch(/^import /m);
    expect(contract).not.toMatch(/telegram/i);
  });
});

describe('only the scheduler sends (spec record-visibility → Notification isolation)', () => {
  it('the single `.send(` call site in src/ is the scheduler', () => {
    expect(filesMatching(/\.send\(/)).toEqual(['lib/reminders.ts']);
  });

  it('no page or component ever sends', () => {
    const offenders = filesMatching(/\.send\(/).filter(
      (file) => file.startsWith('app/') || file.startsWith('components/'),
    );
    expect(offenders).toEqual([]);
  });
});
