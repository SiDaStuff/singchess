import { initializeApp, getApps, getApp } from 'firebase/app';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, confirmPasswordReset, signOut, updateProfile, GoogleAuthProvider } from 'firebase/auth';

// Restore existing Firebase sessions from the same persistence stores. Popup
// machinery is supplied only to the action that needs it, avoiding a hidden
// cross-origin auth iframe on every mobile visit.
let instance, facade;
function auth() {
  if (facade) return facade;
  instance = initializeAuth(getApp(), { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  const adapt = user => {
    if (user && !user.updateProfile) user.updateProfile = profile => updateProfile(user, profile);
    return user;
  };
  const credential = result => ({ ...result, user: adapt(result.user) });
  facade = {
    get currentUser() { return adapt(instance.currentUser); },
    setPersistence: () => Promise.resolve(), // LOCAL is selected at initialization.
    onAuthStateChanged: (next, error) => onAuthStateChanged(instance, user => next(adapt(user)), error),
    signInWithEmailAndPassword: (...args) => signInWithEmailAndPassword(instance, ...args).then(credential),
    createUserWithEmailAndPassword: (...args) => createUserWithEmailAndPassword(instance, ...args).then(credential),
    sendPasswordResetEmail: (...args) => sendPasswordResetEmail(instance, ...args),
    confirmPasswordReset: (...args) => confirmPasswordReset(instance, ...args),
    signOut: () => signOut(instance),
    signInWithPopup: async provider => {
      const { signIn } = await import('./firebase-popup.js');
      return credential(await signIn(instance, provider));
    },
  };
  return facade;
}
auth.Auth = { Persistence: { LOCAL: 'local' } };
auth.GoogleAuthProvider = GoogleAuthProvider;
window.firebase = { initializeApp, get apps() { return getApps(); }, auth };
