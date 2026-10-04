import { describe, expect, it } from 'vitest';
import type { Task, TaskPage } from '@/lib/appwrite/tasks';
import {
  LOAD_ERROR_MESSAGE,
  NEXT_PAGE_LABEL,
  RETRY_LABEL,
  adminEmptyMessage,
  allowedTransitions,
  buildListHref,
  emptyMessage,
  formatCreatedBy,
  formatNotedAt,
  noteHeading,
  noteSnippet,
  resolveListState,
  statusActionLabel,
  statusLabel,
  typeLabel,
} from './task-view';

function task(overrides: Partial<Task> = {}): Task {
  return {
    $id: 'doc-1',
    $createdAt: '2026-10-01T09:00:00.000+00:00',
    type: 'task',
    title: 'Preparar informe',
    description: 'Enviar el informe de octubre',
    date: '2026-10-02',
    time: '08:00',
    status: 'open',
    createdBy: 'user-123',
    createdByEmail: 'ana@grupoecotech.com',
    ...overrides,
  };
}

function pageOf(tasks: Task[], nextCursor: string | null = null): TaskPage {
  return { tasks, nextCursor };
}

describe('statusLabel', () => {
  it('renders every lifecycle status with its Spanish badge label', () => {
    expect(statusLabel('open')).toBe('Abierta');
    expect(statusLabel('in_progress')).toBe('En curso');
    expect(statusLabel('done')).toBe('Completada');
    expect(statusLabel('cancelled')).toBe('Cancelada');
  });
});

describe('typeLabel', () => {
  it('labels every record type in Spanish, including notes', () => {
    expect(typeLabel('task')).toBe('Tarea');
    expect(typeLabel('request')).toBe('Solicitud');
    expect(typeLabel('note')).toBe('Nota');
  });
});

describe('formatNotedAt (spec note-capture → Creation timestamp display)', () => {
  it('renders an Appwrite $createdAt timestamp in Spanish', () => {
    expect(formatNotedAt('2026-10-04T19:38:25.692+00:00')).toBe(
      'Anotado el 4 de octubre de 2026',
    );
  });

  it('formats the first day of a month without a leading zero', () => {
    expect(formatNotedAt('2026-01-01T00:00:00.000+00:00')).toBe(
      'Anotado el 1 de enero de 2026',
    );
  });

  it('falls back to the raw value when the timestamp is not an ISO date', () => {
    expect(formatNotedAt('sin fecha')).toBe('Anotado el sin fecha');
  });
});

describe('formatCreatedBy', () => {
  it('shows the creator email for attribution (spec task-listing)', () => {
    expect(formatCreatedBy('ana@grupoecotech.com')).toBe(
      'Creada por: ana@grupoecotech.com',
    );
  });

  it('keeps the full email when it contains dots and plus tags', () => {
    expect(formatCreatedBy('luis.m+geo@grupoecotech.com')).toBe(
      'Creada por: luis.m+geo@grupoecotech.com',
    );
  });
});

describe('resolveListState', () => {
  it('flags a failed load so the page can render the error state', () => {
    expect(resolveListState(null)).toEqual({ kind: 'error' });
  });

  it('flags a page without records as the empty state', () => {
    expect(resolveListState(pageOf([]))).toEqual({ kind: 'empty' });
  });

  it('passes a populated page through as results', () => {
    const page = pageOf([task()]);
    expect(resolveListState(page)).toEqual({ kind: 'results', page });
  });
});

describe('emptyMessage', () => {
  it('invites creating the first record when the plain list is empty', () => {
    expect(emptyMessage({ searching: false })).toBe('No hay tareas todavía.');
  });

  it('shows the no-results state when a keyword search matches nothing', () => {
    expect(emptyMessage({ searching: true })).toBe('Sin resultados.');
  });
});

describe('adminEmptyMessage (PR4 task 5.2, admin view empty states)', () => {
  it('keeps the first-record invite when the admin list has no records at all', () => {
    expect(adminEmptyMessage({ filtered: false })).toBe(
      'No hay tareas todavía.',
    );
  });

  it('points at the active filters when a filtered list matches nothing', () => {
    expect(adminEmptyMessage({ filtered: true })).toBe(
      'Sin resultados para los filtros aplicados.',
    );
  });
});

describe('allowedTransitions (spec task-registration → Status lifecycle)', () => {
  it('offers the next lifecycle step plus cancel from an open record', () => {
    expect(allowedTransitions('open')).toEqual(['in_progress', 'cancelled']);
  });

  it('offers completion and cancel from an in-progress record', () => {
    expect(allowedTransitions('in_progress')).toEqual(['done', 'cancelled']);
  });

  it('offers nothing on terminal records', () => {
    expect(allowedTransitions('done')).toEqual([]);
    expect(allowedTransitions('cancelled')).toEqual([]);
  });
});

describe('statusActionLabel', () => {
  it('labels every transition button in Spanish', () => {
    expect(statusActionLabel('in_progress')).toBe('Iniciar');
    expect(statusActionLabel('done')).toBe('Completar');
    expect(statusActionLabel('cancelled')).toBe('Cancelar');
  });
});

describe('list error copy', () => {
  it('keeps the load-error message and retry label user-facing in Spanish', () => {
    expect(LOAD_ERROR_MESSAGE).toBe(
      'No se pudieron cargar las tareas. Intenta de nuevo más tarde.',
    );
    expect(RETRY_LABEL).toBe('Reintentar');
    expect(NEXT_PAGE_LABEL).toBe('Cargar más');
  });
});

describe('note list helpers (spec task-listing → includes notes)', () => {
  it('shortens a long note snippet with an ellipsis', () => {
    expect(noteSnippet('a'.repeat(200), 20)).toBe('a'.repeat(20) + '…');
  });

  it('keeps a short snippet untouched and trims its edges', () => {
    expect(noteSnippet('  Acta breve  ')).toBe('Acta breve');
  });

  it('uses the title when present and falls back to the snippet', () => {
    expect(noteHeading('Reunión', 'Acta')).toBe('Reunión');
    expect(noteHeading('   ', 'Acta')).toBe('Acta');
  });

  it('falls back to a placeholder for an empty note', () => {
    expect(noteHeading('', '')).toBe('Nota sin contenido');
  });
});

describe('buildListHref', () => {
  it('builds the next-page link from the cursor', () => {
    expect(buildListHref({ cursor: 'doc-20' })).toBe('/?cursor=doc-20');
  });

  it('keeps the keyword in the next-page link so search paginates', () => {
    expect(buildListHref({ cursor: 'doc-20', q: 'pago' })).toBe(
      '/?q=pago&cursor=doc-20',
    );
  });

  it('falls back to the bare route when there is nothing to carry', () => {
    expect(buildListHref({})).toBe('/');
  });

  it('carries the inclusive date range across pages (PR9 task 9.1)', () => {
    expect(
      buildListHref({
        q: 'pago',
        cursor: 'doc-20',
        from: '2026-10-01',
        to: '2026-10-15',
      }),
    ).toBe('/?q=pago&from=2026-10-01&to=2026-10-15&cursor=doc-20');
  });

  it('carries only the bound that is set', () => {
    expect(buildListHref({ from: '2026-10-01' })).toBe('/?from=2026-10-01');
    expect(buildListHref({ to: '2026-10-15' })).toBe('/?to=2026-10-15');
  });
});
