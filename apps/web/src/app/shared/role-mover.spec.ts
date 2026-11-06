import { TestBed } from '@angular/core/testing';
import type { RoleRow } from '@jobbotix/shared-types';
import { RolesRepo } from '../core/data/repos';
import { RoleMover } from './role-mover';
import { Toast } from './toast';

describe('RoleMover', () => {
  const role = { id: 'r1', company: 'Quill & Co', status: 'new' } as RoleRow;
  let setStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setStatus = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [{ provide: RolesRepo, useValue: { setStatus } }],
    });
  });

  it('moves the role and undoes back to where it was', async () => {
    const mover = TestBed.inject(RoleMover);
    const toast = TestBed.inject(Toast);
    expect(await mover.move(role, 'skipped')).toBe(true);
    expect(setStatus).toHaveBeenCalledWith('r1', 'skipped');
    const t = toast.items()[0];
    expect(t.message).toBe('Quill & Co moved to Skipped');
    await toast.act(t);
    expect(setStatus).toHaveBeenLastCalledWith('r1', 'new');
  });

  it('reports a failure and leaves no Undo', async () => {
    setStatus.mockRejectedValueOnce(new Error('offline'));
    const mover = TestBed.inject(RoleMover);
    const toast = TestBed.inject(Toast);
    expect(await mover.move(role, 'shortlist')).toBe(false);
    expect(toast.items()[0].tone).toBe('error');
    expect(toast.items()[0].action).toBeUndefined();
  });

  it('does nothing when the status is unchanged', async () => {
    const mover = TestBed.inject(RoleMover);
    await mover.move(role, 'new');
    expect(setStatus).not.toHaveBeenCalled();
  });
});
