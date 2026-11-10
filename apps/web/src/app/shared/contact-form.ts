import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  CONTACT_RELATIONS,
  CONTACT_RELATION_LABELS,
  type ContactRelation,
  type ContactRow,
} from '@jobbotix/shared-types';
import { PeopleRepo } from '../core/data/repos';
import { Button, Field, FieldControl, Sheet } from '../ui';
import { Toast } from './toast';

interface Draft {
  name: string;
  title: string;
  company: string;
  relation: ContactRelation;
  email: string;
  linkedin_url: string;
  notes: string;
}

/**
 * Add or edit a person in a sheet. With `roleId` a new person is linked to
 * that role as well.
 * `<jb-contact-form [(open)]="adding" [defaults]="{ company: role.company, roleId: role.id }" />`
 */
@Component({
  selector: 'jb-contact-form',
  imports: [Button, Field, FieldControl, Sheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <jb-sheet
      [(open)]="open"
      [title]="contact() ? 'Edit person' : 'Add a person'"
    >
      <form
        id="contact-form"
        class="flex flex-col gap-4"
        (submit)="$event.preventDefault(); submit()"
      >
        <jb-field label="Name">
          <input
            jbInput
            id="cf-name"
            required
            maxlength="120"
            autocomplete="off"
            [value]="draft().name"
            (input)="set('name', $any($event.target).value)"
          />
        </jb-field>
        <div class="grid gap-4 sm:grid-cols-2">
          <jb-field label="Company" [optional]="true">
            <input
              jbInput
              id="cf-company"
              maxlength="200"
              [value]="draft().company"
              (input)="set('company', $any($event.target).value)"
            />
          </jb-field>
          <jb-field label="Their job title" [optional]="true">
            <input
              jbInput
              id="cf-title"
              maxlength="200"
              [value]="draft().title"
              (input)="set('title', $any($event.target).value)"
            />
          </jb-field>
        </div>
        <jb-field label="Who they are to you">
          <select
            jbInput
            id="cf-relation"
            (change)="set('relation', $any($event.target).value)"
          >
            @for (r of relations; track r) {
              <option [value]="r" [selected]="r === draft().relation">
                {{ relationLabels[r] }}
              </option>
            }
          </select>
        </jb-field>
        <div class="grid gap-4 sm:grid-cols-2">
          <jb-field label="Email" [optional]="true">
            <input
              jbInput
              id="cf-email"
              type="email"
              maxlength="320"
              [value]="draft().email"
              (input)="set('email', $any($event.target).value)"
            />
          </jb-field>
          <jb-field label="LinkedIn" [optional]="true">
            <input
              jbInput
              id="cf-linkedin"
              type="url"
              maxlength="500"
              placeholder="https://www.linkedin.com/in/…"
              [value]="draft().linkedin_url"
              (input)="set('linkedin_url', $any($event.target).value)"
            />
          </jb-field>
        </div>
        <jb-field
          label="Notes"
          [optional]="true"
          hint="How you know them, what they care about. Drafted messages use this."
        >
          <textarea
            jbInput
            id="cf-notes"
            rows="3"
            [value]="draft().notes"
            (input)="set('notes', $any($event.target).value)"
          ></textarea>
        </jb-field>
      </form>
      <div footer class="flex justify-end gap-2">
        <button type="button" jbButton="ghost" (click)="open.set(false)">
          Cancel
        </button>
        <button
          type="submit"
          form="contact-form"
          jbButton="primary"
          [busy]="busy()"
          [disabled]="busy() || !draft().name.trim()"
        >
          {{ contact() ? 'Save' : 'Add person' }}
        </button>
      </div>
    </jb-sheet>
  `,
})
export class ContactForm {
  private readonly repo = inject(PeopleRepo);
  private readonly toast = inject(Toast);
  readonly open = model(false);
  /** The person to edit; null adds one. */
  readonly contact = input<ContactRow | null>(null);
  readonly defaults = input<{
    company?: string;
    relation?: ContactRelation;
    roleId?: string;
  }>({});
  readonly saved = output<ContactRow>();

  readonly relations = CONTACT_RELATIONS;
  readonly relationLabels = CONTACT_RELATION_LABELS;
  readonly draft = signal<Draft>(this.blank());
  readonly busy = signal(false);

  constructor() {
    // fill the form each time it opens
    effect(() => {
      if (!this.open()) return;
      const c = this.contact();
      untracked(() =>
        this.draft.set(
          c
            ? {
                name: c.name,
                title: c.title,
                company: c.company,
                relation: c.relation,
                email: c.email,
                linkedin_url: c.linkedin_url,
                notes: c.notes,
              }
            : this.blank(),
        ),
      );
    });
  }

  private blank(): Draft {
    const d = this.defaults?.() ?? {};
    return {
      name: '',
      title: '',
      company: d.company ?? '',
      relation: d.relation ?? 'recruiter',
      email: '',
      linkedin_url: '',
      notes: '',
    };
  }

  set<K extends keyof Draft>(key: K, value: Draft[K]) {
    this.draft.update((d) => ({ ...d, [key]: value }));
  }

  async submit() {
    const d = this.draft();
    if (!d.name.trim()) return;
    const input = {
      name: d.name.trim(),
      title: d.title.trim(),
      company: d.company.trim(),
      relation: d.relation,
      email: d.email.trim(),
      linkedin_url: d.linkedin_url.trim(),
      notes: d.notes.trim(),
    };
    this.busy.set(true);
    try {
      const existing = this.contact();
      const row = await this.repo.save(existing?.id ?? null, input);
      const roleId = this.defaults().roleId;
      if (!existing && roleId) await this.repo.link(roleId, row.id);
      this.open.set(false);
      this.toast.show(existing ? 'Saved' : `Added ${row.name}`);
      this.saved.emit(row);
    } catch (e) {
      this.toast.show((e as Error).message || 'Could not save');
    } finally {
      this.busy.set(false);
    }
  }
}
