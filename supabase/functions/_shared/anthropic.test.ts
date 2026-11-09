import { deepStrictEqual as assertEquals } from 'node:assert';
import { messageParams, modelGeneration } from './anthropic.ts';

Deno.test('older models are sent as before', () => {
  assertEquals(messageParams('claude-sonnet-4-5', 400), { max_tokens: 400 });
  assertEquals(messageParams('claude-3-5-haiku-20241022', 400), {
    max_tokens: 400,
  });
});

Deno.test('Haiku 5.x thinks not at all, Sonnet 5.x not up front', () => {
  assertEquals(messageParams('claude-haiku-5-5', 400), {
    max_tokens: 400,
    thinking: { type: 'disabled' },
  });
  assertEquals(messageParams('claude-sonnet-5-5', 400), {
    max_tokens: 2400,
    thinking: { type: 'between_tools' },
  });
});

Deno.test('models that always think get low effort and room for it', () => {
  for (const m of ['claude-opus-5-5', 'claude-fable-5-1', 'claude-unknown-9']) {
    assertEquals(messageParams(m, 400), {
      max_tokens: 8400,
      output_config: { effort: 'low' },
    });
  }
});

Deno.test('generation is read from both id styles', () => {
  assertEquals(modelGeneration('claude-opus-5-5'), { line: 'opus', major: 5 });
  assertEquals(modelGeneration('claude-3-7-sonnet-latest'), {
    line: 'sonnet',
    major: 3,
  });
});
