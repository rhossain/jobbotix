import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { appRoutes } from '../../app.routes';
import { demoDataProviders } from '../../app.config';
import { settingsTab } from './settings';

async function open(url: string) {
  TestBed.configureTestingModule({
    providers: [provideRouter(appRoutes), ...demoDataProviders],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  harness.detectChanges();
  return { harness, el: harness.routeNativeElement as HTMLElement };
}

describe('Settings tabs', () => {
  it('opens Account at /settings, with the four tabs', async () => {
    const { el } = await open('/settings');
    const tabs = [...el.querySelectorAll('[role=tab]')].filter((t) =>
      t.id.startsWith('settings-tab-'),
    );
    expect(tabs.map((t) => t.textContent?.trim())).toEqual([
      'Account',
      'AI',
      'LinkedIn',
      'Your data',
    ]);
    expect(el.querySelector('#st-name')).not.toBeNull();
    expect(el.querySelector('jb-ai-connections')).toBeNull();
    expect(
      el.querySelector('#settings-tab-account')?.getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('shows each section at its own address', async () => {
    const ai = await open('/settings/ai');
    expect(ai.el.querySelector('jb-ai-connections')).not.toBeNull();
    expect(ai.el.querySelector('#st-name')).toBeNull();
    TestBed.resetTestingModule();
    const li = await open('/settings/linkedin');
    expect(li.el.querySelector('#linkedin')).not.toBeNull();
    TestBed.resetTestingModule();
    const data = await open('/settings/data');
    expect(data.el.querySelector('jb-data-panel')).not.toBeNull();
    // the LinkedIn card is no longer repeated under Your data
    expect(data.el.querySelector('#linkedin')).toBeNull();
  });

  it('moves between tabs without rebuilding the page', async () => {
    const { harness, el } = await open('/settings');
    const before = harness.routeDebugElement?.componentInstance;
    (el.querySelector('#settings-tab-ai') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/settings/ai');
    expect(harness.routeDebugElement?.componentInstance).toBe(before);
    expect(el.querySelector('jb-ai-connections')).not.toBeNull();
  });

  it('reads an unknown section as Account', () => {
    expect(settingsTab('nope')).toBe('account');
    expect(settingsTab(null)).toBe('account');
    expect(settingsTab('data')).toBe('data');
  });
});
