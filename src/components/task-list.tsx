import type { TaskPage } from '@/lib/appwrite/tasks';
import { StatusControls } from '@/components/status-controls';
import {
  LOAD_ERROR_MESSAGE,
  NEXT_PAGE_LABEL,
  RETRY_LABEL,
  buildListHref,
  emptyMessage,
  formatCreatedBy,
  resolveListState,
  statusLabel,
  typeLabel,
} from '@/lib/task-view';

/**
 * Presentational task list (PR3 task 4.1, spec `task-listing`): three
 * distinct states (error + retry, empty, results) with status/type badges
 * and creator attribution. Every decision comes from the tested helpers in
 * `task-view.ts`; this component is validated by `tsc`/`next build`.
 */
interface TaskListProps {
  page: TaskPage | null;
  /** Normalized keyword — empty means the plain list (spec task-search). */
  q: string;
  /** Cursor of the page currently displayed — used to rebuild the retry URL. */
  cursor: string;
}

export function TaskList({ page, q, cursor }: TaskListProps) {
  const state = resolveListState(page);
  const searching = q !== '';

  if (state.kind === 'error') {
    return (
      <section className="flex flex-col items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3">
        <p role="alert" className="text-sm text-red-700">
          {LOAD_ERROR_MESSAGE}
        </p>
        <a
          href={buildListHref({ cursor, q })}
          className="text-sm font-medium text-red-800 underline"
        >
          {RETRY_LABEL}
        </a>
      </section>
    );
  }

  if (state.kind === 'empty') {
    return <p className="text-sm text-neutral-500">{emptyMessage({ searching })}</p>;
  }

  const { tasks, nextCursor } = state.page;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <li
            key={task.$id}
            className="flex flex-col gap-2 rounded-md border border-neutral-300 px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-800">
                  {typeLabel(task.type)}
                </span>
                <span className="font-medium">{task.title}</span>
              </div>
              <span className="text-xs text-neutral-500">
                {formatCreatedBy(task.createdByEmail)}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2 text-xs text-neutral-600">
              <span className="font-mono">
                {task.date} {task.time}
              </span>
              <span className="rounded-full border border-neutral-300 px-2 py-0.5 font-medium">
                {statusLabel(task.status)}
              </span>
            </div>

            <StatusControls
              task={{
                $id: task.$id,
                status: task.status,
                createdBy: task.createdBy,
              }}
            />
          </li>
        ))}
      </ul>

      {nextCursor !== null ? (
        <div className="flex justify-center">
          <a
            href={buildListHref({ cursor: nextCursor, q })}
            rel="next"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium"
          >
            {NEXT_PAGE_LABEL}
          </a>
        </div>
      ) : null}
    </div>
  );
}
