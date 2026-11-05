/** What a share link exposes: never notes, answers or anything about other users. */
import type { EmploymentType, RoleStatus } from './database.types';

export interface SharedRole {
  company: string;
  title: string;
  url: string;
  location: string;
  remote_scope: string;
  type: EmploymentType;
  salary: string;
  stack: string[];
  score: number;
  reasons: string[];
  gaps: string[];
  ai_match: boolean;
  status: RoleStatus;
  cover_letter: string;
  found_at: string;
  posting_text: string;
}

export interface SharedBoardRole {
  company: string;
  title: string;
  url: string;
  score: number;
  status: RoleStatus;
  type: EmploymentType;
  remote_scope: string;
  status_changed_at: string;
}

export type SharedView =
  | { kind: 'role'; owner: string; created_at: string; role: SharedRole }
  | {
      kind: 'board';
      owner: string;
      created_at: string;
      roles: SharedBoardRole[];
    };
