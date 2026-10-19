// Daily Coach allowance counts generated output (including reasoning), not
// repeated prompts/history. Provider input usage remains separate accounting.
function completionCost(result, estimatedReasoning = '') {
  const u = result?.usage;
  const count = Number(u?.completion_tokens ?? u?.completion);
  const reasoning = Number(u?.completion_tokens_details?.reasoning_tokens) || 0;
  if (Number.isFinite(count) && count >= 0) return Math.max(count, reasoning);
  return Math.ceil((String(result?.content || '').length + estimatedReasoning.length +
    (result?.toolCalls?.length ? JSON.stringify(result.toolCalls).length : 0)) / 4);
}
function compactHistory(history, currentText) {
  const prior = history.slice(-12);
  if (prior.at(-1)?.role === 'user' && prior.at(-1).content === currentText) prior.pop();
  const selected = [];
  let characters = 0;
  for (const turn of prior.reverse()) {
    const content = String(turn.content || '').slice(0, turn.role === 'assistant' ? 2000 : 4000);
    if (characters + content.length > 10000) break;
    characters += content.length;
    selected.unshift({ role: turn.role, content });
  }
  return [...selected, { role: 'user', content: currentText }];
}
function publicCoachUsage(total, limit, day) {
  return { coachUsagePercent: limit > 0 ? Math.max(0, Math.min(100, Math.floor(total / limit * 100))) : 0,
    coachAvailable: limit > 0 && total < limit, ...(day ? { day } : {}) };
}
module.exports = { completionCost, compactHistory, publicCoachUsage };
