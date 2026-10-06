import type { TaskPage } from '@/lib/appwrite/tasks';
import { StatusControls } from '@/components/status-controls';
import { buildAdminHref, type AdminQuery } from '@/lib/search-query';
import {
  LOAD_ERROR_MESSAGE,
  NEXT_PAGE_LABEL,
  RETRY_LABEL,
  adminEmptyMessage,
  formatCreatedBy,
  resolveListState,
  statusLabel,
  typeLabel,
} from '@/lib/task-view';

/**
 * Presentational all-records list (PR4 task 5.1, spec `task-listing` →
 * "Admin view attribution"): every row shows its creator, with the three
 * distinct states (error + retry, empty, results) resolved by the tested
 * helpers in `task-view.ts` — this component is validated by `tsc`/`next
 * build`. Pagination and retry links carry the active filters across pages
 * via `buildAdminHref` (PR4 task 5.2), and the empty state distinguishes an
 * unfiltered list from a filtered one.
 */
interface AdminTaskListProps {
  page: TaskPage | null;
  /** Normalized `/admin` query — cursor + active filters. */
  query: AdminQuery;
}

export function AdminTaskList({ page, query }: AdminTaskListProps) {
  const state = resolveListState(page);
  const linkTo = (cursor: string): string =>
    buildAdminHref({
      cursor,
      status: query.status,
      type: query.type,
      creator: query.creator,
    });

  if (state.kind === 'error') {
    return (
      <section
        role="alert"
        className="banner banner-danger flex flex-col items-start gap-2"
      >
        <p className="text-sm text-red-700">
          {LOAD_ERROR_MESSAGE}
        </p>
        <a
          href={linkTo(query.cursor)}
          className="text-sm font-medium text-red-800 underline"
        >
          {RETRY_LABEL}
        </a>
      </section>
    );
  }

  if (state.kind === 'empty') {
    return (
      <p className="meta">
        {adminEmptyMessage({ filtered: query.filtered })}
      </p>
    );
  }

  const { tasks, nextCursor } = state.page;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {tasks.map((task) => (
          <li
            key={task.$id}
            className="card flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="badge badge-accent">
                  {typeLabel(task.type)}
                </span>
                <span className="font-medium">{task.title}</span>
              </div>
              <span className="meta">
                {formatCreatedBy(task.createdByEmail)}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-2 meta">
              <span className="font-mono">
                {task.date} {task.time}
              </span>
              <span className="badge badge-neutral">
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
            href={linkTo(nextCursor)}
            rel="next"
            className="btn btn-secondary"
          >
            {NEXT_PAGE_LABEL}
          </a>
        </div>
      ) : null}
    </div>
  );
}
