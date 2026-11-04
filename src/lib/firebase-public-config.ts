/**
 * Firebase web app config for project `it-smart-bloom-tmp`.
 * The Next.js Admin SDK owns all writes. The seat-status display reads only
 * its minimal projection through a scoped Firebase Auth session; private
 * roster, session and Storage access remain closed to browser clients.
 */
export const firebasePublicConfig = {
  apiKey: "AIzaSyDaJcOT_M0XdmhE0JtphYVvPg1uECJtjmk",
  authDomain: "it-smart-bloom-tmp.firebaseapp.com",
  projectId: "it-smart-bloom-tmp",
  storageBucket: "it-smart-bloom-tmp.firebasestorage.app",
  messagingSenderId: "986639858291",
  appId: "1:986639858291:web:2817103a591ab5ea704806",
} as const;
