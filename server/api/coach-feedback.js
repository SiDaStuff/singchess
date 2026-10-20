const { randomUUID } = require('node:crypto');
const { Chess } = require('chess.js');
const { requireUser, initAdmin } = require('./_lib/user-service');

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function evaluate(content, context) {
  const text = String(content || '');
  const concrete = /(?:[+#-]?\d+(?:\.\d+)?|\b(?:best|winning|losing|blunder|mistake|forced|mate)\b|\b[KQRBN]?[a-h][1-8](?:=[QRBN])?[+#]?\b)/i.test(text);
  const cited = /(?:Stockfish|Lichess|Chess\.com|https?:\/\/)/i.test(text);
  const fenBlocks = [...text.matchAll(/```board\s+([^`]+)```/gi)].map((match) => match[1].trim());
  const badFen = fenBlocks.some((fen) => fen.split(/\s+/)[0].split('/').length !== 8);
  const repeatedParagraph = text.split(/\n\s*\n/).map((part) => part.trim().toLowerCase()).filter((part) => part.length > 40)
    .some((part, index, parts) => parts.indexOf(part) !== index);
  let illegalVariation = false;
  const variations = text.match(/(?:\d+\.(?:\.\.)?\s*)[KQRBNOa-h0-9x=+#\-\s.]{5,}/g) || [];
  for (const variation of variations.slice(0, 12)) {
    let chess;
    try { chess = context?.fen ? new Chess(context.fen) : new Chess(); } catch { chess = new Chess(); }
    const moves = variation.replace(/\d+\.(?:\.\.)?/g, ' ').trim().split(/\s+/).filter(Boolean);
    for (const move of moves) {
      try { if (!chess.move(move, { sloppy: true })) { illegalVariation = true; break; } } catch { illegalVariation = true; break; }
    }
    if (illegalVariation) break;
  }
  return {
    unsupportedConcreteClaim: concrete && !cited,
    invalidBoardFen: badFen,
    repeatedAnswer: repeatedParagraph,
    illegalVariation,
    empty: !text.trim(),
    passed: !!text.trim() && !(concrete && !cited) && !badFen && !repeatedParagraph && !illegalVariation,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST.' });
  try {
    const user = await requireUser(event);
    let body = {}; try { body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {}); } catch {}
    const content = String(body.content || '').slice(0, 12000);
    const rating = ['up', 'down'].includes(body.rating) ? body.rating : '';
    if (!rating) return json(400, { error: 'A feedback rating is required.' });
    const record = { rating, chatId: String(body.chatId || '').slice(0, 80), messageTs: Number(body.messageTs) || 0,
      reason: String(body.reason || '').slice(0, 300), quality: evaluate(content, body.context), createdAt: Date.now() };
    const { db } = initAdmin();
    await db.ref(`coachFeedback/${user.uid}/${randomUUID()}`).set(record);
    return json(200, { saved: true, quality: record.quality });
  } catch (err) {
    return json(err.statusCode || 500, { error: err.message || 'Could not save feedback.', code: err.code });
  }
};
