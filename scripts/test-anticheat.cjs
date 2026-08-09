const path = require('path');

async function run() {
  const funcPath = path.resolve(__dirname, '../server/api/anticheat.js');
  const fn = require(funcPath);

  const makeEvent = (body) => ({ httpMethod: 'POST', body: JSON.stringify(body) });

  console.log('Running anticheat list mode (should not invoke engine)...');
  try {
    const res = await fn.handler(makeEvent({ mode: 'list', source: 'pgn', pgn: '1. e4 e5 2. Nf3 Nc6' }), {});
    console.log('LIST result:', res);
  } catch (err) {
    console.error('LIST error:', err);
  }

  console.log('\nRunning anticheat engine mode (may require stockfish and can be slow)...');
  try {
    const res2 = await fn.handler(makeEvent({ mode: 'engine', source: 'pgn', pgn: '1. e4 e5 2. Nf3 Nc6' }), {});
    console.log('ENGINE result:', res2 && res2.statusCode ? JSON.parse(res2.body) : res2);
  } catch (err) {
    console.error('ENGINE error:', err);
  }
}

run().catch((err) => {
  console.error('Test runner failed:', err);
  process.exitCode = 1;
});
