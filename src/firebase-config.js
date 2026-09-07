// Single source of truth for the Firebase web-client config.
//
// This config was previously duplicated (and drifting) in src/app.js and
// src/boost.js. Import it wherever the client needs to initialize the Firebase
// compat SDK. Note: Firebase web API keys are public identifiers, not secrets —
// security is enforced by Firebase rules + server-side auth.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAVG8Awwd2FmVIvhzHTrZ19nhoUowZ1H3M',
  authDomain: 'singchess-sd.firebaseapp.com',
  databaseURL: 'https://singchess-sd-default-rtdb.firebaseio.com',
  projectId: 'singchess-sd',
  storageBucket: 'singchess-sd.firebasestorage.app',
  messagingSenderId: '784279280538',
  appId: '1:784279280538:web:88a78b114e8f997b0fb823',
  measurementId: 'G-TFW7HFWKYP',
};

// Install on window so legacy non-module scripts can read it too.
if (typeof window !== 'undefined') {
  window.FIREBASE_CONFIG = FIREBASE_CONFIG;
}
