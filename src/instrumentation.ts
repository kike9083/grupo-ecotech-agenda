import { bootRunners } from './lib/reminder-runner';

/**
 * Next.js instrumentation hook (design D1) — stable since Next 15, detected
 * automatically at `src/instrumentation.ts`, no config flag.
 *
 * `register()` runs once per server boot and MUST never break it: the runtime
 * gate keeps the edge bundle clean, and the runner itself is non-throwing
 * (an unconfigured Telegram environment logs one line and boots normally —
 * spec `reminder-delivery` → "Disabled or unconfigured reminders").
 *
 * The loops are started with `void` inside `bootRunners()` and never awaited
 * here, so the server starts serving while the polls run in the background.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  try {
    bootRunners();
  } catch (error) {
    console.error('reminders runner failed to start:', error);
  }
}
