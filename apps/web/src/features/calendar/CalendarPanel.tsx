import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Holiday, WorkingCalendar } from '@rp/shared';
import { ApiError } from '../../api/client';
import {
  addHoliday,
  deleteHoliday,
  getCalendar,
  updateCalendar,
} from '../../api/calendar';
import { formatRelative } from '../../utils/time';
import {
  DaySchedule,
  hhmmToHour,
  hourToHHMM,
  serializeWeeklyHours,
} from './weeklyHours';
import { useToast } from '../../components/Toast';

interface CalendarPanelProps {
  workspaceId: string;
  canEdit: boolean;
  onClose: () => void;
  refreshTrigger?: number;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function toDayScheduleArray(cal: WorkingCalendar): DaySchedule[] {
  const arr = cal.weeklyHours.slice();
  while (arr.length < 7) arr.push(null);
  return arr.slice(0, 7).map((e) =>
    e === null
      ? null
      : { startHour: e.startHour, endHour: e.endHour }
  );
}

export function CalendarPanel({
  workspaceId,
  canEdit,
  onClose,
  refreshTrigger,
}: CalendarPanelProps) {
  const { t } = useTranslation();
  const toast = useToast();

  const [calendar, setCalendar] = useState<WorkingCalendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [schedule, setSchedule] = useState<DaySchedule[]>(() =>
    Array.from({ length: 7 }, () => null)
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0); // for formatRelative refresh

  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayName, setNewHolidayName] = useState('');
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [holidayError, setHolidayError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const cal = await getCalendar(workspaceId);
      setCalendar(cal);
      setSchedule(toDayScheduleArray(cal));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshTrigger]);

  // Bump savedTick every minute so the "Saved N min ago" label updates.
  useEffect(() => {
    const timer = window.setInterval(() => setSavedTick((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const handleToggleDay = useCallback(
    (idx: number, open: boolean) => {
      setSchedule((prev) => {
        const next = prev.slice();
        next[idx] = open ? { startHour: 9, endHour: 18 } : null;
        return next;
      });
    },
    []
  );

  const handleTimeChange = useCallback(
    (idx: number, kind: 'start' | 'end', value: string) => {
      setSchedule((prev) => {
        const next = prev.slice();
        const cur = next[idx];
        if (!cur) return prev;
        try {
          const hour = hhmmToHour(value);
          next[idx] = {
            startHour: kind === 'start' ? hour : cur.startHour,
            endHour: kind === 'end' ? hour : cur.endHour,
          };
        } catch {
          // Ignore invalid intermediate values; <input type="time"> keeps its UI value.
        }
        return next;
      });
    },
    []
  );

  const handleSave = useCallback(async () => {
    setSaveError(null);
    let payload: string;
    try {
      payload = serializeWeeklyHours(schedule);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(
        /before end time/i.test(msg) ? t('calendar.invalidRange') : msg
      );
      return;
    }
    setSaving(true);
    try {
      const updated = await updateCalendar(workspaceId, payload);
      setCalendar(updated);
      setSchedule(toDayScheduleArray(updated));
      setSavedTick((n) => n + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setSaveError(t('calendar.readOnly'));
      } else {
        setSaveError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSaving(false);
    }
  }, [schedule, workspaceId, t]);

  const holidays = calendar?.holidays ?? [];
  const duplicateDate = useMemo(
    () =>
      newHolidayDate.length > 0 &&
      holidays.some((h) => h.date === newHolidayDate),
    [holidays, newHolidayDate]
  );

  const handleAddHoliday = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const date = newHolidayDate.trim();
      const name = newHolidayName.trim();
      if (!date || !name) return;
      if (duplicateDate) {
        setHolidayError(t('calendar.duplicateDate'));
        return;
      }
      setAddingHoliday(true);
      setHolidayError(null);
      try {
        await addHoliday(workspaceId, date, name);
        setNewHolidayDate('');
        setNewHolidayName('');
        await refresh();
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setHolidayError(t('calendar.duplicateDate'));
        } else {
          setHolidayError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setAddingHoliday(false);
      }
    },
    [newHolidayDate, newHolidayName, duplicateDate, workspaceId, refresh, t]
  );

  const handleDeleteHoliday = useCallback(
    async (h: Holiday) => {
      // Optimistic removal.
      const prev = calendar;
      if (prev) {
        setCalendar({
          ...prev,
          holidays: prev.holidays.filter((x) => x.id !== h.id),
        });
      }
      try {
        await deleteHoliday(h.id);
      } catch (err) {
        // Restore on error.
        if (prev) setCalendar(prev);
        const msg = err instanceof Error ? err.message : String(err);
        toast.push(msg, { kind: 'error' });
      }
    },
    [calendar, toast]
  );

  const savedLabel = useMemo(() => {
    if (!calendar) return null;
    // savedTick re-reads updatedAt via closure; intentionally referenced to
    // keep the relative label fresh as time passes.
    void savedTick;
    const rel = formatRelative(calendar.updatedAt);
    return t('calendar.saved', {
      time: t(rel.key, rel.values as { n: number } | undefined),
    });
  }, [calendar, savedTick, t]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560 }}
      >
        <button className="modal-close" onClick={onClose} aria-label={t('common.close')}>
          ✕
        </button>
        <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>
          {t('calendar.title')}
        </h3>

        {loading && <p>{t('common.loading')}</p>}
        {loadError && !loading && (
          <div>
            <p className="error-message" style={{ marginBottom: '0.5rem' }}>
              {t('calendar.loadFailed')}: {loadError}
            </p>
            <button
              type="button"
              onClick={() => void refresh()}
              style={{
                padding: '0.3rem 0.8rem',
                fontSize: '0.85rem',
                border: '1px solid var(--border-color, #ddd)',
                borderRadius: 4,
                background: 'var(--bg-secondary, #eef1f5)',
                cursor: 'pointer',
              }}
            >
              {t('calendar.retry')}
            </button>
          </div>
        )}

        {!loading && !loadError && calendar && (
          <>
            {/* Section A: weekly working hours */}
            <section style={{ marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 0.5rem' }}>
                {t('calendar.weeklyHours')}
              </h4>
              <div
                className="rd-cal-weekly-grid"
                style={{
                  display: 'grid',
                  alignItems: 'center',
                  rowGap: '0.35rem',
                  columnGap: '0.5rem',
                  fontSize: '0.9rem',
                }}
              >
                {DAY_KEYS.map((dkey, idx) => {
                  const entry = schedule[idx];
                  const open = entry !== null;
                  return (
                    <React.Fragment key={dkey}>
                      <div style={{ fontWeight: 500 }}>
                        {t(`calendar.day.${dkey}` as const)}
                      </div>
                      <label
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: '0.85rem',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={open}
                          disabled={!canEdit}
                          onChange={(e) => handleToggleDay(idx, e.target.checked)}
                        />
                        {open ? t('calendar.open') : t('calendar.closed')}
                      </label>
                      {open && entry ? (
                        <>
                          <input
                            type="time"
                            value={hourToHHMM(entry.startHour)}
                            disabled={!canEdit}
                            aria-label={t('calendar.from')}
                            onChange={(e) =>
                              handleTimeChange(idx, 'start', e.target.value)
                            }
                            style={{
                              padding: '0.25rem 0.4rem',
                              border: '1px solid var(--border-color, #ddd)',
                              borderRadius: 4,
                            }}
                          />
                          <input
                            type="time"
                            value={hourToHHMM(entry.endHour)}
                            disabled={!canEdit}
                            aria-label={t('calendar.to')}
                            onChange={(e) =>
                              handleTimeChange(idx, 'end', e.target.value)
                            }
                            style={{
                              padding: '0.25rem 0.4rem',
                              border: '1px solid var(--border-color, #ddd)',
                              borderRadius: 4,
                            }}
                          />
                        </>
                      ) : (
                        <>
                          <span />
                          <span />
                        </>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              <div
                style={{
                  marginTop: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                }}
              >
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving}
                    style={{
                      padding: '0.4rem 1rem',
                      fontSize: '0.9rem',
                      border: '1px solid var(--border-color, #ddd)',
                      borderRadius: 4,
                      background: 'var(--bg-secondary, #eef1f5)',
                      cursor: saving ? 'wait' : 'pointer',
                    }}
                  >
                    {saving ? t('calendar.saving') : t('calendar.save')}
                  </button>
                )}
                {!canEdit && (
                  <span
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--muted-color, #666)',
                    }}
                  >
                    {t('calendar.readOnly')}
                  </span>
                )}
                {savedLabel && (
                  <span
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--muted-color, #666)',
                    }}
                  >
                    {savedLabel}
                  </span>
                )}
              </div>
              {saveError && (
                <div
                  className="error-message"
                  style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
                >
                  {saveError}
                </div>
              )}
            </section>

            {/* Section B: holidays */}
            <section>
              <h4 style={{ margin: '0 0 0.5rem' }}>
                {t('calendar.holidays')}
              </h4>
              {holidays.length === 0 ? (
                <p
                  style={{
                    margin: '0 0 0.75rem',
                    fontSize: '0.9rem',
                    color: 'var(--muted-color, #666)',
                  }}
                >
                  {t('calendar.noHolidays')}
                </p>
              ) : (
                <ul
                  style={{
                    listStyle: 'none',
                    padding: 0,
                    margin: '0 0 0.75rem',
                    border: '1px solid var(--border-color, #ddd)',
                    borderRadius: 6,
                  }}
                >
                  {holidays
                    .slice()
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((h, idx) => (
                      <li
                        key={h.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.4rem 0.75rem',
                          borderTop:
                            idx === 0
                              ? 'none'
                              : '1px solid var(--border-color, #eee)',
                          gap: '0.5rem',
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <span
                            style={{
                              fontFamily: 'monospace',
                              marginRight: '0.5rem',
                            }}
                          >
                            {h.date}
                          </span>
                          <span>{h.name}</span>
                        </div>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteHoliday(h)}
                            aria-label={t('common.remove')}
                            style={{
                              padding: '2px 10px',
                              fontSize: '0.8rem',
                              border: '1px solid var(--border-color, #ddd)',
                              borderRadius: 4,
                              background: 'transparent',
                              cursor: 'pointer',
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </li>
                    ))}
                </ul>
              )}

              {canEdit && (
                <form
                  onSubmit={handleAddHoliday}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    paddingTop: '0.5rem',
                    borderTop: '1px solid var(--border-color, #eee)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.5rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <input
                      type="date"
                      value={newHolidayDate}
                      onChange={(e) => {
                        setNewHolidayDate(e.target.value);
                        setHolidayError(null);
                      }}
                      aria-label={t('calendar.holidayDate')}
                      required
                      style={{
                        padding: '0.4rem 0.5rem',
                        fontSize: '0.9rem',
                        border: '1px solid var(--border-color, #ddd)',
                        borderRadius: 4,
                      }}
                    />
                    <input
                      type="text"
                      value={newHolidayName}
                      onChange={(e) => setNewHolidayName(e.target.value)}
                      placeholder={t('calendar.holidayName')}
                      required
                      style={{
                        flex: '1 1 160px',
                        padding: '0.4rem 0.5rem',
                        fontSize: '0.9rem',
                        border: '1px solid var(--border-color, #ddd)',
                        borderRadius: 4,
                      }}
                    />
                    <button
                      type="submit"
                      disabled={
                        addingHoliday ||
                        !newHolidayDate.trim() ||
                        !newHolidayName.trim() ||
                        duplicateDate
                      }
                      style={{
                        padding: '0.4rem 1rem',
                        fontSize: '0.9rem',
                        border: '1px solid var(--border-color, #ddd)',
                        borderRadius: 4,
                        background: 'var(--bg-secondary, #eef1f5)',
                        cursor: addingHoliday ? 'wait' : 'pointer',
                      }}
                    >
                      {t('calendar.addHoliday')}
                    </button>
                  </div>
                  {duplicateDate && !holidayError && (
                    <div
                      className="error-message"
                      style={{ fontSize: '0.85rem' }}
                    >
                      {t('calendar.duplicateDate')}
                    </div>
                  )}
                  {holidayError && (
                    <div
                      className="error-message"
                      style={{ fontSize: '0.85rem' }}
                    >
                      {holidayError}
                    </div>
                  )}
                </form>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
