import { localDateStr } from './tasks.js';

export interface HabitStreakInput {
  countOnDay?: Record<string, number>;
  streakMinValue?: number;
  streakMode?: 'specific-days' | 'weekly-frequency';
  streakWeekDays?: Record<number, boolean>;
  streakWeeklyFrequency?: number;
}

/** Ported from SP's get-simple-counter-streak-duration.ts — the streak length isn't
 *  stored anywhere; SP derives it client-side from countOnDay history on every render. */
export function computeHabitStreak(habit: HabitStreakInput): number {
  const countOnDay = habit.countOnDay || {};

  if (!habit.streakMinValue) {
    return 0;
  }

  if (habit.streakMode === 'weekly-frequency') {
    return calculateWeeklyFrequencyStreak(habit);
  }

  if (!habit.streakWeekDays) {
    return 0;
  }

  let streak = 0;
  const date = new Date();
  setDayToLastConsideredWeekday(date, habit.streakWeekDays);

  if (
    localDateStr(date) === localDateStr(new Date()) &&
    (!countOnDay[localDateStr(date)] || countOnDay[localDateStr(date)] < habit.streakMinValue)
  ) {
    date.setDate(date.getDate() - 1);
    setDayToLastConsideredWeekday(date, habit.streakWeekDays);
  }

  while (countOnDay[localDateStr(date)] >= habit.streakMinValue) {
    streak++;
    date.setDate(date.getDate() - 1);
    setDayToLastConsideredWeekday(date, habit.streakWeekDays);
  }

  return streak;
}

function calculateWeeklyFrequencyStreak(habit: HabitStreakInput): number {
  const { countOnDay = {}, streakMinValue, streakWeeklyFrequency } = habit;

  if (!streakWeeklyFrequency || streakWeeklyFrequency < 1) {
    return 0;
  }

  const today = new Date();
  const currentWeekStart = getWeekStart(today);

  const currentWeekCount = getWeekCompletionCount(currentWeekStart, countOnDay, streakMinValue!);

  let totalCompletedDays = 0;
  const weekStart = new Date(currentWeekStart);

  const isCurrentWeekMet = currentWeekCount >= streakWeeklyFrequency;
  if (!isCurrentWeekMet) {
    weekStart.setDate(weekStart.getDate() - 7);
  }

  while (true) {
    const weekCount = getWeekCompletionCount(weekStart, countOnDay, streakMinValue!);

    if (weekCount >= streakWeeklyFrequency) {
      totalCompletedDays += weekCount;
      weekStart.setDate(weekStart.getDate() - 7);
    } else {
      break;
    }
  }

  if (totalCompletedDays > 0 && !isCurrentWeekMet) {
    return totalCompletedDays + currentWeekCount;
  }

  // No week has met the frequency requirement yet — show current-week progress
  // instead of 0, for the same "positive reinforcement" reason SP's own version does.
  return totalCompletedDays || currentWeekCount;
}

function getWeekStart(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday as week start
  result.setDate(result.getDate() - diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function getWeekCompletionCount(
  weekStart: Date,
  countOnDay: Record<string, number>,
  minValue: number,
): number {
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(weekStart);
    checkDate.setDate(checkDate.getDate() + i);
    const dateStr = localDateStr(checkDate);
    if (countOnDay[dateStr] && countOnDay[dateStr] >= minValue) {
      count++;
    }
  }
  return count;
}

function setDayToLastConsideredWeekday(date: Date, streakWeekDays: Record<number, boolean>): void {
  let i = 0;
  while (!streakWeekDays[date.getDay()]) {
    date.setDate(date.getDate() - 1);
    i++;
    if (i > 7) break; // fail-safe: all weekdays disabled
  }
}
