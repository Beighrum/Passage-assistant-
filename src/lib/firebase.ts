import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

/** Client Firebase config from env (Vercel + local .env). Do not commit secrets; set in Vercel Project → Environment Variables. */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || undefined,
};

/**
 * Firestore database ID. `firebase-applet-config.json` is gitignored locally — do not import it in the bundle
 * (Vercel builds would fail). Set `VITE_FIREBASE_FIRESTORE_DATABASE_ID` in Vercel, or rely on the default below.
 * Use "(default)" in env to target the default database instead of this named DB.
 */
const NAMED_FIRESTORE_DATABASE_ID = 'ai-studio-70149557-1599-445b-9e40-91b543c828af';
const envDbId = import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID?.trim().replace(/^["']|["']$/g, '') || '';
const firestoreDatabaseId =
  envDbId === '(default)' ? '' : envDbId || NAMED_FIRESTORE_DATABASE_ID;

export const isFirebaseConfigured = !!(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId
);

if (!isFirebaseConfigured) {
  console.warn(
    '[Firebase] Missing VITE_FIREBASE_* variables. Add them to .env locally or in Vercel → Settings → Environment Variables.'
  );
}

const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;

export const auth = app ? getAuth(app) : null;
export const db = app
  ? firestoreDatabaseId
    ? getFirestore(app, firestoreDatabaseId)
    : getFirestore(app)
  : null;

export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/drive.readonly');
googleProvider.addScope('https://www.googleapis.com/auth/userinfo.email');
googleProvider.addScope('https://www.googleapis.com/auth/userinfo.profile');

export const signInWithGoogle = () => {
  if (!auth) throw new Error('Firebase is not configured');
  return signInWithPopup(auth, googleProvider);
};

export const signInWithGoogleRedirect = () => {
  if (!auth) throw new Error('Firebase is not configured');
  return signInWithRedirect(auth, googleProvider);
};

export const signInWithDrive = async () => {
  if (!auth) throw new Error('Firebase is not configured');
  console.log('[Firebase] Initiating signInWithPopup for Drive...');
  const result = await signInWithPopup(auth, googleProvider);
  console.log('[Firebase] signInWithPopup result received.');
  const credential = GoogleAuthProvider.credentialFromResult(result);
  return {
    user: result.user,
    accessToken: credential?.accessToken,
  };
};

export const signInWithDriveRedirect = () => {
  if (!auth) throw new Error('Firebase is not configured');
  console.log('[Firebase] Initiating signInWithRedirect for Drive...');
  return signInWithRedirect(auth, googleProvider);
};

export const getRedirectAuthResult = async () => {
  if (!auth) return null;
  const result = await getRedirectResult(auth).catch(() => null);
  if (!result) return null;
  const credential = GoogleAuthProvider.credentialFromResult(result);
  return {
    user: result.user,
    accessToken: credential?.accessToken,
  };
};
