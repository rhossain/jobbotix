import { Pipe, PipeTransform } from '@angular/core';
import {
  EMPLOYMENT_TYPE_LABELS,
  ROLE_STATUS_LABELS,
  type EmploymentType,
  type RoleStatus,
} from '@jobbotix/shared-types';

// English date words, formatted by hand: the first Intl/toLocale* call on a
// page starts the browser's ICU engine, which costs tens of milliseconds on a
// slow phone, and the app's copy is English anyway.
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** "6 Nov" */
export function shortDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

/** "6 November" */
export function dayMonth(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "Friday 6 November" */
export function longDate(d: Date): string {
  return `${DAYS[d.getDay()]} ${dayMonth(d)}`;
}

/** "06:45" (24-hour, local time) */
export function clockTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Month abbreviation for a UTC date: "Nov" */
export function utcMonthShort(d: Date): string {
  return MONTHS[d.getUTCMonth()].slice(0, 3);
}

/** "today", "yesterday", "3 days ago", else a short date. */
export function relativeDay(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const days = Math.round((startOfDay(today) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return shortDate(d);
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function daysSince(iso: string): number {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000),
  );
}

export function scoreBand(score: number): 'high' | 'mid' | 'low' {
  return score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low';
}

@Pipe({ name: 'relativeDay' })
export class RelativeDayPipe implements PipeTransform {
  transform(value: string | null | undefined) {
    return relativeDay(value);
  }
}

@Pipe({ name: 'statusLabel' })
export class StatusLabelPipe implements PipeTransform {
  transform(value: RoleStatus) {
    return ROLE_STATUS_LABELS[value] ?? value;
  }
}

@Pipe({ name: 'typeLabel' })
export class TypeLabelPipe implements PipeTransform {
  transform(value: EmploymentType) {
    return EMPLOYMENT_TYPE_LABELS[value] ?? value;
  }
}
