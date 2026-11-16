import { TestBed } from '@angular/core/testing';
import { ExportMenu } from './export-menu';

function setup() {
  const fixture = TestBed.createComponent(ExportMenu);
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const trigger = el.querySelector('button') as HTMLButtonElement;
  const items = () =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  return { fixture, el, trigger, items };
}

describe('ExportMenu', () => {
  it('is one Export button until it is pressed', () => {
    const { trigger, items } = setup();
    expect(trigger.textContent).toContain('Export');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(items().length).toBe(0);
  });

  it('opens to PDF and Word, and says which was chosen', () => {
    const { fixture, trigger, items } = setup();
    const picked: string[] = [];
    fixture.componentInstance.pdf.subscribe(() => picked.push('pdf'));
    fixture.componentInstance.word.subscribe(() => picked.push('word'));

    trigger.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(
      items().map((i) => i.querySelector('span')?.textContent?.trim()),
    ).toEqual(['PDF', 'Word (.docx)']);

    items()[1].click();
    fixture.detectChanges();
    expect(picked).toEqual(['word']);
    expect(items().length).toBe(0);

    trigger.click();
    fixture.detectChanges();
    items()[0].click();
    expect(picked).toEqual(['word', 'pdf']);
  });

  it('closes on Escape and on a click elsewhere', () => {
    const { fixture, el, trigger, items } = setup();
    trigger.click();
    fixture.detectChanges();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(items().length).toBe(0);

    trigger.click();
    fixture.detectChanges();
    expect(items().length).toBe(2);
    document.body.click();
    fixture.detectChanges();
    expect(items().length).toBe(0);
  });

  it('cannot be opened while a file is being made', () => {
    const { fixture, trigger } = setup();
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    expect(trigger.disabled).toBe(true);
  });
});
