import { LoadingState } from '@/components/loading-state';

/** Root loading boundary (PR4 task 5.3 — UI states). */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center px-4">
      <LoadingState />
    </main>
  );
}
