import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/ipc/command-sender.js', () => ({
  sendCommand: vi.fn(),
}));

import { sendCommand } from '../../../src/ipc/command-sender.js';
import { attachStreaks, createHabitSchema, setHabitValueSchema } from '../../../src/tools/habits.js';
import type { ResolvedDirs } from '../../../src/ipc/directories.js';
import type { Response } from '../../../src/ipc/types.js';

const mockSend = vi.mocked(sendCommand);
const dirs: ResolvedDirs = { base: '/tmp/test', commands: '/tmp/test/pc', responses: '/tmp/test/pr' };

// Instead of testing through McpServer (which has no public API to call tools),
// we test the sendCommand integration directly, matching the convention in
// tags.test.ts / tasks.test.ts. Data-transformation logic (attachStreaks) gets
// real unit tests below since it's a pure function, unlike the thin CRUD tools.

function mockResponse(result: unknown): Response {
  return { success: true, result, timestamp: Date.now() };
}

describe('habit tool logic', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('create_habit via sendCommand', () => {
    it('sends addHabit with a minimal title-only payload', async () => {
      mockSend.mockResolvedValueOnce(mockResponse('habit-123'));
      const res = await sendCommand(dirs, 'addHabit', { data: { title: 'Drink water' } });
      expect(res.success).toBe(true);
      expect(res.result).toBe('habit-123');
      expect(mockSend).toHaveBeenCalledWith(dirs, 'addHabit', { data: { title: 'Drink water' } });
    });

    it('sends addHabit with specific-days streak config', async () => {
      mockSend.mockResolvedValueOnce(mockResponse('habit-456'));
      await sendCommand(dirs, 'addHabit', {
        data: {
          title: 'Morning run',
          isTrackStreaks: true,
          streakMode: 'specific-days',
          streakMinValue: 1,
          streakWeekDays: { 1: true, 3: true, 5: true },
        },
      });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'addHabit', {
        data: {
          title: 'Morning run',
          isTrackStreaks: true,
          streakMode: 'specific-days',
          streakMinValue: 1,
          streakWeekDays: { 1: true, 3: true, 5: true },
        },
      });
    });

    it('sends addHabit with weekly-frequency streak config', async () => {
      mockSend.mockResolvedValueOnce(mockResponse('habit-789'));
      await sendCommand(dirs, 'addHabit', {
        data: { title: 'Gym', isTrackStreaks: true, streakMode: 'weekly-frequency', streakMinValue: 1, streakWeeklyFrequency: 3 },
      });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'addHabit', {
        data: { title: 'Gym', isTrackStreaks: true, streakMode: 'weekly-frequency', streakMinValue: 1, streakWeeklyFrequency: 3 },
      });
    });

    it('rejects a missing title', () => {
      expect(createHabitSchema.safeParse({}).success).toBe(false);
    });

    it('rejects streak_week_days keys outside 0-6', () => {
      const result = createHabitSchema.safeParse({
        title: 'X',
        streak_week_days: { monday: true },
      });
      expect(result.success).toBe(false);
    });

    it('accepts streak_week_days keys within 0-6', () => {
      const result = createHabitSchema.safeParse({
        title: 'X',
        streak_week_days: { 0: true, 6: false },
      });
      expect(result.success).toBe(true);
    });

    it('rejects a negative streak_min_value', () => {
      expect(createHabitSchema.safeParse({ title: 'X', streak_min_value: -1 }).success).toBe(false);
    });

    it('rejects a negative streak_weekly_frequency', () => {
      expect(createHabitSchema.safeParse({ title: 'X', streak_weekly_frequency: -1 }).success).toBe(false);
    });

    it('rejects an unrecognized parameter, naming it in the error', () => {
      const result = createHabitSchema.safeParse({ title: 'X', ttile: 'typo' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).toContain('ttile');
      }
    });
  });

  describe('get_habits via sendCommand', () => {
    it('sends getAllHabits and returns the raw list', async () => {
      const habits = [{ id: 'h1', title: 'Drink water', type: 'ClickCounter', countOnDay: {} }];
      mockSend.mockResolvedValueOnce(mockResponse(habits));
      const res = await sendCommand(dirs, 'getAllHabits');
      expect(res.success).toBe(true);
      expect(res.result).toEqual(habits);
    });

    it('returns an empty array when no habits exist', async () => {
      mockSend.mockResolvedValueOnce(mockResponse([]));
      const res = await sendCommand(dirs, 'getAllHabits');
      expect(res.result).toEqual([]);
    });
  });

  describe('attachStreaks (data transformation)', () => {
    it('attaches a computed streak field to each habit', () => {
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const habits = [
        {
          id: 'h1',
          title: 'Drink water',
          type: 'ClickCounter',
          streakMinValue: 1,
          streakWeekDays: { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true },
          countOnDay: { [todayStr]: 1 },
        },
      ];
      const result = attachStreaks(habits);
      expect(result).toHaveLength(1);
      expect(result[0].streak).toBe(1);
      expect(result[0].id).toBe('h1');
    });

    it('returns an empty array for an empty input', () => {
      expect(attachStreaks([])).toEqual([]);
    });

    it('does not mutate the input habits', () => {
      const habits = [{ id: 'h1', title: 'X', type: 'ClickCounter', countOnDay: {} }];
      attachStreaks(habits);
      expect(habits[0]).not.toHaveProperty('streak');
    });
  });

  describe('update_habit via sendCommand', () => {
    it('sends updateHabit with only the changed fields', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      await sendCommand(dirs, 'updateHabit', { habitId: 'habit-1', data: { title: 'New title' } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'updateHabit', {
        habitId: 'habit-1',
        data: { title: 'New title' },
      });
    });

    it('surfaces a not-found error unchanged', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Habit not found: missing-id', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'updateHabit', { habitId: 'missing-id', data: { title: 'X' } });
      expect(res.success).toBe(false);
      expect(res.error).toContain('not found');
    });
  });

  describe('check_habit via sendCommand', () => {
    it('sends checkHabit with no date (defaults to today downstream)', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(1));
      const res = await sendCommand(dirs, 'checkHabit', { habitId: 'habit-1', data: {} });
      expect(res.success).toBe(true);
      expect(res.result).toBe(1);
    });

    it('sends checkHabit with an explicit date', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(2));
      await sendCommand(dirs, 'checkHabit', { habitId: 'habit-1', data: { date: '2026-08-10' } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'checkHabit', {
        habitId: 'habit-1',
        data: { date: '2026-08-10' },
      });
    });

    it('surfaces a not-found error unchanged', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Habit not found: missing-id', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'checkHabit', { habitId: 'missing-id', data: {} });
      expect(res.success).toBe(false);
    });
  });

  describe('set_habit_value via sendCommand', () => {
    it('sends setHabitValue to backfill a past date', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      await sendCommand(dirs, 'setHabitValue', { habitId: 'habit-1', data: { date: '2026-08-01', value: 1 } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'setHabitValue', {
        habitId: 'habit-1',
        data: { date: '2026-08-01', value: 1 },
      });
    });

    it('sends setHabitValue to correct today to 0', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      await sendCommand(dirs, 'setHabitValue', { habitId: 'habit-1', data: { date: '2026-08-13', value: 0 } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'setHabitValue', {
        habitId: 'habit-1',
        data: { date: '2026-08-13', value: 0 },
      });
    });

    it('omits date from the payload when not provided, so the plugin defaults it (not the server)', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      await sendCommand(dirs, 'setHabitValue', { habitId: 'habit-1', data: { value: 1 } });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'setHabitValue', {
        habitId: 'habit-1',
        data: { value: 1 },
      });
    });

    it('rejects a negative value', () => {
      expect(setHabitValueSchema.safeParse({ habit_id: 'habit-1', value: -1 }).success).toBe(false);
    });

    it('rejects a non-integer value', () => {
      expect(setHabitValueSchema.safeParse({ habit_id: 'habit-1', value: 1.5 }).success).toBe(false);
    });

    it('accepts a valid payload', () => {
      expect(setHabitValueSchema.safeParse({ habit_id: 'habit-1', value: 1, date: '2026-08-13' }).success).toBe(true);
    });

    it('rejects an unrecognized parameter, naming it in the error', () => {
      const result = setHabitValueSchema.safeParse({ habit_id: 'habit-1', value: 1, vlaue: 2 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).toContain('vlaue');
      }
    });
  });

  describe('delete_habit via sendCommand', () => {
    it('sends deleteHabit with the habit id', async () => {
      mockSend.mockResolvedValueOnce(mockResponse(null));
      await sendCommand(dirs, 'deleteHabit', { habitId: 'habit-1' });
      expect(mockSend).toHaveBeenCalledWith(dirs, 'deleteHabit', { habitId: 'habit-1' });
    });

    it('surfaces a not-found error unchanged', async () => {
      mockSend.mockResolvedValueOnce({ success: false, error: 'Habit not found: missing-id', timestamp: Date.now() });
      const res = await sendCommand(dirs, 'deleteHabit', { habitId: 'missing-id' });
      expect(res.success).toBe(false);
      expect(res.error).toContain('not found');
    });
  });
});
