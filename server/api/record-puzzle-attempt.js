// Record puzzle attempt and update rating in real-time database
const { requireUser } = require('./_lib/user-service');
let admin;
try {
  admin = require('firebase-admin');
} catch (err) {
  console.error('Firebase Admin SDK not available');
}

let db = null;

// Initialize Firebase Admin SDK if available and not already initialized
function initializeFirebase() {
    if (db) return db;
    if (!admin) return null;
    if (admin.apps?.length) {
      db = admin.database();
      return db;
    }
  
  try {
    const serviceAccount = process.env.SERVICE_ACCOUNT 
      ? JSON.parse(process.env.SERVICE_ACCOUNT)
      : null;
    
    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.REALTIME_DATABASE_URL,
      });
      db = admin.database();
    }
  } catch (err) {
    console.error('Failed to initialize Firebase:', err.message);
  }
  return db;
}

// Minimal REST helper for Realtime Database to avoid firebase-admin dependency at runtime
const https = require('https');
function restRequest(method, url, data) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const options = {
        method,
        hostname: parsed.hostname,
        path: parsed.pathname + (parsed.search || ''),
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const parsedBody = body ? JSON.parse(body) : null;
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsedBody);
            else reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', (err) => reject(err));
      if (data !== undefined) req.write(JSON.stringify(data));
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

async function restWrite(path, value) {
  const base = process.env.REALTIME_DATABASE_URL;
  const secret = process.env.REALTIME_DATABASE_SECRET;
  if (!base) throw new Error('REALTIME_DATABASE_URL not configured');
  const url = `${base.replace(/\/$/, '')}/${path}.json${secret ? `?auth=${encodeURIComponent(secret)}` : ''}`;
  return restRequest('PUT', url, value);
}

async function restRead(path) {
  const base = process.env.REALTIME_DATABASE_URL;
  const secret = process.env.REALTIME_DATABASE_SECRET;
  if (!base) throw new Error('REALTIME_DATABASE_URL not configured');
  const url = `${base.replace(/\/$/, '')}/${path}.json${secret ? `?auth=${encodeURIComponent(secret)}` : ''}`;
  return restRequest('GET', url);
}

async function restPatch(path, value) {
  const base = process.env.REALTIME_DATABASE_URL;
  const secret = process.env.REALTIME_DATABASE_SECRET;
  if (!base) throw new Error('REALTIME_DATABASE_URL not configured');
  const url = `${base.replace(/\/$/, '')}/${path}.json${secret ? `?auth=${encodeURIComponent(secret)}` : ''}`;
  return restRequest('PATCH', url, value);
}

/**
 * Calculate rating change based on puzzle rating and result
 */
function calculateRatingDelta(puzzleRating, userRating, won) {
  const expectedScore = 1 / (1 + Math.pow(10, (puzzleRating - userRating) / 400));
  const delta = Math.round(24 * ((won ? 1 : 0) - expectedScore));
  return delta;
}

exports.handler = async (event) => {
  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    // Initialize Firebase (admin) if available; otherwise we'll try REST fallback.
    const database = initializeFirebase();
    const useRest = !database && !!process.env.REALTIME_DATABASE_URL;
    if (!database && !useRest) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({ error: 'Database service unavailable' }),
      };
    }

    const authUser = await requireUser(event);
    const body = JSON.parse(event.body || '{}');
    const { userId, puzzleRating, won, puzzleId } = body;

    if (!userId || puzzleRating === undefined || won === undefined) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: userId, puzzleRating, won' }),
      };
    }
    if (userId !== authUser.uid) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Cannot update another user.' }),
      };
    }

    const safePuzzleId = puzzleId ? String(puzzleId).replace(/[.#$\[\]/]/g, '_') : '';
    let currentRating = 1500;
    let stats = { solved: 0, attempted: 0, streak: 0 };
    let alreadyAttempted = false;

    if (!useRest) {
      const profileRef = database.ref(`users/${userId}/profile`);
      const snap = await profileRef.once('value');
      const profile = snap.val() || {};
      alreadyAttempted = !!(safePuzzleId && (profile.attemptedPuzzleIds || {})[safePuzzleId]);
      currentRating = Math.max(100, Number(profile.puzzleRating) || 1500);
      stats = {
        solved: Math.max(0, Number(profile.puzzleStats?.solved) || 0),
        attempted: Math.max(0, Number(profile.puzzleStats?.attempted) || 0),
        streak: Math.max(0, Number(profile.puzzleStats?.streak) || 0),
      };
    } else {
      const profile = await restRead(`users/${encodeURIComponent(userId)}/profile`) || {};
      alreadyAttempted = !!(safePuzzleId && (profile.attemptedPuzzleIds || {})[safePuzzleId]);
      currentRating = Math.max(100, Number(profile.puzzleRating) || 1500);
      stats = {
        solved: Math.max(0, Number(profile.puzzleStats?.solved) || 0),
        attempted: Math.max(0, Number(profile.puzzleStats?.attempted) || 0),
        streak: Math.max(0, Number(profile.puzzleStats?.streak) || 0),
      };
    }

    if (alreadyAttempted) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          duplicate: true,
          delta: 0,
          ratingAfter: currentRating,
          stats,
        }),
      };
    }

    const delta = calculateRatingDelta(Number(puzzleRating), currentRating, Boolean(won));
    const newRating = Math.max(100, currentRating + delta);
    const nextStats = {
      attempted: stats.attempted + 1,
      solved: stats.solved + (won ? 1 : 0),
      streak: won ? stats.streak + 1 : 0,
    };
    const update = {
      puzzleRating: newRating,
      puzzleStats: nextStats,
      updatedAt: useRest ? Date.now() : admin.database.ServerValue.TIMESTAMP,
    };
    if (safePuzzleId) {
      update[`attemptedPuzzleIds/${safePuzzleId}`] = true;
      if (won) update[`solvedPuzzleIds/${safePuzzleId}`] = true;
    }

    if (!useRest) {
      const profileRef = database.ref(`users/${userId}/profile`);
      await profileRef.update(update);
    } else {
      await restPatch(`users/${encodeURIComponent(userId)}/profile`, update);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
	        success: true,
	        delta,
	        ratingAfter: newRating,
	        stats: nextStats,
	      }),
    };
  } catch (err) {
    console.error('Error recording puzzle attempt:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Server error' }),
    };
  }
};
