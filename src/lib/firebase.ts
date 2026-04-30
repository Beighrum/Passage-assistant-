import { initializeApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  reauthenticateWithRedirect,
  type User,
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

function createAuth() {
  if (!app) return null;
  try {
    return initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === 'auth/already-initialized') {
      return getAuth(app);
    }
    console.warn('[Firebase] initializeAuth failed; using getAuth', e);
    return getAuth(app);
  }
}

export const auth = createAuth();
export const db = app
  ? firestoreDatabaseId
    ? getFirestore(app, firestoreDatabaseId)
    : getFirestore(app)
  : null;

/**
 * Step 1 — Firebase session only (profile + email). Avoids Drive scopes on mobile redirect,
 * which Safari/WebKit often mishandles in a single combined OAuth hop.
 */
export const googleSignInProvider = new GoogleAuthProvider();
googleSignInProvider.addScope('profile');
googleSignInProvider.addScope('email');

/**
 * Step 2 / desktop — Drive + profile. Used after sign-in exists, via redirect re-auth on mobile.
 */
export const googleDriveProvider = new GoogleAuthProvider();
googleDriveProvider.addScope('https://www.googleapis.com/auth/drive.readonly');
googleDriveProvider.addScope('https://www.googleapis.com/auth/userinfo.email');
googleDriveProvider.addScope('https://www.googleapis.com/auth/userinfo.profile');

export const signInWithGoogle = () => {
  if (!auth) throw new Error('Firebase is not configured');
  return signInWithPopup(auth, googleSignInProvider);
};

export const signInWithGoogleRedirect = () => {
  if (!auth) throw new Error('Firebase is not configured');
  return signInWithRedirect(auth, googleSignInProvider);
};

export const signInWithDrive = async () => {
  if (!auth) throw new Error('Firebase is not configured');
  console.log('[Firebase] Initiating signInWithPopup for Drive...');
  const result = await signInWithPopup(auth, googleDriveProvider);
  console.log('[Firebase] signInWithPopup result received.');
  const credential = GoogleAuthProvider.credentialFromResult(result);
  return {
    user: result.user,
    accessToken: credential?.accessToken,
  };
};

/** Rare: opening full Drive-scope redirect without an existing Firebase user (prefer sign-in first on mobile). */
export const signInWithDriveRedirect = () => {
  if (!auth) throw new Error('Firebase is not configured');
  console.log('[Firebase] Initiating signInWithRedirect for Drive...');
  return signInWithRedirect(auth, googleDriveProvider);
};

/** Mobile step 2 — user already signed into Firebase; obtain Drive OAuth credential via redirect. */
export const reauthenticateDriveRedirect = (user: User) => {
  if (!auth) throw new Error('Firebase is not configured');
  console.log('[Firebase] Initiating reauthenticateWithRedirect for Drive...');
  return reauthenticateWithRedirect(user, googleDriveProvider);
};

export type RedirectAuthPayload = {
  user: User;
  accessToken: string | undefined;
};

/**
 * `getRedirectResult` must run at most once per full page load; React StrictMode and
 * re-renders must share the same in-flight promise.
 */
let redirectResultOnce: Promise<RedirectAuthPayload | null> | null = null;

export const getRedirectAuthResult = (): Promise<RedirectAuthPayload | null> => {
  if (!auth) return Promise.resolve(null);
  if (!redirectResultOnce) {
    redirectResultOnce = (async (): Promise<RedirectAuthPayload | null> => {
      let redirectCredUser: User | null = null;
      let accessToken: string | undefined;

      try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
          redirectCredUser = result.user;
          const credential = GoogleAuthProvider.credentialFromResult(result);
          accessToken = credential?.accessToken ?? undefined;
          if (!accessToken) {
            const tr = (result as { _tokenResponse?: { oauthAccessToken?: string } })?._tokenResponse;
            if (tr?.oauthAccessToken) accessToken = tr.oauthAccessToken;
          }
        }
      } catch (e) {
        console.error('[Firebase] getRedirectResult failed', e);
      }

      try {
        await auth.authStateReady();
      } catch (e) {
        console.warn('[Firebase] authStateReady', e);
      }

      const sessionUser = auth.currentUser;
      const user = redirectCredUser ?? sessionUser ?? null;
      if (!user) return null;

      return { user, accessToken };
    })();
  }
  return redirectResultOnce;
};
