import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Databases } from 'node-appwrite';
import { logout } from '@/actions/auth';
import { MonthGrid } from '@/components/month-grid';
import { createSessionClient } from '@/lib/appwrite/clients';
import { isDomainError } from '@/lib/appwrite/errors';
import { getCurrentUser, getSessionSecret, isAdmin } from '@/lib/appwrite/session';
import { loadCalendarTasks, type TaskPage } from '@/lib/appwrite/tasks';
import {
  CALENDAR_BACK_LABEL,
  CALENDAR_LOAD_ERROR_MESSAGE,
  CALENDAR_LOADING_LABEL,
  buildMonthGrid,
  gridRange,
  parseDayParam,
  parseMonthParam,
  placeRecordsByDate,
} from '@/lib/calendar';
import { loadEnv } from '@/lib/env';
import type { RawSearchParams } from '@/lib/search-query';

/**
 * Calendar route (PR8 task 8.3, spec `calendar-view`, design D4): an RSC that
 * resolves the displayed month from `?month=YYYY-MM`, selects a day from
 * `?day=YYYY-MM-DD`, and loads every record dated inside the visible grid via
 * an inclusive `between` range. Month/day navigation is plain GET links — no
 * client state.
 */

/** The data region, wrapped in its own <Suspense> like the home route. */
async function CalendarSection({
  user,
  secret,
  admin,
  year,
  month,
  selectedDay,
}: {
  user: { id: string };
  secret: string;
  admin: boolean;
  year: number;
  month: number;
  selectedDay?: string;
}) {
  const env = loadEnv();
  const grid = buildMonthGrid(year, month);
  const range = gridRange(year, month);

  let page: TaskPage | null = null;
  try {
    page = await loadCalendarTasks(
      user,
      secret,
      admin,
      {
        config: {
          databaseId: env.APPWRITE_DATABASE_ID,
          collectionId: env.APPWRITE_TASKS_COLLECTION_ID,
          adminsTeamId: env.APPWRITE_ADMINS_TEAM_ID,
        },
        databasesFor: (sessionSecret) =>
          new Databases(createSessionClient(sessionSecret)),
      },
      { from: range.start, to: range.end },
    );
  } catch (error) {
    if (isDomainError(error) && error.kind === 'session-expired') {
      redirect('/login?error=expired');
    }
    // Other failures fall through to the inline error state.
  }

  const recordsByDate = page === null ? {} : placeRecordsByDate(page.tasks);

  return (
    <MonthGrid
      year={year}
      month={month}
      grid={grid}
      recordsByDate={recordsByDate}
      selectedDay={selectedDay}
      loadFailed={page === null}
      errorMessage={CALENDAR_LOAD_ERROR_MESSAGE}
    />
  );
}

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await getCurrentUser();
  if (user === null) {
    redirect('/login?error=expired');
  }

  const secret = await getSessionSecret();
  if (secret === null) {
    redirect('/login?error=expired');
  }

  const params = await searchParams;
  const monthParam = Array.isArray(params.month) ? params.month[0] : params.month;
  const dayParam = Array.isArray(params.day) ? params.day[0] : params.day;
  const { year, month } = parseMonthParam(monthParam);
  const selectedDay = parseDayParam(dayParam);
  const admin = await isAdmin();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Calendario</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            {CALENDAR_BACK_LABEL}
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </header>

      <p className="text-sm text-neutral-600">
        Sesión iniciada como <span className="font-medium">{user.email}</span>
        {admin ? ' (administrador)' : ''}
      </p>

      <Suspense
        fallback={
          <p role="status" className="text-sm text-neutral-500">
            {CALENDAR_LOADING_LABEL}
          </p>
        }
      >
        <CalendarSection
          user={user}
          secret={secret}
          admin={admin}
          year={year}
          month={month}
          selectedDay={selectedDay}
        />
      </Suspense>
    </main>
  );
}
