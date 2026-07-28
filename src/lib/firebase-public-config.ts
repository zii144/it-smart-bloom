/**
 * Firebase web app config for project `it-smart-bloom-tmp`.
 * Browser clients do not talk to Firestore/Storage directly (rules are closed);
 * the Next.js Admin SDK owns all writes. Kept here so the bucket / project IDs
 * stay in one place if a client SDK is needed later.
 */
export const firebasePublicConfig = {
  apiKey: "AIzaSyDaJcOT_M0XdmhE0JtphYVvPg1uECJtjmk",
  authDomain: "it-smart-bloom-tmp.firebaseapp.com",
  projectId: "it-smart-bloom-tmp",
  storageBucket: "it-smart-bloom-tmp.firebasestorage.app",
  messagingSenderId: "986639858291",
  appId: "1:986639858291:web:2817103a591ab5ea704806",
} as const;
