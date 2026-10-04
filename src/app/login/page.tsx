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
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-4">
      <div>
        <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
        <p className="text-sm text-neutral-500">Grupo Ecotech agenda</p>
      </div>

      {message ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {message}
        </p>
      ) : null}

      <form action={login} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            Correo electrónico
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">
            Contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>

        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
        >
          Iniciar sesión
        </button>
      </form>
    </main>
  );
}
