import { login } from '@/actions/auth';
import { loginErrorMessage } from '@/lib/login-copy';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = loginErrorMessage(error);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-xl bg-accent-soft"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-5 text-accent"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
            <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
          </svg>
        </span>
        <div>
          <h1 className="text-xl font-bold">Iniciar sesión</h1>
          <p className="meta">Grupo Ecotech agenda</p>
        </div>
      </div>

      {message ? (
        <p role="alert" className="banner banner-danger">
          {message}
        </p>
      ) : null}

      <form action={login} className="card flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="field-label">
            Correo electrónico
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="field"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="field-label">
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="field"
          />
        </div>

        <button type="submit" className="btn btn-primary w-full py-2.5">
          Iniciar sesión
        </button>
      </form>
    </main>
  );
}
