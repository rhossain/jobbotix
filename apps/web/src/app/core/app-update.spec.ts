import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { Toast } from '../shared/toast';
import { AppUpdate } from './app-update';

function setup() {
  const versionUpdates = new Subject<unknown>();
  const activateUpdate = vi.fn().mockResolvedValue(true);
  const reload = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: SwUpdate,
        useValue: { isEnabled: true, versionUpdates, activateUpdate },
      },
      {
        provide: DOCUMENT,
        useValue: { defaultView: { location: { reload } } },
      },
    ],
  });
  const toast = TestBed.inject(Toast);
  TestBed.inject(AppUpdate).start();
  const ready = (hash: string) =>
    versionUpdates.next({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old' },
      latestVersion: { hash },
    });
  return { versionUpdates, activateUpdate, reload, toast, ready };
}

describe('AppUpdate', () => {
  it('says nothing until a new build has been downloaded', () => {
    const { versionUpdates, toast } = setup();
    versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash: 'a' } });
    versionUpdates.next({ type: 'NO_NEW_VERSION_DETECTED' });
    expect(toast.items().length).toBe(0);
  });

  it('shows one notice per release, however often it is reported', () => {
    const { toast, ready } = setup();
    ready('a');
    ready('a');
    expect(toast.items().length).toBe(1);
  });

  it('replaces the notice when another release arrives', () => {
    const { toast, ready } = setup();
    ready('a');
    const first = toast.items()[0].id;
    ready('b');
    expect(toast.items().length).toBe(1);
    expect(toast.items()[0].id).not.toBe(first);
  });

  it('switches to the new build, then loads the page again', async () => {
    const { toast, ready, activateUpdate, reload } = setup();
    ready('a');
    await toast.act(toast.items()[0]);
    expect(activateUpdate).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(toast.items().length).toBe(0);
  });
});
