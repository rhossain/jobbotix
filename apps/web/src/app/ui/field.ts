import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  afterRenderEffect,
  computed,
  contentChild,
  inject,
  input,
} from '@angular/core';

let nextId = 0;

/**
 * Marks a native input, select or textarea as a Jobbotix control: applies
 * the control style and, inside a jb-field, picks up the field's id, hint and
 * error wiring. Textareas grow with their content when `autogrow` is set.
 */
@Directive({
  selector: 'input[jbInput], select[jbInput], textarea[jbInput]',
  host: {
    class: 'jb-input',
    '(input)': 'grow()',
  },
})
export class FieldControl {
  readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly autogrow = input(false);

  constructor() {
    afterRenderEffect(() => {
      if (this.autogrow()) this.grow();
    });
  }

  grow() {
    const el = this.el.nativeElement;
    if (!this.autogrow() || !(el instanceof HTMLTextAreaElement)) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }
}

/**
 * Label, control, hint and error as one unit.
 * `<jb-field label="Name" hint="As it appears on your resume"><input jbInput formControlName="name" /></jb-field>`
 */
@Component({
  selector: 'jb-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'jb-field' },
  template: `
    <label class="jb-field-label" [attr.for]="controlId()">
      {{ label() }}
      @if (optional()) {
        <span class="font-normal text-ink-faint">(optional)</span>
      }
    </label>
    <ng-content />
    @if (error()) {
      <p class="jb-field-error" [id]="errorId" role="alert">{{ error() }}</p>
    } @else if (hint()) {
      <p class="jb-field-hint" [id]="hintId">{{ hint() }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      min-width: 0;
    }
    .jb-field-label {
      color: var(--ink);
      font-size: 0.875rem;
      font-weight: 500;
    }
    .jb-field-hint,
    .jb-field-error {
      margin: 0;
      font-size: 0.8125rem;
    }
    .jb-field-hint {
      color: var(--ink-muted);
    }
    .jb-field-error {
      color: var(--bad);
    }
  `,
})
export class Field {
  readonly label = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);
  readonly optional = input(false);

  private readonly control = contentChild(FieldControl);
  private readonly uid = `jb-field-${++nextId}`;
  protected readonly hintId = `${this.uid}-hint`;
  protected readonly errorId = `${this.uid}-error`;
  protected readonly controlId = computed(
    () => this.control()?.el.nativeElement.id || this.uid,
  );

  constructor() {
    afterRenderEffect(() => {
      const el = this.control()?.el.nativeElement;
      if (!el) return;
      if (!el.id) el.id = this.uid;
      const describedBy = this.error()
        ? this.errorId
        : this.hint()
          ? this.hintId
          : null;
      if (describedBy) el.setAttribute('aria-describedby', describedBy);
      else el.removeAttribute('aria-describedby');
      if (this.error()) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    });
  }
}
