import Link from 'next/link';
import type { TaskPage } from '@/lib/appwrite/tasks';
import type { Attachment } from '@/lib/appwrite/attachments';
import { AttachmentForm } from '@/components/attachment-form';
import { AttachmentGallery } from '@/components/attachment-gallery';
import { NoteBody } from '@/components/note-body';
import { StatusControls } from '@/components/status-controls';
import { plainTextFromHtml } from '@/lib/rich-text';
import {
  LOAD_ERROR_MESSAGE,
  NEXT_PAGE_LABEL,
  RETRY_LABEL,
  buildListHref,
  emptyMessage,
  formatCreatedAt,
  formatCreatedBy,
  formatNotedAt,
  noteHeading,
  noteSnippet,
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
  /** Inclusive lower date bound (`YYYY-MM-DD`) carried across pages. */
  from?: string;
  /** Inclusive upper date bound (`YYYY-MM-DD`) carried across pages. */
  to?: string;
  /** Cursor of the page currently displayed — used to rebuild the retry URL. */
  cursor: string;
  /** Attachments of the page's records, keyed by record id (spec attachments). */
  attachmentsByRecord?: Record<string, Attachment[]>;
}

export function TaskList({
  page,
  q,
  from = '',
  to = '',
  cursor,
  attachmentsByRecord = {},
}: TaskListProps) {
  const state = resolveListState(page);
  const searching = q !== '' || from !== '' || to !== '';

  if (state.kind === 'error') {
    return (
      <section
        role="alert"
        className="flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3"
      >
        <p className="text-sm text-red-700">{LOAD_ERROR_MESSAGE}</p>
        <a
          href={buildListHref({ cursor, q, from, to })}
          className="text-sm font-semibold text-red-800 underline"
        >
          {RETRY_LABEL}
        </a>
      </section>
    );
  }

  if (state.kind === 'empty') {
    return (
      <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-8 text-ink-subtle"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        <p className="text-sm text-ink-muted">{emptyMessage({ searching })}</p>
      </div>
    );
  }

  const { tasks, nextCursor } = state.page;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {tasks.map((task) => {
          const isNote = task.type === 'note';
          const snippet = isNote
            ? noteSnippet(plainTextFromHtml(task.bodyHtml ?? ''))
            : '';

          return (
            <li
              key={task.$id}
              className="card card-hover flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge badge-accent">
                    {typeLabel(task.type)}
                  </span>
                  <span className="text-[0.975rem] font-semibold leading-snug text-ink">
                    {isNote ? noteHeading(task.title, snippet) : task.title}
                  </span>
                </div>
                {isNote ? <NoteBody html={task.bodyHtml ?? ''} /> : null}
                <span className="meta">{formatCreatedBy(task.createdByEmail)}</span>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-ink-muted">
                {isNote ? (
                  <span>{formatNotedAt(task.$createdAt)}</span>
                ) : (
                  <>
                    <span className="font-mono text-ink-muted">
                      {task.date} {task.time}
                    </span>
                    <span className="text-ink-subtle">
                      {formatCreatedAt(task.$createdAt)}
                    </span>
                    <span
                      className={
                        'badge ' +
                        (task.status === 'done'
                          ? 'badge-done'
                          : task.status === 'cancelled'
                            ? 'badge-cancelled'
                            : 'badge-pending')
                      }
                    >
                      {statusLabel(task.status)}
                    </span>
                  </>
                )}
              </div>

              {isNote ? null : (
                <Link
                  href={`/editar?id=${task.$id}`}
                  className="btn btn-secondary btn-sm shrink-0"
                >
                  Editar
                </Link>
              )}

              {isNote ? null : (
                <StatusControls
                  task={{
                    $id: task.$id,
                    status: task.status,
                    createdBy: task.createdBy,
                  }}
                />
              )}

              <div className="flex w-full flex-col gap-2 border-t border-hairline pt-3">
                <AttachmentGallery
                  attachments={attachmentsByRecord[task.$id] ?? []}
                />
                <AttachmentForm recordId={task.$id} />
              </div>
            </li>
          );
        })}
      </ul>

      {nextCursor !== null ? (
        <div className="flex justify-center pt-1">
          <a
            href={buildListHref({ cursor: nextCursor, q, from, to })}
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
