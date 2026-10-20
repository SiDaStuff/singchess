import { signInWithPopup, browserPopupRedirectResolver } from 'firebase/auth';
export const signIn = (auth, provider) => signInWithPopup(auth, provider, browserPopupRedirectResolver);
