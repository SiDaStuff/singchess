import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/analytics';

// Firebase is only needed for account actions and auth state. Keep its SDK out
// of the initial route's critical module graph.
Object.assign(window, { firebase });
