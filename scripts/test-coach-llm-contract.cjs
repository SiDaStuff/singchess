// Regression tests for the coach LLM request-shape contract (offline — no
// network request succeeds; we capture the request body each scenario builds).
//
// Bug this guards: the thinking-hybrid primary model (qwen3.6-35b) renders its
// chain of thought as output tokens unless the disable flag is set. coach-overview's
// 700-token cap was exhausted by the reasoning, so the user saw "The user wants me
// to explain… Wait, there's a discrepancy…" instead of an answer. chatCompletion
// supports `reasoning: false` to suppress it — which vllm-hosted Qwen3 honors via
// chat_template_kwargs.enable_thinking=false (Nemotron used thinking=false).
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
  process.env.LLM_API_KEY = 'test-key';
  delete process.env.LLM_MODELS;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_MODELS;

  // Default model list: qwen3.6-35b is the primary provider model.
  const list = load().modelList();
  assert.ok(list.length >= 1, 'model list is not empty');
  assert.ok(list.includes('qwen3.6-35b'), 'primary model stays configured');

  // Default base URL is freeinference.org/v1
  const llm = load();
  const off = await capture({ messages: [], maxTokens: 700, temperature: 0.4, reasoning: false });
  assert.ok(off, 'a body was captured');

  // reasoning:false on a qwen model → enable_thinking=false, not thinking=false.
  assert.equal(off.model, 'qwen3.6-35b', 'default model is qwen3.6-35b');
  assert.equal(off.chat_template_kwargs?.enable_thinking, false, 'qwen reasoning:false disables enable_thinking');
  assert.equal(off.chat_template_kwargs?.thinking, undefined, 'qwen does not use the nemotron thinking flag');

  // Default (no reasoning opt) → no switch on a qwen model (chat/tools unchanged).
  const neutral = await capture({ messages: [], maxTokens: 700, temperature: 0.4 });
  assert.equal(neutral.chat_template_kwargs, undefined, 'default request does not change the template');

  // Back to the default list: streaming tool calls (coach chat) keep working
  // and keep thinking enabled.
  const toolsBody = await capture({
    messages: [], tools: [{ type: 'function', function: { name: 'x', parameters: {} } }],
    toolChoice: 'auto', stream: true, maxTokens: 700,
  });
  assert.equal(toolsBody.tools.length, 1, 'tool calls keep working');
  assert.equal(toolsBody.chat_template_kwargs, undefined, 'coach chat default keeps thinking enabled');
  assert.equal(toolsBody.stream_options.include_usage, true, 'usage accounting unchanged');

  // Legacy NVIDIA env is honored as a fallback alias.
  delete process.env.LLM_API_KEY;
  process.env.NVIDIA_API_KEY = 'nv-fallback';
  process.env.NVIDIA_MODELS = 'nvidia/nemotron-3-ultra-550b-a55b';
  const legacy = await capture({ messages: [], maxTokens: 700, reasoning: false });
  assert.equal(legacy.model, 'nvidia/nemotron-3-ultra-550b-a55b', 'NVIDIA_MODELS fallback alias works');
  assert.equal(legacy.chat_template_kwargs?.thinking, false, 'nemotron uses the thinking flag');
  assert.equal(legacy.chat_template_kwargs?.enable_thinking, undefined, 'nemotron does not use enable_thinking');

  require(fetchId).fetchCompat = originalFetchCompat;
  delete require.cache[require.resolve('../server/api/_lib/llm-service')];
  console.log('PASS coach LLM request-shape contract: qwen thinking switch, freeinference base, NVIDIA alias fallback');
}

main().catch((err) => { console.error(err); process.exit(1); });