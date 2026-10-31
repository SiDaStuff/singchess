// Regression tests for the coach LLM request-shape contract (offline — no
// network request succeeds; we capture the request body each scenario builds).
//
// Bug this guards: the thinking-hybrid primary model (nemotron-3-ultra) renders
// its chain of thought as output tokens unless chat_template_kwargs.thinking is
// false. coach-overview's 700-token cap was exhausted by the reasoning, so the
// user saw "The user wants me to explain… Wait, there's a discrepancy…" instead
// of an answer. chatCompletion supports `reasoning: false` to suppress it.
const assert = require('node:assert/strict');
const path = require('node:path');

const fetchId = require.resolve('../server/api/_lib/fetch-compat');
const originalFetchCompat = require(fetchId).fetchCompat;
const bodies = [];
require(fetchId).fetchCompat = async (url, options) => {
  bodies.push({ url, options });
  const err = new Error('offline test');
  err.statusCode = 500;
  throw err;
};

function load() {
  delete require.cache[require.resolve('../server/api/_lib/llm-service')];
  return require('../server/api/_lib/llm-service');
}

async function capture(opts) {
  bodies.length = 0;
  const llm = load();
  try { await llm.chatCompletion(opts); } catch (_) { /* offline expected */ }
  assert.ok(bodies.length >= 1, 'a request body was built');
  return JSON.parse(bodies[0].options.body);
}

async function main() {
  process.env.NVIDIA_API_KEY = 'test-key';

  // Default model list: only live models (gpt-oss-120b returned HTTP 410 "end
  // of life" from Sept 2026, which made the old fallback dead weight).
  const list = load().nvidiaModelList();
  assert.ok(list.length >= 1, 'model list is not empty');
  assert.ok(list.includes('nvidia/nemotron-3-ultra-550b-a55b'), 'primary model stays configured');
  assert.ok(!list.includes('openai/gpt-oss-120b'), 'dead gpt-oss-120b fallback is removed');

  // reasoning:false → thinking switch present for nemotron models.
  const off = await capture({ messages: [], maxTokens: 700, temperature: 0.4, reasoning: false });
  assert.equal(off.chat_template_kwargs?.thinking, false, 'reasoning:false disables the thinking template');

  // Default (no reasoning opt) → no thinking switch (chat/tools unchanged).
  const neutral = await capture({ messages: [], maxTokens: 700, temperature: 0.4 });
  assert.equal(neutral.chat_template_kwargs, undefined, 'default request does not change the template');

  // reasoning:false on a non-nemotron model → switch withheld (those 400 on it).
  process.env.NVIDIA_MODELS = 'openai/gpt-oss-20b';
  const legacy = await capture({ messages: [], maxTokens: 700, reasoning: false });
  assert.equal(legacy.chat_template_kwargs, undefined, 'thinking switch withheld from models that reject it');
  assert.equal(legacy.model, 'openai/gpt-oss-20b');

  // NVIDIA_NO_THINKING=1 forces the switch regardless of model.
  process.env.NVIDIA_NO_THINKING = '1';
  const forced = await capture({ messages: [], maxTokens: 700, reasoning: false });
  assert.equal(forced.chat_template_kwargs?.thinking, false, 'NVIDIA_NO_THINKING=1 forces the switch');
  delete process.env.NVIDIA_NO_THINKING;

  // Back to the default list: streaming tool calls (coach chat) keep working
  // and keep thinking enabled.
  delete process.env.NVIDIA_MODELS;
  const toolsBody = await capture({
    messages: [], tools: [{ type: 'function', function: { name: 'x', parameters: {} } }],
    toolChoice: 'auto', stream: true, maxTokens: 700,
  });
  assert.equal(toolsBody.tools.length, 1, 'tool calls keep working');
  assert.equal(toolsBody.chat_template_kwargs, undefined, 'coach chat default keeps thinking enabled');
  assert.equal(toolsBody.stream_options.include_usage, true, 'usage accounting unchanged');

  require(fetchId).fetchCompat = originalFetchCompat;
  delete require.cache[require.resolve('../server/api/_lib/llm-service')];
  console.log('PASS coach LLM request-shape contract: thinking switch, dead-model removal, tool compatibility');
}

main().catch((err) => { console.error(err); process.exit(1); });
