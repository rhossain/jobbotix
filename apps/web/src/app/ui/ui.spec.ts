import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Toast } from '../shared/toast';
import { Confirm } from './confirm';
import { Field, FieldControl } from './field';
import { MatchRing, ringBand } from './match-ring';
import { Tabs, type TabItem } from './tabs';

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps at most three toasts, newest last', () => {
    const t = TestBed.inject(Toast);
    for (const m of ['one', 'two', 'three', 'four']) t.show(m);
    expect(t.items().map((i) => i.message)).toEqual(['two', 'three', 'four']);
    expect(t.message()).toBe('four');
  });

  it('reads errors from the wording and dismisses after the timeout', () => {
    const t = TestBed.inject(Toast);
    t.show('Could not save the note');
    expect(t.items()[0].tone).toBe('error');
    vi.advanceTimersByTime(6000);
    expect(t.items()).toEqual([]);
  });

  it('runs the action and removes the toast', async () => {
    const t = TestBed.inject(Toast);
    const run = vi.fn();
    t.success('Moved', { action: { label: 'Undo', run } });
    await t.act(t.items()[0]);
    expect(run).toHaveBeenCalledOnce();
    expect(t.items()).toEqual([]);
  });

  it('pauses timers while hovered', () => {
    const t = TestBed.inject(Toast);
    t.show('Saved');
    t.pause();
    vi.advanceTimersByTime(10_000);
    expect(t.items().length).toBe(1);
    t.resume();
    vi.advanceTimersByTime(3500);
    expect(t.items().length).toBe(0);
  });
});

describe('Confirm', () => {
  it('resolves with the answer and clears the request', async () => {
    const c = TestBed.inject(Confirm);
    const answer = c.ask({ title: 'Delete?', action: 'Delete', danger: true });
    expect(c.pending()?.title).toBe('Delete?');
    c.settle(true);
    await expect(answer).resolves.toBe(true);
    expect(c.pending()).toBeNull();
  });

  it('cancels an earlier question when a new one arrives', async () => {
    const c = TestBed.inject(Confirm);
    const first = c.ask({ title: 'A', action: 'Go' });
    c.ask({ title: 'B', action: 'Go' });
    await expect(first).resolves.toBe(false);
  });
});

describe('MatchRing', () => {
  it('bands scores at 80 and 60', () => {
    expect(ringBand(92)).toBe('high');
    expect(ringBand(80)).toBe('high');
    expect(ringBand(79)).toBe('mid');
    expect(ringBand(60)).toBe('mid');
    expect(ringBand(59)).toBe('low');
  });

  it('names the score for screen readers and clamps it', async () => {
    const f = TestBed.createComponent(MatchRing);
    f.componentRef.setInput('score', 140);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('Match score 100 out of 100');
    expect(el.dataset['band']).toBe('high');
  });
});

@Component({
  imports: [Tabs],
  template: `<jb-tabs prefix="t" [tabs]="tabs" [(value)]="value" />`,
})
class TabsHost {
  tabs: TabItem[] = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
    { id: 'c', label: 'C' },
  ];
  value = signal('a');
}

describe('Tabs', () => {
  it('wires ids and moves with the arrow keys', async () => {
    const f = TestBed.createComponent(TabsHost);
    await f.whenStable();
    const root = f.nativeElement as HTMLElement;
    const tabs = root.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs[0].getAttribute('aria-controls')).toBe('t-panel-a');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].tabIndex).toBe(-1);

    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    await f.whenStable();
    expect(f.componentInstance.value()).toBe('c');

    tabs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    await f.whenStable();
    expect(f.componentInstance.value()).toBe('a');
  });
});

@Component({
  imports: [Field, FieldControl],
  template: `
    <jb-field label="Email" hint="Work address" [error]="error()">
      <input jbInput />
    </jb-field>
  `,
})
class FieldHost {
  error = signal<string | null>(null);
}

describe('Field', () => {
  it('labels the control and points it at the hint, then the error', async () => {
    const f = TestBed.createComponent(FieldHost);
    await f.whenStable();
    const root = f.nativeElement as HTMLElement;
    const input = root.querySelector('input') as HTMLInputElement;
    const label = root.querySelector('label') as HTMLLabelElement;
    expect(input.id).toBeTruthy();
    expect(label.htmlFor).toBe(input.id);
    expect(
      root.querySelector('#' + input.getAttribute('aria-describedby'))
        ?.textContent,
    ).toContain('Work address');

    f.componentInstance.error.set('Enter an email address');
    await f.whenStable();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(
      root.querySelector('#' + input.getAttribute('aria-describedby'))
        ?.textContent,
    ).toContain('Enter an email address');
  });
});
