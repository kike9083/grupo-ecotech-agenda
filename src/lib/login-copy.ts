/**
 * Login copy (PR4 task 5.3): Spanish error messages for the auth codes the
 * flow can produce (`?error=` on the login URL — credentials/missing from
 * the login action, expired from the middleware session rule). Unknown
 * codes fall back to a generic message so the user never sees a silent
 * banner. Pure module — unit-tested in the node environment (design D5).
 */

export const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  credentials: 'Correo o contraseña incorrectos.',
  missing: 'Debes ingresar el correo y la contraseña.',
  expired: 'Tu sesión ha expirado. Inicia sesión de nuevo.',
};

const FALLBACK_MESSAGE = 'No se pudo iniciar sesión. Intenta de nuevo.';

/** Resolves the banner copy for a `?error=` value — undefined shows nothing. */
export function loginErrorMessage(code: string | undefined): string | undefined {
  if (code === undefined) {
    return undefined;
  }
  return LOGIN_ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE;
}
