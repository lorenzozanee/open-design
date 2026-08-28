import { test } from 'vitest';
import assert from 'node:assert/strict';
import { kimi } from './helpers/test-helpers.js';
import { createJsonEventStreamHandler } from '../../src/runtimes/json-event-stream.js';

// Regression for #4749: Kimi CLI requires --print when --output-format stream-json is used since v1.40.0
// PR #4191 missed --print; PR #4637 fixed it but was auto-closed. This test ensures --print is present.
test('kimi args include --print when --output-format stream-json is used', () => {
  const prompt = 'design a page';
  const args = kimi.buildArgs(prompt, [], [], {});

  assert.ok(args.includes('--print'), '--print must be present for stream-json');
  assert.ok(args.includes('--output-format'), '--output-format must be present');
  assert.ok(args.includes('stream-json'), 'stream-json value must be present');
  assert.deepEqual(args.slice(0, 3), ['--print', '-p', prompt]);
  assert.equal(kimi.streamFormat, 'json-event-stream');
  assert.equal(kimi.eventParser, 'kimi');
  assert.equal(kimi.maxPromptArgBytes, 30000);
  assert.equal(args.includes('acp'), false);
});

test('kimi args pass explicit model selections through prompt mode with --print', () => {
  const args = kimi.buildArgs('hello', [], [], { model: 'moonshot-v1-32k' });
  assert.deepEqual(args, [
    '--print',
    '-p',
    'hello',
    '--output-format',
    'stream-json',
    '--model',
    'moonshot-v1-32k',
  ]);
});

// Second bug from #4637: kimi's stream-json emits content as array of typed blocks
// handleKimiEvent previously only handled string content, so array text was dropped.
test('kimi stream extracts text from array content blocks (stream-json format)', () => {
  const events: Record<string, unknown>[] = [];
  const handler = createJsonEventStreamHandler('kimi', (e) => events.push(e));

  handler.feed(
    JSON.stringify({
      role: 'assistant',
      content: [
        { type: 'think', think: 'The user wants a greeting.', encrypted: null },
        { type: 'text', text: 'Hello!' },
      ],
    }) + '\n',
  );

  assert.deepEqual(events, [{ type: 'text_delta', delta: 'Hello!' }]);
});

test('kimi stream concatenates multiple text blocks from array content', () => {
  const events: Record<string, unknown>[] = [];
  const handler = createJsonEventStreamHandler('kimi', (e) => events.push(e));

  handler.feed(
    JSON.stringify({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world' },
        { type: 'think', think: 'internal' },
        { type: 'text', text: '!' },
      ],
    }) + '\n',
  );

  assert.deepEqual(events, [{ type: 'text_delta', delta: 'Hello world!' }]);
});

test('kimi stream silently drops think-only array content without emitting text_delta', () => {
  const events: Record<string, unknown>[] = [];
  const handler = createJsonEventStreamHandler('kimi', (e) => events.push(e));

  handler.feed(
    JSON.stringify({
      role: 'assistant',
      content: [{ type: 'think', think: 'Thinking...', encrypted: null }],
    }) + '\n',
  );

  assert.deepEqual(events, []);
});

test('kimi stream still handles string content (backward compat)', () => {
  const events: Record<string, unknown>[] = [];
  const handler = createJsonEventStreamHandler('kimi', (e) => events.push(e));

  handler.feed(JSON.stringify({ role: 'assistant', content: 'Done.' }) + '\n');

  assert.deepEqual(events, [{ type: 'text_delta', delta: 'Done.' }]);
});

test('kimi stream handles string content with tool_calls present (tool call takes precedence)', () => {
  // When tool_calls is present, handleKimiEvent should treat it as tool_use, not text
  const events: Record<string, unknown>[] = [];
  const handler = createJsonEventStreamHandler('kimi', (e) => events.push(e));

  handler.feed(
    JSON.stringify({
      role: 'assistant',
      tool_calls: [
        {
          type: 'function',
          id: 'tool-1',
          function: { name: 'Write', arguments: '{"path":"index.html"}' },
        },
      ],
      content: 'should be ignored as tool call',
    }) + '\n',
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'tool_use');
});
