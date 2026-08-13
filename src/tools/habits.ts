import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResolvedDirs } from '../ipc/directories.js';
import { sendCommand } from '../ipc/command-sender.js';
import { errorResult, okResult } from './result.js';
import { computeHabitStreak, type HabitStreakInput } from './habit-streak.js';

interface RawHabit extends HabitStreakInput {
  id: string;
  title: string;
  type: string;
  isEnabled?: boolean;
  icon?: string | null;
  [key: string]: unknown;
}

const streakModeSchema = z.enum(['specific-days', 'weekly-frequency']);

/** Attaches SP's on-the-fly-computed streak length to each habit. Exported for testability. */
export function attachStreaks(habits: RawHabit[]): Array<RawHabit & { streak: number }> {
  return (habits || []).map(h => ({ ...h, streak: computeHabitStreak(h) }));
}

export function registerHabitTools(server: McpServer, dirs: ResolvedDirs): void {
  server.registerTool('create_habit', {
    description: 'Create a new habit (streak-tracked click counter) in Super Productivity.',
    inputSchema: {
      title: z.string().describe('Habit title'),
      icon: z.string().optional().describe('Icon'),
      is_track_streaks: z.boolean().optional().describe('Whether to track streaks for this habit'),
      streak_mode: streakModeSchema.optional().describe('Streak mode: specific-days or weekly-frequency'),
      streak_min_value: z.number().optional().describe('Minimum daily value that counts as done for streak purposes'),
      streak_week_days: z.record(z.string(), z.boolean()).optional().describe('Weekdays (0=Sunday..6=Saturday) this habit applies to, for specific-days streak mode'),
      streak_weekly_frequency: z.number().optional().describe('Target number of completions per week, for weekly-frequency streak mode'),
    },
  }, async ({ title, icon, is_track_streaks, streak_mode, streak_min_value, streak_week_days, streak_weekly_frequency }) => {
    if (!title?.trim()) return errorResult('Title is required');
    const data: Record<string, unknown> = { title };
    if (icon !== undefined) data.icon = icon;
    if (is_track_streaks !== undefined) data.isTrackStreaks = is_track_streaks;
    if (streak_mode !== undefined) data.streakMode = streak_mode;
    if (streak_min_value !== undefined) data.streakMinValue = streak_min_value;
    if (streak_week_days !== undefined) data.streakWeekDays = streak_week_days;
    if (streak_weekly_frequency !== undefined) data.streakWeeklyFrequency = streak_weekly_frequency;
    const res = await sendCommand(dirs, 'addHabit', { data });
    if (!res.success) return errorResult(res.error ?? 'Failed to create habit');
    return okResult({ habitId: res.result });
  });

  server.registerTool('get_habits', {
    description: 'Get all habits from Super Productivity, including each habit\'s currently computed streak length.',
    inputSchema: {},
  }, async () => {
    const res = await sendCommand(dirs, 'getAllHabits');
    if (!res.success) return errorResult(res.error ?? 'Failed to get habits');
    return okResult(attachStreaks((res.result as RawHabit[]) ?? []));
  });

  server.registerTool('update_habit', {
    description: 'Update an existing habit\'s configuration.',
    inputSchema: {
      habit_id: z.string().describe('Habit ID to update'),
      title: z.string().optional().describe('New title'),
      icon: z.string().optional().describe('New icon'),
      is_enabled: z.boolean().optional().describe('Whether the habit is enabled'),
      is_track_streaks: z.boolean().optional().describe('Whether to track streaks for this habit'),
      streak_mode: streakModeSchema.optional().describe('Streak mode: specific-days or weekly-frequency'),
      streak_min_value: z.number().optional().describe('Minimum daily value that counts as done for streak purposes'),
      streak_week_days: z.record(z.string(), z.boolean()).optional().describe('Weekdays (0=Sunday..6=Saturday) this habit applies to, for specific-days streak mode'),
      streak_weekly_frequency: z.number().optional().describe('Target number of completions per week, for weekly-frequency streak mode'),
    },
  }, async ({ habit_id, title, icon, is_enabled, is_track_streaks, streak_mode, streak_min_value, streak_week_days, streak_weekly_frequency }) => {
    if (!habit_id?.trim()) return errorResult('habit_id is required');
    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (icon !== undefined) data.icon = icon;
    if (is_enabled !== undefined) data.isEnabled = is_enabled;
    if (is_track_streaks !== undefined) data.isTrackStreaks = is_track_streaks;
    if (streak_mode !== undefined) data.streakMode = streak_mode;
    if (streak_min_value !== undefined) data.streakMinValue = streak_min_value;
    if (streak_week_days !== undefined) data.streakWeekDays = streak_week_days;
    if (streak_weekly_frequency !== undefined) data.streakWeeklyFrequency = streak_weekly_frequency;
    const res = await sendCommand(dirs, 'updateHabit', { habitId: habit_id, data });
    if (!res.success) return errorResult(res.error ?? 'Failed to update habit');
    return okResult(res.result);
  });

  server.registerTool('check_habit', {
    description: 'Check off a habit for a day (defaults to today) by incrementing that day\'s recorded value, matching the Habit Tracker UI\'s own click behavior.',
    inputSchema: {
      habit_id: z.string().describe('Habit ID to check off'),
      date: z.string().optional().describe('Date to check off, YYYY-MM-DD (defaults to today)'),
    },
  }, async ({ habit_id, date }) => {
    if (!habit_id?.trim()) return errorResult('habit_id is required');
    const data: Record<string, unknown> = {};
    if (date !== undefined) data.date = date;
    const res = await sendCommand(dirs, 'checkHabit', { habitId: habit_id, data });
    if (!res.success) return errorResult(res.error ?? 'Failed to check off habit');
    return okResult({ value: res.result });
  });

  server.registerTool('set_habit_value', {
    description: 'Set a habit\'s exact recorded value for a specific day (defaults to today), for backfilling missed entries or correcting mistakes.',
    inputSchema: {
      habit_id: z.string().describe('Habit ID'),
      value: z.number().describe('Value to record for the day'),
      date: z.string().optional().describe('Date, YYYY-MM-DD (defaults to today)'),
    },
  }, async ({ habit_id, value, date }) => {
    if (!habit_id?.trim()) return errorResult('habit_id is required');
    const today = new Date();
    const defaultDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const res = await sendCommand(dirs, 'setHabitValue', { habitId: habit_id, data: { date: date ?? defaultDate, value } });
    if (!res.success) return errorResult(res.error ?? 'Failed to set habit value');
    return okResult(res.result);
  });

  server.registerTool('delete_habit', {
    description: 'Permanently delete a habit.',
    inputSchema: {
      habit_id: z.string().describe('Habit ID to delete'),
    },
  }, async ({ habit_id }) => {
    if (!habit_id?.trim()) return errorResult('habit_id is required');
    const res = await sendCommand(dirs, 'deleteHabit', { habitId: habit_id });
    if (!res.success) return errorResult(res.error ?? 'Failed to delete habit');
    return okResult(res.result);
  });
}
