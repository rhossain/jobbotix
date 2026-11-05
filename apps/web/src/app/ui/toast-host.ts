import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Toast } from '../shared/toast';
import { Icon } from './icon';

/** Renders the toast stack. Placed once, by the app shell. */
@Component({
  selector: 'jb-toast-host',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'jb-toast-host',
    '(mouseenter)': 'toast.pause()',
    '(mouseleave)': 'toast.resume()',
    '(focusin)': 'toast.pause()',
    '(focusout)': 'toast.resume()',
  },
  template: `
    <ol aria-live="polite" aria-relevant="additions">
      @for (t of toast.items(); track t.id) {
        <li
          class="toast"
          [attr.data-tone]="t.tone"
          [attr.role]="t.tone === 'error' ? 'alert' : 'status'"
        >
          <jb-icon
            class="tone-icon"
            [name]="
              t.tone === 'error'
                ? 'circle-x'
                : t.tone === 'success'
                  ? 'circle-check'
                  : 'info'
            "
            [size]="18"
          />
          <span class="msg">{{ t.message }}</span>
          @if (t.action) {
            <button type="button" class="act" (click)="toast.act(t)">
              {{ t.action.label }}
            </button>
          }
          <button
            type="button"
            class="close"
            aria-label="Dismiss"
            (click)="toast.dismiss(t.id)"
          >
            <jb-icon name="x" [size]="16" />
          </button>
        </li>
      }
    </ol>
  `,
  styles: `
    :host {
      position: fixed;
      z-index: 60;
      left: 50%;
      bottom: calc(
        var(--toast-offset, 1rem) + env(safe-area-inset-bottom, 0px)
      );
      width: min(calc(100vw - 2 * var(--gutter)), 26rem);
      transform: translateX(-50%);
      pointer-events: none;
    }
    @media (min-width: 768px) {
      :host {
        left: auto;
        right: var(--gutter);
        transform: none;
        --toast-offset: 1.5rem;
      }
    }
    ol {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .toast {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      min-height: 3rem;
      padding: 0.5rem 0.5rem 0.5rem 0.9rem;
      border-radius: var(--r-card);
      background: var(--ink);
      color: var(--surface);
      font-size: 0.875rem;
      box-shadow: var(--elev-overlay);
      pointer-events: auto;
      animation: rise var(--dur-base) var(--motion-ease) both;
    }
    .tone-icon {
      color: color-mix(in srgb, var(--surface) 70%, transparent);
    }
    .toast[data-tone='success'] .tone-icon {
      color: var(--good-tint);
    }
    .toast[data-tone='error'] .tone-icon {
      color: var(--bad-tint);
    }
    .msg {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .act,
    .close {
      display: inline-grid;
      place-items: center;
      min-height: 2.25rem;
      border: 0;
      border-radius: var(--r-control);
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .act {
      padding: 0 0.65rem;
      color: var(--brand-tint);
      font-weight: 600;
    }
    .close {
      width: 2.25rem;
      opacity: 0.7;
    }
    .act:hover,
    .close:hover {
      background: color-mix(in srgb, var(--surface) 12%, transparent);
      opacity: 1;
    }
    @keyframes rise {
      from {
        opacity: 0;
        transform: translateY(8px) scale(0.98);
      }
    }
  `,
})
export class ToastHost {
  protected readonly toast = inject(Toast);
}
