import { describe, expect, it } from 'vitest';
import { LOGIN_ERROR_MESSAGES, loginErrorMessage } from './login-copy';

describe('loginErrorMessage (Spanish UI constraint, PR4 task 5.3)', () => {
  it('maps every known login error code to Spanish copy', () => {
    expect(loginErrorMessage('credentials')).toBe(
      'Correo o contraseña incorrectos.',
    );
    expect(loginErrorMessage('missing')).toBe(
      'Debes ingresar el correo y la contraseña.',
    );
    expect(loginErrorMessage('expired')).toBe(
      'Tu sesión ha expirado. Inicia sesión de nuevo.',
    );
  });

  it('shows nothing when there is no error at all', () => {
    expect(loginErrorMessage(undefined)).toBeUndefined();
  });

  it('falls back to a generic Spanish message for an unknown code', () => {
    expect(loginErrorMessage('boom')).toBe(
      'No se pudo iniciar sesión. Intenta de nuevo.',
    );
  });

  it('covers the three codes the auth flow can produce', () => {
    expect(Object.keys(LOGIN_ERROR_MESSAGES).sort()).toEqual([
      'credentials',
      'expired',
      'missing',
    ]);
  });
});
