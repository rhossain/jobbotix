import { Pipe, PipeTransform } from '@angular/core';
import {
  EMPLOYMENT_TYPE_LABELS,
  ROLE_STATUS_LABELS,
  type EmploymentType,
  type RoleStatus,
} from '@jobbotix/shared-types';

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
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
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
