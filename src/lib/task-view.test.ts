import { describe, expect, it } from 'vitest';
import type { Task, TaskPage } from '@/lib/appwrite/tasks';
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
} from './task-view';

function task(overrides: Partial<Task> = {}): Task {
  return {
    $id: 'doc-1',
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
  it('labels both record types in Spanish', () => {
    expect(typeLabel('task')).toBe('Tarea');
    expect(typeLabel('request')).toBe('Solicitud');
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

describe('list error copy', () => {
  it('keeps the load-error message and retry label user-facing in Spanish', () => {
    expect(LOAD_ERROR_MESSAGE).toBe(
      'No se pudieron cargar las tareas. Intenta de nuevo más tarde.',
    );
    expect(RETRY_LABEL).toBe('Reintentar');
    expect(NEXT_PAGE_LABEL).toBe('Cargar más');
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
});
