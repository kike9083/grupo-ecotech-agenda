/**
 * Note view state copy (PR4 task 4.4, spec `note-capture` → "Note UI states").
 *
 * Pure constants and a pure classifier so the empty/loading/error branches a
 * user can see stay unit-testable in the node environment. Spanish copy
 * consistent with the rest of the app.
 */

export const NOTE_EMPTY_MESSAGE = 'Esta nota no tiene contenido.';

export const NOTE_LOADING_LABEL = 'Cargando nota…';

export const NOTE_LOAD_ERROR_MESSAGE =
  'No se pudo cargar la nota. Intenta de nuevo más tarde.';

export const NOTE_RETRY_LABEL = 'Reintentar';

/**
 * Classifies a stored note body: an absent or blank value renders the empty
 * state, anything else renders sanitized content.
 */
export function resolveNoteBodyState(
  bodyHtml: string | undefined,
): 'empty' | 'content' {
  return (bodyHtml ?? '').trim() === '' ? 'empty' : 'content';
}
