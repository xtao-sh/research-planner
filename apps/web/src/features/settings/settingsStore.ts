import { useEffect, useState } from 'react';
import type { Task } from '@rp/shared';
import { readJson, readString, writeJson, writeString } from '../../utils/storage';

/**
 * Settings store — local-only (browser localStorage) for v1.
 *
 * Two slices:
 *   1. workspace intensity budget — daily cognitive-load points cap shown on
 *      the /now CapacityRail. Default 8.
 *   2. per-project WIP limits — soft caps used by the kanban WIP badge per
 *      status column. Stored as a per-projectId map so each project can have
 *      its own column thresholds.
 *
 * Mutations dispatch a `rp:settings-changed` window event so subscribed
 * components re-render without React context plumbing.
 */

const KEY_BUDGET = 'rp.settings.intensityBudget';
const KEY_WIP = 'rp.settings.wipLimits';
const SETTINGS_EVENT = 'rp:settings-changed';
const DEFAULT_BUDGET = 8;

export interface WipLimits {
  todo?: number | null;
  doing?: number | null;
  blocked?: number | null;
  review?: number | null;
  done?: number | null;
}

export const STATUS_KEYS: Task['status'][] = [
  'todo',
  'doing',
  'blocked',
  'review',
  'done',
];

function notify(): void {
  try {
    window.dispatchEvent(new CustomEvent(SETTINGS_EVENT));
  } catch {
    /* SSR / restricted env */
  }
}

export function getIntensityBudget(): number {
  const raw = readString(KEY_BUDGET, '');
  if (!raw) return DEFAULT_BUDGET;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_BUDGET;
}

export function setIntensityBudget(n: number): void {
  writeString(KEY_BUDGET, String(Math.max(1, Math.floor(n))));
  notify();
}

function readAllWipLimits(): Record<string, WipLimits> {
  const parsed = readJson<unknown>(KEY_WIP, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, WipLimits>)
    : {};
}

export function getWipLimits(projectId: string): WipLimits {
  if (!projectId) return {};
  const all = readAllWipLimits();
  return all[projectId] || {};
}

export function setWipLimits(projectId: string, limits: WipLimits): void {
  if (!projectId) return;
  const all = readAllWipLimits();
  // Strip empty/null/zero/NaN — empty value means "no limit", not "0".
  const cleaned: WipLimits = {};
  for (const k of STATUS_KEYS) {
    const v = limits[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      cleaned[k] = Math.floor(v);
    }
  }
  all[projectId] = cleaned;
  writeJson(KEY_WIP, all);
  notify();
}

// localStorage keys whose changes in another tab should bump the tick so
// the active tab re-reads fresh values. The browser `storage` event only
// fires in *other* tabs (not the originator), which is exactly what we
// need to keep multiple open tabs in sync.
const SETTINGS_STORAGE_KEYS = new Set<string>([KEY_BUDGET, KEY_WIP]);

/** Subscribe component to setting changes; bumps a counter on each event so
 *  consumers can re-read fresh values. */
function useSettingsTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onChange = () => setTick((n) => n + 1);
    const onStorage = (e: StorageEvent) => {
      // `e.key` is null when storage is cleared wholesale — treat that as
      // a settings change too, to be safe.
      if (e.key === null || SETTINGS_STORAGE_KEYS.has(e.key)) {
        setTick((n) => n + 1);
      }
    };
    window.addEventListener(SETTINGS_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SETTINGS_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return tick;
}

/** Hook — returns the current intensity budget and re-renders on any
 *  settings change. */
export function useIntensityBudget(): number {
  useSettingsTick();
  return getIntensityBudget();
}

/** Hook — returns the WIP limit map for a project, re-rendering on settings
 *  change. */
export function useWipLimits(projectId: string | null | undefined): WipLimits {
  useSettingsTick();
  return getWipLimits(projectId || '');
}

/** Generic hook that just exposes the change-tick — components can call
 *  read helpers themselves (e.g. when they need to combine multiple slices). */
export function useSettingsChangeTick(): number {
  return useSettingsTick();
}
