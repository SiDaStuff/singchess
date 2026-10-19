import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/analytics';
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.css';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import confetti from 'canvas-confetti';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/material-symbols-outlined/400.css';

// Stable compat interfaces for the retained service and game controllers.
Object.assign(window, { firebase, Swal, marked, DOMPurify, confetti });
