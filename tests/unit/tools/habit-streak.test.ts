import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computeHabitStreak, type HabitStreakInput } from '../../../src/tools/habit-streak.js';
import { localDateStr } from '../../../src/tools/tasks.js';

// DST-safe helper: calendar arithmetic (setDate), not millisecond subtraction,
// which breaks during DST transitions when a day is 23 or 25 hours.
const daysAgo = (n: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const ALL_DAYS = { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true };

describe('computeHabitStreak — specific-days mode', () => {
  it('returns 0 with no streak config', () => {
    const habit: HabitStreakInput = { countOnDay: {} };
    expect(computeHabitStreak(habit)).toBe(0);
  });

  it('returns 0 with an empty countOnDay', () => {
    const habit: HabitStreakInput = {
      countOnDay: {},
      streakMinValue: 1,
      streakWeekDays: ALL_DAYS,
    };
    expect(computeHabitStreak(habit)).toBe(0);
  });

  it('returns 0 when all weekdays are disabled', () => {
    const habit: HabitStreakInput = {
      countOnDay: { [localDateStr()]: 1 },
      streakMinValue: 1,
      streakWeekDays: { 0: false, 1: false, 2: false, 3: false, 4: false, 5: false, 6: false },
    };
    expect(computeHabitStreak(habit)).toBe(0);
  });

  it('counts a streak broken by a gap', () => {
    const habit: HabitStreakInput = {
      countOnDay: {
        [localDateStr()]: 1,
        [localDateStr(daysAgo(1))]: 1,
        [localDateStr(daysAgo(2))]: 0, // gap
        [localDateStr(daysAgo(3))]: 1,
      },
      streakMinValue: 1,
      streakWeekDays: ALL_DAYS,
    };
    expect(computeHabitStreak(habit)).toBe(2);
  });

  it('counts a 14-day streak crossing a week boundary', () => {
    const countOnDay: Record<string, number> = {};
    for (let i = 0; i < 14; i++) countOnDay[localDateStr(daysAgo(i))] = 1;
    const habit: HabitStreakInput = { countOnDay, streakMinValue: 1, streakWeekDays: ALL_DAYS };
    expect(computeHabitStreak(habit)).toBe(14);
  });

  it('starts counting at yesterday, not today, when today is not yet done', () => {
    const countOnDay: Record<string, number> = {};
    for (let i = 1; i < 14; i++) countOnDay[localDateStr(daysAgo(i))] = 1;
    // today intentionally left unset
    const habit: HabitStreakInput = { countOnDay, streakMinValue: 1, streakWeekDays: ALL_DAYS };
    expect(computeHabitStreak(habit)).toBe(13);
  });
});

describe('computeHabitStreak — weekly-frequency mode', () => {
  // Fixed reference date (a Thursday) for deterministic week-boundary math.
  const FIXED_REFERENCE_DATE = new Date('2026-01-30T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_REFERENCE_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 with no frequency specified', () => {
    const habit: HabitStreakInput = {
      countOnDay: {},
      streakMode: 'weekly-frequency',
      streakMinValue: 1,
    };
    expect(computeHabitStreak(habit)).toBe(0);
  });

  it('returns 0 with an empty countOnDay', () => {
    const habit: HabitStreakInput = {
      countOnDay: {},
      streakMode: 'weekly-frequency',
      streakMinValue: 1,
      streakWeeklyFrequency: 3,
    };
    expect(computeHabitStreak(habit)).toBe(0);
  });

  it('returns 3 when the current week already meets the target', () => {
    const habit: HabitStreakInput = {
      countOnDay: {
        [localDateStr(daysAgo(1))]: 1,
        [localDateStr(daysAgo(2))]: 1,
        [localDateStr(daysAgo(3))]: 1,
      },
      streakMode: 'weekly-frequency',
      streakMinValue: 1,
      streakWeeklyFrequency: 3,
    };
    expect(computeHabitStreak(habit)).toBe(3);
  });

  it('carries over from last week when the current week is incomplete', () => {
    const habit: HabitStreakInput = {
      countOnDay: {
        // Last week - 3 completions
        [localDateStr(daysAgo(7))]: 1,
        [localDateStr(daysAgo(9))]: 1,
        [localDateStr(daysAgo(10))]: 1,
        // This week - only 1 completion
        [localDateStr(daysAgo(1))]: 1,
      },
      streakMode: 'weekly-frequency',
      streakMinValue: 1,
      streakWeeklyFrequency: 3,
    };
    expect(computeHabitStreak(habit)).toBe(4);
  });

  it('respects streakMinValue as the per-day completion threshold', () => {
    const habit: HabitStreakInput = {
      countOnDay: {
        // Last week - 3 days but only 2 meet the min value
        [localDateStr(daysAgo(7))]: 5,
        [localDateStr(daysAgo(8))]: 5,
        [localDateStr(daysAgo(9))]: 2, // below threshold
      },
      streakMode: 'weekly-frequency',
      streakMinValue: 3,
      streakWeeklyFrequency: 3,
    };
    expect(computeHabitStreak(habit)).toBe(0);
  });
});
