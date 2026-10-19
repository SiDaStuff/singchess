import { Chess } from 'chess.js';

export const TIME_CONTROLS = [
  { time: 1, increment: 0, group: 'Bullet', mode: 'unavailable' },
  { time: 2, increment: 1, group: 'Bullet', mode: 'unavailable' },
  ...[[3, 0], [3, 2], [5, 0], [5, 3]].map(([time, increment]) => ({ time, increment, group: 'Blitz', mode: 'challenge' })),
  ...[[10, 0], [10, 5], [15, 10]].map(([time, increment]) => ({ time, increment, group: 'Rapid', mode: 'seek' })),
  ...[[30, 0], [30, 20]].map(([time, increment]) => ({ time, increment, group: 'Classical', mode: 'seek' })),
];
export const isFinished = status => Boolean(status && !['created', 'started'].includes(status));
export const gameId = game => game?.gameId || game?.id;
export function playUci(chess, uci) {
  let from = uci.slice(0, 2), to = uci.slice(2, 4);
  // Lichess can encode standard castling as the king capturing its own rook.
  if (chess.get(from)?.type === 'k' && chess.get(to)?.type === 'r' && chess.get(from)?.color === chess.get(to)?.color) {
    to = `${to[0] > from[0] ? 'g' : 'c'}${from[1]}`;
  }
  return chess.move({ from, to, ...(uci[4] ? { promotion: uci[4] } : {}) });
}
export function reconstructGame(full, state = full?.state) {
  const chess = full?.initialFen && full.initialFen !== 'startpos' ? new Chess(full.initialFen) : new Chess();
  const tokens = (state?.moves || '').trim().split(/\s+/).filter(Boolean);
  const moves = [];
  for (const uci of tokens) {
    const move = playUci(chess, uci);
    if (!move) throw new Error('The game position could not be synchronized. Reconnecting…');
    moves.push({ ...move, uci: move.from + move.to + (move.promotion || '') });
  }
  return { chess, moves, ply: tokens.length, lastMove: moves.at(-1)?.uci || null };
}
export function resultFor(full, state, color) {
  const draw = !state.winner && !['aborted', 'noStart'].includes(state.status);
  const outcome = ['aborted', 'noStart'].includes(state.status) ? 'Game ended' : draw ? 'Draw' : state.winner === color ? 'Victory' : 'Defeat';
  const reasons = { mate: 'Checkmate', resign: 'Resignation', stalemate: 'Stalemate', timeout: 'Time expired', outoftime: 'Time expired', draw: 'Draw agreed', aborted: 'Game aborted', noStart: 'Game did not start', cheat: 'Game ended by Lichess', variantEnd: 'Game finished', unknownFinish: 'Game finished' };
  return { outcome, reason: reasons[state.status] || 'Game finished', result: state.winner === 'white' ? '1-0' : state.winner === 'black' ? '0-1' : draw ? '1/2-1/2' : '*' };
}
export function completedPgn(full, state) {
  if (!isFinished(state?.status)) throw new Error('Review is available after the game ends.');
  const { chess } = reconstructGame(full, state);
  const result = resultFor(full, state, 'white').result;
  chess.header('Event', full.rated ? 'Rated game' : 'Casual game', 'Site', `https://lichess.org/${full.id}`, 'White', full.white?.name || full.white?.id || 'White', 'Black', full.black?.name || full.black?.id || 'Black', 'Result', result);
  chess.header('Termination', state.status);
  if (full.clock) chess.header('TimeControl', `${Math.round(full.clock.initial / 1000)}+${Math.round(full.clock.increment / 1000)}`);
  if (full.white?.rating) chess.header('WhiteElo', String(full.white.rating));
  if (full.black?.rating) chess.header('BlackElo', String(full.black.rating));
  const pgn = chess.pgn();
  return chess.history().length ? pgn : pgn.replace(/\r?\n(?=(?:1-0|0-1|1\/2-1\/2|\*)\s*$)/, '\n\n');
}
export async function consumeNdjson(response, onEvent, signal) {
  if (!response.body) throw new Error('Live streaming is unavailable in this browser.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (line) await onEvent(JSON.parse(line));
      }
      if (buffer.length > 1048576) throw new Error('The live stream exceeded its message limit.');
      if (done) { if (buffer.trim()) await onEvent(JSON.parse(buffer)); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function consumeSse(response, onEvent, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    if (signal?.aborted) { await reader.cancel(); return; }
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n');
    if (buffer.length > 1048576) throw new Error('The live game response exceeded its safe size.');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data) await onEvent(JSON.parse(data));
    }
    if (done) break;
  }
}
