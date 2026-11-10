import { TestBed } from '@angular/core/testing';
import {
  MemoryRolesRepo,
  MemorySettingsRepo,
} from '../../core/data/memory-repos';
import { connectionModels, connectionStatus } from './ai-connections';

const NOW = Date.parse('2026-11-10T12:00:00Z');

describe('connectionStatus', () => {
  it('says working, rate limited (with when it is back) or needs attention', () => {
    expect(connectionStatus({ status: 'ok', limitedUntil: null }, NOW)).toEqual(
      { tone: 'good', label: 'Working' },
    );
    expect(
      connectionStatus(
        { status: 'ok', limitedUntil: '2026-11-10T12:12:00Z' },
        NOW,
      ),
    ).toEqual({
      tone: 'warn',
      label: 'Rate limited, back in about 12 minutes',
    });
    // a limit that has passed no longer shows
    expect(
      connectionStatus(
        { status: 'ok', limitedUntil: '2026-11-10T11:00:00Z' },
        NOW,
      ).label,
    ).toBe('Working');
    // a rejected key outranks a rate limit
    expect(
      connectionStatus(
        { status: 'error', limitedUntil: '2026-11-10T12:12:00Z' },
        NOW,
      ),
    ).toEqual({ tone: 'bad', label: 'Needs attention' });
    expect(
      connectionStatus({ status: 'untested', limitedUntil: null }, NOW).label,
    ).toBe('Not tested yet');
  });
});

describe('connectionModels', () => {
  it("offers the provider's suggestions without the default marker", () => {
    const models = connectionModels({ provider: 'gemini', model: '' });
    expect(models[0]).toEqual({
      id: 'gemini-3.8-flash',
      label: 'Gemini 3.8 Flash',
    });
  });

  it('keeps a saved model that is not a suggestion, and uses the live Claude list', () => {
    expect(
      connectionModels({ provider: 'groq', model: 'qwen/qwen3-32b' }).pop(),
    ).toEqual({ id: 'qwen/qwen3-32b', label: 'qwen/qwen3-32b' });
    expect(
      connectionModels({ provider: 'anthropic', model: '' }, [
        { id: 'claude-sonnet-6', label: 'Sonnet 6 (default)' },
      ]),
    ).toEqual([{ id: 'claude-sonnet-6', label: 'Sonnet 6' }]);
  });
});

describe('demo connections', () => {
  const GROQ = 'gsk_' + 'a1B2'.repeat(10);
  const GEMINI = 'AIza' + 'Sy0-_'.repeat(7);

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [MemoryRolesRepo, MemorySettingsRepo],
    });
  });

  it('refuses a key of the wrong shape and Gemini without consent', async () => {
    const repo = TestBed.inject(MemorySettingsRepo);
    await expect(
      repo.saveConnection({ provider: 'groq', key: 'sk-ant-nope' }),
    ).rejects.toThrow(/does not look like a Groq API key/);
    await expect(
      repo.saveConnection({ provider: 'gemini', key: GEMINI }),
    ).rejects.toThrow(/data terms/);
    expect(repo.connections()).toEqual([]);
  });

  it('adds, reorders and removes connections, keeping only the last four of a key', async () => {
    const repo = TestBed.inject(MemorySettingsRepo);
    await repo.saveConnection({
      provider: 'gemini',
      key: GEMINI,
      consent: true,
    });
    await repo.saveConnection({ provider: 'groq', key: GROQ });
    expect(repo.connections().map((c) => [c.provider, c.position])).toEqual([
      ['gemini', 0],
      ['groq', 1],
    ]);
    expect(repo.connections()[1].keyHint).toBe(GROQ.slice(-4));
    expect(JSON.stringify(localStorage)).not.toContain(GROQ);

    const [gemini, groq] = repo.connections();
    await repo.reorderConnections([groq.id, gemini.id]);
    expect(repo.connections().map((c) => c.provider)).toEqual([
      'groq',
      'gemini',
    ]);

    await repo.setConnectionModel(gemini.id, 'gemini-3.5-flash-lite');
    expect(repo.connections()[1].model).toBe('gemini-3.5-flash-lite');

    await repo.removeConnection(groq.id);
    expect(repo.connections().map((c) => [c.provider, c.position])).toEqual([
      ['gemini', 0],
    ]);
  });

  it('saving the same provider again replaces its key, not the row', async () => {
    const repo = TestBed.inject(MemorySettingsRepo);
    await repo.saveConnection({ provider: 'groq', key: GROQ });
    await repo.saveConnection({
      provider: 'groq',
      key: GROQ.slice(0, -4) + 'ZZZZ',
    });
    expect(repo.connections()).toHaveLength(1);
    expect(repo.connections()[0].keyHint).toBe('ZZZZ');
  });
});
