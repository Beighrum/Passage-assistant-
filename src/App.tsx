import { useState, useRef, useEffect, useCallback, FormEvent, ChangeEvent } from 'react';
import type { FC } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Sparkles, User, Bot, Loader2, Command, Image as ImageIcon, Lock, Globe, LogIn, FileText, X, Volume2, Mic, MicOff, History, Plus, Trash2, SlidersHorizontal, Home } from 'lucide-react';
import { generateResponseStream, generateImage, MessagePart } from './lib/gemini';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  auth,
  db,
  getRedirectAuthResult,
  isFirebaseConfigured,
  shouldUseFirebaseAuthRedirectSync,
  signInWithDrive,
  signInWithGoogle,
  signInWithGoogleRedirect,
  reauthenticateDriveRedirect,
} from './lib/firebase';
import { onAuthStateChanged, signOut, User as FirebaseUser } from 'firebase/auth';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, setDoc, getDocs, limit, deleteDoc, writeBatch } from 'firebase/firestore';

interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: any;
  image?: string;
}

interface ChatSession {
  id: string;
  title: string;
  mode: 'public' | 'internal';
  createdAt: any;
}

/** After internal login, stay on Internal across refresh (Firebase + optional Drive cookie). */
const PASSAGE_PREFER_INTERNAL = 'passage_prefer_internal';

const UPCOMING_SHOWS = [
  { 
    id: 'gala-2026', 
    name: '2026 Gala: "Freedom Has No Rehearsal"', 
    description: 'Saturday April 25th, 2026 at the Trenton War Memorial. Celebrating Season 41: "Not Afraid".',
    thumbnailLink: 'https://res.cloudinary.com/onthestage/image/upload/v1772576647/orgpageimage/aod5l3awtwvimqtengbv.jpg',
    link: 'https://www.onthestage.tickets/show/passage-theatre-company/6994b61ef680c05543ae0156',
    mimeType: 'image/jpeg'
  },
  { 
    id: 'word-on-front', 
    name: 'A Word on Front 250', 
    description: 'Solo Playwriting Contest. Your uniquely Trenton American Story. Submissions Open!',
    thumbnailLink: 'https://static.wixstatic.com/media/f5611b_3485f63bd1404ea0aafcfbf96c180a94~mv2.jpg/v1/fill/w_1444,h_936,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/f5611b_3485f63bd1404ea0aafcfbf96c180a94~mv2.jpg',
    link: 'https://www.passagetheatre.org/wordonfront',
    mimeType: 'image/jpeg'
  },
  { 
    id: 'muleheaded', 
    name: 'Muleheaded', 
    description: 'A powerful new production exploring resilience and determination. Part of our Season 41 lineup.',
    thumbnailLink: 'https://static.wixstatic.com/media/f5611b_6751971f47bc41ae894e33a08cff2f55~mv2.png/v1/fill/w_810,h_1012,al_c,q_90,usm_0.66_1.00_0.01,enc_avif,quality_auto/Muleheaded.png',
    link: 'https://www.passagetheatre.org',
    mimeType: 'image/png'
  },
  { 
    id: 'dutchman', 
    name: 'The Dutchman', 
    description: 'Amiri Baraka\'s classic play. A tense, symbolic encounter on a New York subway.',
    thumbnailLink: 'https://static.wixstatic.com/media/f5611b_0f67008f4c6c4253a5b95a1d33cc51a6~mv2.png/v1/fill/w_810,h_1012,al_c,q_90,usm_0.66_1.00_0.01,enc_avif,quality_auto/Dutchman.png',
    link: 'https://www.passagetheatre.org',
    mimeType: 'image/png'
  }
];

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'public' | 'internal'>('public');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isEventsPinnedOpen, setIsEventsPinnedOpen] = useState(false);
  
  const [isEventsOpen, setIsEventsOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<{ file: File, preview: string } | null>(null);
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [publicFiles, setPublicFiles] = useState<any[]>([]);
  const [selectedDriveFile, setSelectedDriveFile] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const composerFormRef = useRef<HTMLFormElement | null>(null);

  const [isListening, setIsListening] = useState(false);
  /** Which message is using TTS, and whether we're waiting on the server vs actually playing audio. */
  const [ttsTargetId, setTtsTargetId] = useState<string | null>(null);
  const [ttsPhase, setTtsPhase] = useState<'idle' | 'loading' | 'playing'>('idle');
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const [imageSize, setImageSize] = useState<"1K" | "2K" | "4K">("1K");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  /** Footer collapses on composer focus (all breakpoints); stays hidden while chat has messages. */
  const [composerFocused, setComposerFocused] = useState(false);
  const composerBlurTimeoutRef = useRef(0);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isFirebaseLoggingIn, setIsFirebaseLoggingIn] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [isImageSizeOpen, setIsImageSizeOpen] = useState(false);
  /** Non-null while a text reply is streaming; updates as tokens arrive (empty string = stream started, no text yet). */
  const [streamDraft, setStreamDraft] = useState<string | null>(null);
  /** Visible text during stream — advances word-by-word toward `streamDraft` for a typewriter feel. */
  const [streamRevealText, setStreamRevealText] = useState('');
  const streamTargetRef = useRef('');
  /** Invalidates in-flight `/api/auth/status` results so a slow initial fetch cannot overwrite state after login sets the cookie. */
  const authCheckSeq = useRef(0);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  /** When true, new tokens keep the thread tail in view (ChatGPT-style follow). */
  const userPinnedToBottomRef = useRef(true);

  /** Scroll the message list so the bottom sentinel stays in view — grows top→bottom; only follow when user is pinned to bottom. */
  const scrollThreadToBottom = useCallback((opts?: { force?: boolean; smooth?: boolean }) => {
    const scroller = scrollRef.current;
    const tail = messagesEndRef.current;
    if (!tail) return;
    if (!opts?.force) {
      if (scroller) {
        const thresholdPx = 160;
        const nearBottom =
          scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - thresholdPx;
        if (!userPinnedToBottomRef.current && !nearBottom) return;
      } else if (!userPinnedToBottomRef.current) {
        return;
      }
    }
    userPinnedToBottomRef.current = true;
    const behavior: ScrollBehavior = opts?.smooth ? 'smooth' : 'auto';
    requestAnimationFrame(() => {
      tail.scrollIntoView({ block: 'end', inline: 'nearest', behavior });
    });
  }, []);

  const showChatScroller = messages.length > 0 || isLoading || streamDraft !== null;
  const hideFooterChrome = messages.length > 0 || composerFocused;

  const PUBLIC_FOLDER_ID = '1SGoxWRv2WE_SKy4MwJhCl3A6nSy2KGwS';
  const INTERNAL_FOLDER_IDS = ['1l3KRkEaOKsVJLizriswqHn-whyc93aUk', '1j07-wxP7u9r9Y-V4ootX4KN3XB3YY0X4'];

  const fetchDriveFiles = async (folderId: string, setter?: (files: any[]) => void) => {
    try {
      const res = await fetch(`/api/drive/files?folderId=${folderId}`, {
        credentials: 'include',
      });
      const text = await res.text();
      if (!res.ok || !text.trim().startsWith('{')) {
        if (setter) setter([]);
        return [];
      }
      const data = JSON.parse(text) as { files?: any[] };
      if (setter) setter(data.files || []);
      return data.files || [];
    } catch {
      if (setter) setter([]);
      return [];
    }
  };

  const fetchAllFolders = async () => {
    fetchDriveFiles(PUBLIC_FOLDER_ID, setPublicFiles);
    const files1 = await fetchDriveFiles(INTERNAL_FOLDER_IDS[0]);
    const files2 = await fetchDriveFiles(INTERNAL_FOLDER_IDS[1]);
    setDriveFiles([...(files1 || []), ...(files2 || [])]);
  };

  const checkAuthStatus = useCallback(async (): Promise<boolean> => {
    const seq = ++authCheckSeq.current;
    try {
      const res = await fetch('/api/auth/status', { credentials: 'include' });
      const text = await res.text();
      if (seq !== authCheckSeq.current) return false;
      if (!res.ok || !text.trim().startsWith('{')) {
        setIsAuthenticated(false);
        return false;
      }
      const data = JSON.parse(text) as { isAuthenticated?: boolean };
      const ok = !!data.isAuthenticated;
      if (seq !== authCheckSeq.current) return false;
      setIsAuthenticated(ok);
      return ok;
    } catch {
      if (seq !== authCheckSeq.current) return false;
      setIsAuthenticated(false);
      return false;
    }
  }, []);

  useEffect(() => {
    if (!auth) return;

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (user) {
        setMode('internal');
        try {
          localStorage.setItem(PASSAGE_PREFER_INTERNAL, '1');
        } catch {
          /* ignore */
        }
        // Sync user to Firestore
        if (db) setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          lastLogin: serverTimestamp()
        }, { merge: true });
        
        fetchSessions(user.uid);
      } else {
        setSessions([]);
        setCurrentSessionId(null);
        setMessages([]);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => {
      if (mq.matches) setIsEventsPinnedOpen(false);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);


  const fetchSessions = (uid: string) => {
    if (!db) return () => {};
    const q = query(collection(db, 'users', uid, 'sessions'), orderBy('createdAt', 'desc'), limit(20));
    return onSnapshot(q, (snapshot) => {
      const sessionList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatSession));
      setSessions(sessionList);
    });
  };

  useEffect(() => {
    if (db && currentUser && currentSessionId) {
      const q = query(
        collection(db, 'users', currentUser.uid, 'sessions', currentSessionId, 'messages'),
        orderBy('timestamp', 'asc')
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
        setMessages(msgs);
      });
      return () => unsubscribe();
    }
  }, [currentUser, currentSessionId]);

  const createNewSession = async () => {
    if (!currentUser) {
      if (!isFirebaseConfigured) {
        alert("Firebase isn't configured yet (VITE_FIREBASE_*). The app will still work in guest mode, but chat history requires Firebase.");
        return;
      }
      try {
        const result = await signInWithGoogle();
        if (!result) return;
        if (!result.user) return;
      } catch (error: any) {
        if (error.code === 'auth/popup-closed-by-user') {
          console.log("User closed the login popup");
          return;
        } else {
          console.error("Firebase login error:", error);
          alert("Login failed. Please try again.");
          return;
        }
      }
    }
    
    const user = currentUser || auth.currentUser;
    if (!user) return;
    if (!db) return;

    const sessionData = {
      userId: user.uid,
      mode: mode,
      title: `New ${mode === 'public' ? 'Public' : 'Internal'} Chat`,
      createdAt: serverTimestamp(),
      lastMessageAt: serverTimestamp()
    };

    const docRef = await addDoc(collection(db, 'users', user.uid, 'sessions'), sessionData);
    setCurrentSessionId(docRef.id);
    setMessages([]);
    setIsSidebarOpen(false);
  };

  useEffect(() => {
    // Initialize Speech Recognition
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = () => setIsListening(false);
      recognitionRef.current.onend = () => setIsListening(false);
    }
  }, []);

  const handleComposerFocus = () => {
    window.clearTimeout(composerBlurTimeoutRef.current);
    setComposerFocused(true);
    setIsEventsPinnedOpen(false);
    setIsEventsOpen(false);
  };

  const handleComposerBlur = () => {
    window.clearTimeout(composerBlurTimeoutRef.current);
    composerBlurTimeoutRef.current = window.setTimeout(() => {
      setComposerFocused(false);
    }, 150);
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      if (!recognitionRef.current) {
        alert("Speech recognition is not supported in this browser or environment.");
        return;
      }
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error("Speech recognition error:", e);
        alert("Could not start microphone. Please ensure you have granted permission and are not in a restricted iframe.");
        setIsListening(false);
      }
    }
  };

  const TTS_MAX_CHARS = 3800;

  const speakText = (text: string, messageId: string) => {
    const silenceTtsAudio = () => {
      try {
        ttsAbortRef.current?.abort();
      } catch {}
      ttsAbortRef.current = null;
      try {
        ttsAudioRef.current?.pause();
      } catch {}
      if (ttsAudioRef.current?.src) {
        URL.revokeObjectURL(ttsAudioRef.current.src);
      }
      if (ttsAudioRef.current) ttsAudioRef.current.src = '';
    };

    const stop = () => {
      silenceTtsAudio();
      setTtsPhase('idle');
      setTtsTargetId(null);
    };

    if (ttsTargetId === messageId && ttsPhase !== 'idle') {
      stop();
      return;
    }

    let cleanText = text.replace(/\[PURPLE\]|\[\/PURPLE\]|\*\*|\*/g, '').trim();
    if (!cleanText) return;
    if (cleanText.length > TTS_MAX_CHARS) {
      cleanText = cleanText.slice(0, TTS_MAX_CHARS) + '\n[…]';
    }

    silenceTtsAudio();

    const controller = new AbortController();
    ttsAbortRef.current = controller;
    setTtsTargetId(messageId);
    setTtsPhase('loading');

    const onFinallyFail = () => {
      silenceTtsAudio();
      setTtsPhase('idle');
      setTtsTargetId(null);
    };

    fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText }),
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) {
          const msg = await r.text().catch(() => '');
          throw new Error(msg || `TTS failed (${r.status})`);
        }
        return r.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const audio = new Audio();
        audio.preload = 'auto';
        ttsAudioRef.current = audio;
        audio.src = url;
        audio.onended = () => stop();
        audio.onerror = () => {
          onFinallyFail();
        };
        return audio.play().then(() => {
          setTtsPhase('playing');
        });
      })
      .catch((e) => {
        if (e?.name !== 'AbortError') {
          console.error('[TTS] Failed:', e);
          const msg =
            e?.name === 'NotAllowedError'
              ? 'Playback was blocked. Try tapping Listen again, or check that this site can play sound.'
              : 'Voice playback failed. Check ELEVENLABS_API_KEY on the server.';
          alert(msg);
        }
        onFinallyFail();
      });
  };

  const renderContent = (content: string) => renderMarkdown(content);

  useEffect(() => {
    fetchDriveFiles(PUBLIC_FOLDER_ID, setPublicFiles);
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        authCheckSeq.current += 1;
        setIsAuthenticated(true);
        fetchAllFolders();
      }
    };
    window.addEventListener('message', handleMessage);

    let cancelled = false;
    // getRedirectResult must run before /api/auth/status so the returning OAuth session is applied first (iOS Safari / redirect flows).
    (async () => {
      try {
        const r = await getRedirectAuthResult();
        if (cancelled) return;
        if (r?.user) {
          setCurrentUser(r.user);

          if (r.accessToken) {
            const res = await fetch('/api/auth/firebase-session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ accessToken: r.accessToken }),
              credentials: 'include',
            });
            if (cancelled) return;
            if (res.ok) {
              authCheckSeq.current += 1;
              setIsAuthenticated(true);
              fetchAllFolders();
            } else {
              let code: string | undefined;
              try {
                const j = (await res.json()) as { code?: string };
                code = j?.code;
              } catch {
                /* ignore */
              }
              if (code === 'MISSING_DRIVE_SCOPE') {
                console.warn(
                  '[OAuth] Signed in with Google; Drive permission pending — tap Connect Drive once more.'
                );
              }
              const driveOk = await checkAuthStatus();
              if (!cancelled && driveOk) fetchAllFolders();
            }
          } else {
            console.warn(
              '[Firebase] Signed in after redirect but no OAuth access token in credential (Safari/WebKit). Tap Connect Drive to finish.'
            );
            const driveOk = await checkAuthStatus();
            if (!cancelled && driveOk) fetchAllFolders();
          }
        }
      } catch (e) {
        console.error('[Firebase] Redirect completion failed', e);
      }
      if (!cancelled) await checkAuthStatus();
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('message', handleMessage);
    };
  }, [checkAuthStatus]);

  /** Re-sync Drive cookie after Firebase restores session (cookie may be set slightly after auth). */
  useEffect(() => {
    if (!currentUser) return;
    const t = window.setTimeout(() => void checkAuthStatus(), 400);
    return () => window.clearTimeout(t);
  }, [currentUser, checkAuthStatus]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchAllFolders();
    }
  }, [isAuthenticated]);

  // Track whether the user has manually scrolled away from the bottom.
  useEffect(() => {
    const onScroll = () => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      const thresholdPx = 160;
      const nearBottom =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - thresholdPx;
      userPinnedToBottomRef.current = nearBottom;
    };

    const scroller = scrollRef.current;
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller?.removeEventListener('scroll', onScroll as any);
  }, [messages.length, isLoading, streamDraft]);

  // Follow the streaming tail (auto) so new text grows downward in view; smooth on discrete adds.
  useEffect(() => {
    if (!showChatScroller) return;
    const smooth = streamDraft === null && !isLoading;
    scrollThreadToBottom({ smooth });
  }, [messages.length, streamRevealText, streamDraft, isLoading, showChatScroller, scrollThreadToBottom]);

  // When the mobile keyboard opens/closes, stay anchored to the latest message.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    const onResize = () => scrollThreadToBottom({ force: true });
    vv?.addEventListener('resize', onResize);
    return () => vv?.removeEventListener('resize', onResize);
  }, [scrollThreadToBottom]);

  useEffect(() => {
    return () => window.clearTimeout(composerBlurTimeoutRef.current);
  }, []);

  if (streamDraft !== null) {
    streamTargetRef.current = streamDraft;
  }

  useEffect(() => {
    if (streamDraft === null) {
      setStreamRevealText('');
    }
  }, [streamDraft]);

  /** Word-by-word reveal toward the latest streamed target (ref updates every render while streaming). */
  useEffect(() => {
    if (streamDraft === null) return;

    const step = () => {
      setStreamRevealText((prev) => {
        const target = streamTargetRef.current;
        if (target === '') return prev;
        if (!target.startsWith(prev)) return target;
        if (prev.length >= target.length) return prev;
        const rest = target.slice(prev.length);
        const backlog = rest.length;
        const wordBursts = backlog > 220 ? 4 : backlog > 90 ? 2 : 1;
        let add = '';
        let rem = rest;
        for (let b = 0; b < wordBursts && rem.length; b++) {
          const m = rem.match(/^(\s*\S+)/);
          if (m) {
            add += m[1];
            rem = rem.slice(m[1].length);
          } else {
            add += rem[0];
            rem = rem.slice(1);
            break;
          }
        }
        return prev + add;
      });
    };

    const id = window.setInterval(step, 34);
    return () => window.clearInterval(id);
  }, [streamDraft !== null]);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxPx = 160; // ~6-7 lines
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
  }, [input]);

  const exitChat = () => {
    setSelectedImage(null);
    setSelectedDriveFile(null);
    setInput('');
    setMessages([]);
    setCurrentSessionId(null);
    setIsSidebarOpen(false);
  };

  const handleSignOut = async () => {
    try {
      authCheckSeq.current += 1;
      // Clear server-side Drive session (if any)
      await fetch('/api/auth/logout', { credentials: 'include' }).catch(() => {});
      // Clear Firebase auth
      if (auth) await signOut(auth);
    } finally {
      setIsAuthenticated(false);
      setCurrentUser(null);
      setIsAccountMenuOpen(false);
      setSessions([]);
      exitChat();
      setMode('public');
      try {
        localStorage.removeItem(PASSAGE_PREFER_INTERNAL);
      } catch {
        /* ignore */
      }
    }
  };

  const deleteSession = async (sessionId: string) => {
    if (!db || !currentUser) return;
    const ok = window.confirm('Delete this chat? This cannot be undone.');
    if (!ok) return;

    // Delete subcollection messages in batches, then delete session doc.
    const msgsCol = collection(db, 'users', currentUser.uid, 'sessions', sessionId, 'messages');
    // Loop until empty (handles > batch limit).
    while (true) {
      const snap = await getDocs(query(msgsCol, limit(400)));
      if (snap.empty) break;
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(db, 'users', currentUser.uid, 'sessions', sessionId));

    if (currentSessionId === sessionId) {
      setCurrentSessionId(null);
      setMessages([]);
    }
  };

  const handleFirebaseLogin = async () => {
    setIsFirebaseLoggingIn(true);
    try {
      if (!isFirebaseConfigured) {
        alert("Missing Firebase env vars (VITE_FIREBASE_*). Add them to your .env, restart dev server, then try again.");
        return;
      }
      const cred = await signInWithGoogle();
      if (!cred) return;
      if (auth?.currentUser) {
        try {
          localStorage.setItem(PASSAGE_PREFER_INTERNAL, '1');
        } catch {
          /* ignore */
        }
        setMode('internal');
      }
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        console.log("User closed the login popup");
      } else {
        console.error("Firebase login error:", error);
        alert("Login failed. Please try again.");
      }
    } finally {
      setIsFirebaseLoggingIn(false);
    }
  };

  const handleGoogleLogin = async () => {
    console.log("[OAuth] Starting Firebase-based Drive login...");
    setIsLoggingIn(true);
    try {
      if (!isFirebaseConfigured) {
        alert("Missing Firebase env vars (VITE_FIREBASE_*). Add them to your .env, restart dev server, then try again.");
        return;
      }

      // Must be synchronous to preserve Safari user-gesture for redirect.
      if (shouldUseFirebaseAuthRedirectSync()) {
        const u = auth?.currentUser ?? currentUser;
        if (!u) {
          console.log('[OAuth] Redirect step 1: Firebase Google sign-in (mobile Safari / Brave)');
          await signInWithGoogleRedirect();
        } else {
          console.log('[OAuth] Redirect step 2: Drive consent');
          await reauthenticateDriveRedirect(u);
        }
        return;
      }
      // Small delay to ensure UI updates
      await new Promise(resolve => setTimeout(resolve, 100));
      
      console.log("[OAuth] Calling signInWithDrive...");
      const result = await signInWithDrive();
      const { accessToken } = result;
      
      if (!accessToken) {
        console.error("[OAuth] No access token returned from Firebase.");
        throw new Error("Google did not provide an access token. Please ensure you granted permissions.");
      }

      console.log("[OAuth] Received access token, establishing server session...");
      const res = await fetch('/api/auth/firebase-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken }),
        credentials: 'include',
      });

      try {
        localStorage.setItem(PASSAGE_PREFER_INTERNAL, '1');
      } catch {
        /* ignore */
      }
      setMode('internal');

      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        let parsed: any = null;
        try {
          parsed = msg ? JSON.parse(msg) : null;
        } catch {
          /* ignore */
        }
        console.warn('[OAuth] Drive session cookie failed:', parsed?.error || msg);
        const driveOk = await checkAuthStatus();
        if (!driveOk) {
          alert(
            'You are signed in. Chat history will save to this account.\n\nGoogle Drive did not connect (server error). Try Login again in a moment, or sign out from your account menu (avatar) and try again.'
          );
        } else {
          fetchAllFolders();
        }
      } else {
        console.log("[OAuth] Login successful!");
        authCheckSeq.current += 1;
        setIsAuthenticated(true);
        fetchAllFolders();
      }
    } catch (e: any) {
      console.error("[OAuth] Login failed:", e);
      // Handle Firebase specific errors
      if (e.code === 'auth/popup-blocked') {
        alert("The login popup was blocked by your browser. Please allow popups for this site.");
      } else if (e.code === 'auth/popup-closed-by-user') {
        console.log("User closed the popup.");
      } else if (e.code === 'auth/cancelled-popup-request') {
        console.log("Popup request cancelled.");
      } else {
        alert(`Login Error: ${e.message || 'An unexpected error occurred'}`);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const resetConversation = () => {
    setSelectedImage(null);
    setSelectedDriveFile(null);
    setInput('');
    setMessages([]);
    if (mode === 'internal') {
      setCurrentSessionId(null);
    }
  };

  const handleImageSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage({ file, preview: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = error => reject(error);
    });
  };

  const renderMarkdown = useCallback((text: string) => {
    const safeText = String(text || '');
    const parts: Array<{ kind: 'text' | 'purple'; value: string }> = [];
    const re = /\[PURPLE\]([\s\S]*?)\[\/PURPLE\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(safeText))) {
      if (m.index > last) parts.push({ kind: 'text', value: safeText.slice(last, m.index) });
      parts.push({ kind: 'purple', value: m[1] || '' });
      last = m.index + m[0].length;
    }
    if (last < safeText.length) parts.push({ kind: 'text', value: safeText.slice(last) });

    const MD: FC<{ value: string }> = ({ value }) => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => (
            <a {...props} className="highlight-purple underline decoration-accent/30" target="_blank" rel="noopener noreferrer" />
          ),
          hr: () => <hr className="my-4 border-white/10" />,
          strong: (props) => <strong {...props} className="text-white font-semibold" />,
          li: (props) => <li {...props} className="my-1" />,
        }}
      >
        {value}
      </ReactMarkdown>
    );

    if (parts.length === 0) return <MD value={safeText} />;
    return (
      <span>
        {parts.map((p, i) =>
          p.kind === 'purple' ? (
            <span key={i} className="highlight-purple">
              <MD value={p.value} />
            </span>
          ) : (
            <MD key={i} value={p.value} />
          )
        )}
      </span>
    );
  }, []);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (mode === 'internal' && !currentUser) {
      alert('Internal mode requires a Google account. Use Login, then try again.');
      return;
    }
    if ((!input.trim() && !selectedImage) || isLoading) return;

    userPinnedToBottomRef.current = true;

    let sessionId = currentSessionId;
    let sessionEnsureFailed = false;
    if (!sessionId && currentUser && db) {
      // Auto-create session if none exists
      try {
        const user = currentUser;
        const sessionData = {
          userId: user.uid,
          mode: mode,
          title: input.slice(0, 30) + (input.length > 30 ? '...' : ''),
          createdAt: serverTimestamp(),
          lastMessageAt: serverTimestamp()
        };
        const docRef = await addDoc(collection(db, 'users', user.uid, 'sessions'), sessionData);
        sessionId = docRef.id;
        setCurrentSessionId(sessionId);
      } catch (err: any) {
        console.error('[Firestore] Failed to create chat session:', err);
        sessionEnsureFailed = true;
        alert(
          `Could not create a chat session in Firestore (${err?.code || err?.message || 'unknown'}).\n\n` +
            `This usually means Firestore rules/database access isn't configured for this Firebase project.\n\n` +
            `You can keep chatting locally for now — responses may not persist across refreshes.`
        );
      }
    }

    const userMessageContent = input;
    const userMessageImage = selectedImage?.preview;

    if (db && currentUser && sessionId && !sessionEnsureFailed) {
      try {
        await addDoc(collection(db, 'users', currentUser.uid, 'sessions', sessionId, 'messages'), {
          role: 'user',
          content: userMessageContent,
          image: userMessageImage || null,
          timestamp: serverTimestamp()
        });
      } catch (err: any) {
        console.error('[Firestore] Failed to save user message:', err);
        alert(
          `Could not save your message to Firestore (${err?.code || err?.message || 'unknown'}).\n\n` +
            `Continuing with local-only chat so Send still works.`
        );
      }
    } else {
      // Local state for guests
      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: userMessageContent,
        timestamp: new Date(),
        image: userMessageImage,
      };
      setMessages(prev => [...prev, userMessage]);
    }

    setInput('');
    setIsLoading(true);

    try {
      // Check if it's an image generation request (Internal Only)
      const isImageRequest = mode === 'internal' && (
                            userMessageContent.toLowerCase().includes('generate image') || 
                            userMessageContent.toLowerCase().includes('create image') ||
                            userMessageContent.toLowerCase().includes('draw')
                          );

      let responseContent = '';

      if (isImageRequest) {
        setIsGeneratingImage(true);
        try {
          const imageUrl = await generateImage(userMessageContent, imageSize);
          responseContent = `I've generated a ${imageSize} image for you:`;
          
          if (currentUser && sessionId) {
            await addDoc(collection(db, 'users', currentUser.uid, 'sessions', sessionId, 'messages'), {
              role: 'model',
              content: responseContent,
              image: imageUrl,
              timestamp: serverTimestamp()
            });
            // Update session last message time
            if (db) setDoc(doc(db, 'users', currentUser.uid, 'sessions', sessionId), {
              lastMessageAt: serverTimestamp()
            }, { merge: true });
          } else {
            const modelMessage: Message = {
              id: (Date.now() + 1).toString(),
              role: 'model',
              content: responseContent,
              image: imageUrl,
              timestamp: new Date(),
            };
            setMessages(prev => [...prev, modelMessage]);
          }
        } finally {
          setIsGeneratingImage(false);
        }
      } else {
        let imagePart;
        if (selectedImage) {
          const base64 = await fileToBase64(selectedImage.file);
          imagePart = {
            mimeType: selectedImage.file.type,
            data: base64,
          };
        }

        let driveContext: string | undefined;
        if (mode === 'internal' && selectedDriveFile && isAuthenticated) {
          try {
            const dr = await fetch(
              `/api/drive/file-text?fileId=${encodeURIComponent(selectedDriveFile.id)}`,
              { credentials: 'include' }
            );
            if (dr.ok) {
              const data = await dr.json();
              driveContext = `CONTENT FROM GOOGLE DRIVE FILE (${data.name}):\n\n${data.text}`;
            } else {
              driveContext = `Could not load Drive file (“${selectedDriveFile.name}”). Re-login if needed.`;
            }
          } catch {
            driveContext = '[Error: Could not read file from Drive]';
          }
        }

        let history: { role: 'user' | 'model'; parts: MessagePart[] }[] = messages.map(m => ({
          role: m.role,
          parts: [{ text: m.content }] as MessagePart[]
        }));
        const last = messages[messages.length - 1];
        if (last?.role === 'user' && last.content === userMessageContent) {
          history = history.slice(0, -1);
        }

        /** Internal text-only: Claude + Supabase RAG via `/api/chat`. Gemini stays for Public + vision uploads + image-gen. */
        const useInternalRag =
          mode === 'internal' && !imagePart && !isImageRequest;

        if (useInternalRag) {
          let msgsForHistory = messages;
          const lm = messages[messages.length - 1];
          if (lm?.role === 'user' && lm.content === userMessageContent) {
            msgsForHistory = messages.slice(0, -1);
          }
          const historyForApi = msgsForHistory.slice(-18).map((m) => ({
            role: (m.role === 'model' ? 'assistant' : 'user') as 'assistant' | 'user',
            content: m.content,
          }));

          let messagePayload = userMessageContent;
          if (driveContext) {
            messagePayload += `\n\n---\nAdditional context from selected Drive file:\n${driveContext}`;
          }

          // Stream internal RAG responses via SSE for Claude-like typing.
          setStreamRevealText('');
          setStreamDraft('');

          const chatRes = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: messagePayload,
              history: historyForApi,
              stream: true,
            }),
          });

          if (!chatRes.ok) {
            const raw = await chatRes.text().catch(() => '');
            throw new Error(raw || `Chat API failed (${chatRes.status})`);
          }

          const reader = chatRes.body?.getReader();
          if (!reader) throw new Error('Chat API stream unavailable');
          const decoder = new TextDecoder('utf-8');
          let buffer = '';
          let accumulated = '';
          let cites: Array<{ name?: string; url?: string; detail?: string }> = [];

          const parseSse = (chunk: string) => {
            buffer += chunk;
            // Events are separated by blank lines.
            while (true) {
              const sep = buffer.indexOf('\n\n');
              if (sep === -1) break;
              const rawEvent = buffer.slice(0, sep);
              buffer = buffer.slice(sep + 2);
              const lines = rawEvent.split('\n').map((l) => l.trimEnd());
              let eventName = 'message';
              const dataLines: string[] = [];
              for (const line of lines) {
                if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim();
                else if (line.startsWith('data:')) {
                  let v = line.slice('data:'.length);
                  if (v.startsWith(' ')) v = v.slice(1);
                  dataLines.push(v);
                }
              }
              const data = dataLines.join('\n');
              if (eventName === 'delta') {
                let piece = data;
                try {
                  piece = data ? (JSON.parse(data) as string) : '';
                } catch {
                  /* legacy server sent raw text */
                }
                accumulated += piece;
                setStreamRevealText(accumulated);
              } else if (eventName === 'citations') {
                try {
                  const parsed = JSON.parse(data);
                  if (Array.isArray(parsed)) cites = parsed;
                } catch {
                  /* ignore */
                }
              } else if (eventName === 'error') {
                throw new Error(data || 'Chat stream error');
              }
            }
          };

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            parseSse(decoder.decode(value, { stream: true }));
          }

          setStreamDraft(null);

          let finalText = (accumulated || '').trim();
          if (cites.length) {
            const lines = cites
              .map((c) => {
                const title = c.name ?? 'Document';
                const detail = typeof c.detail === 'string' && c.detail.trim() ? ` (${c.detail.trim()})` : '';
                const link = c.url ? ` — ${c.url}` : '';
                return `- ${title}${detail}${link}`;
              })
              .join('\n');
            finalText += `\n\n---\n**Sources:**\n${lines}`;
          }
          responseContent = finalText || "I'm sorry, I couldn't process that.";
        } else {
          setStreamRevealText('');
          setStreamDraft('');
          const response = await generateResponseStream(
            userMessageContent,
            history,
            mode,
            (acc) => setStreamDraft(acc),
            imagePart,
            driveContext
          );
          setStreamRevealText(response || '');
          setStreamDraft(null);

          responseContent = response || "I'm sorry, I couldn't process that.";
        }

        // Prevent double-rendering while Firestore snapshots refresh after persistence.
        setStreamRevealText('');
        setStreamDraft(null);

        if (currentUser && sessionId) {
          await addDoc(collection(db, 'users', currentUser.uid, 'sessions', sessionId, 'messages'), {
            role: 'model',
            content: responseContent,
            timestamp: serverTimestamp()
          });
          // Update session last message time
          if (db) setDoc(doc(db, 'users', currentUser.uid, 'sessions', sessionId), {
            lastMessageAt: serverTimestamp()
          }, { merge: true });
        } else {
          const aiMessage: Message = {
            id: (Date.now() + 1).toString(),
            role: 'model',
            content: responseContent,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, aiMessage]);
        }
      }
      
      setSelectedImage(null);
    } catch (error) {
      console.error("Failed to get AI response:", error);
      setStreamRevealText('');
      setStreamDraft(null);
      const errorContent = "The ethereal connection was interrupted. Please try again.";
      // Always surface an error message (guests + authed users). For authed users, persist to Firestore when possible.
      try {
        if (db && currentUser && (currentSessionId || sessionId)) {
          const sid = (sessionId || currentSessionId) as string;
          await addDoc(collection(db, 'users', currentUser.uid, 'sessions', sid, 'messages'), {
            role: 'model',
            content: errorContent,
            timestamp: serverTimestamp(),
          });
        } else {
          setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', content: errorContent, timestamp: new Date() }]);
        }
      } catch (e) {
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', content: errorContent, timestamp: new Date() }]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-[#05020a]">
      {/* Background Atmosphere */}
      <div className="fixed inset-0 z-0 atmosphere pointer-events-none" />
      
      {/* Header */}
      <header className="relative z-[100] shrink-0 border-b border-white/5 bg-stone-950/10 px-4 py-3 backdrop-blur-md sm:px-8 sm:py-3.5">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => window.open('https://www.passagetheatre.org', '_blank', 'noopener,noreferrer')}
              className="h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-full border border-accent/35 bg-stone-900/80 shadow-[0_0_18px_rgba(139,92,246,0.18)] transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-accent/50 active:scale-[0.98] sm:h-11 sm:w-11"
              aria-label="Open Passage Theatre website"
              title="Open Passage Theatre"
            >
              <img
                src="/passage.jpeg"
                alt="Passage Logo"
                referrerPolicy="no-referrer"
                className="h-full w-full object-contain"
              />
            </button>
            <div className="hidden min-w-0 xs:block">
              <h1 className="text-sm font-medium leading-none tracking-tight text-white sm:text-base">Passage</h1>
              <p className="mt-0.5 text-[7px] font-bold uppercase tracking-[0.28em] text-accent/90 sm:text-[8px]">
                Theatre Assistant
              </p>
            </div>
            {currentUser ? (
              <div
                className="ml-0.5 flex shrink-0 items-center gap-1 rounded-full border border-accent/25 bg-accent/[0.07] px-2 py-0.5 sm:ml-1 sm:px-2.5 sm:py-1"
                title="Signed in — staff workspace"
              >
                <Lock className="h-3 w-3 text-accent/90 sm:h-3.5 sm:w-3.5" aria-hidden />
                <span className="hidden text-[7px] font-medium uppercase tracking-widest text-accent/85 xs:inline sm:text-[8px]">
                  Internal
                </span>
              </div>
            ) : (
              <div className="ml-0.5 flex shrink-0 items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-0.5 sm:ml-1">
                <button
                  type="button"
                  onClick={() => setMode('public')}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[7px] font-medium uppercase tracking-widest transition-all sm:px-2.5 sm:py-1 sm:text-[8px] ${
                    mode === 'public' ? 'bg-accent text-white' : 'text-stone-400 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Globe className="h-3 w-3" />
                  <span className="hidden xs:inline">Public</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('internal')}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[7px] font-medium uppercase tracking-widest transition-all sm:px-2.5 sm:py-1 sm:text-[8px] ${
                    mode === 'internal' ? 'bg-accent text-white' : 'text-stone-400 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Lock className="h-3 w-3" />
                  <span className="hidden xs:inline">Internal</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2.5">
            {mode === 'public' && (
              <button
                type="button"
                onClick={exitChat}
                className="rounded-full p-2 text-stone-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-accent/50"
                title="Home"
                aria-label="Home — return to start"
              >
                <Home className="h-4 w-4 sm:h-5 sm:w-5" />
              </button>
            )}
            <button
              type="button"
              onClick={resetConversation}
              className="flex items-center gap-1.5 rounded-xl p-2 text-stone-400 transition-colors hover:bg-white/10 hover:text-white sm:gap-2"
              title="New chat"
              aria-label="New chat"
            >
              <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
              <span className="hidden text-[10px] font-medium uppercase tracking-widest sm:inline">New</span>
            </button>
            {mode === 'internal' && (
              <button
                type="button"
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="flex items-center gap-1.5 rounded-xl p-2 text-stone-400 transition-colors hover:bg-white/10 hover:text-white sm:gap-2"
                title="Chat history"
                aria-label="Chat history"
              >
                <History className="h-4 w-4 sm:h-5 sm:w-5" />
                <span className="hidden text-[10px] font-medium uppercase tracking-widest sm:inline">History</span>
              </button>
            )}
            {mode === 'internal' && (!currentUser || !isAuthenticated) && (
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isLoggingIn}
                className="flex items-center gap-1.5 rounded-xl bg-white/10 px-2 py-1.5 text-[9px] transition-all hover:bg-white/15 disabled:opacity-50 sm:px-3 sm:text-[10px]"
              >
                {isLoggingIn ? (
                  <Loader2 className="h-3 w-3 animate-spin sm:h-4 sm:w-4" />
                ) : (
                  <LogIn className="h-3 w-3 sm:h-4 sm:w-4" />
                )}
                <span className="hidden max-w-[7rem] truncate sm:inline">
                  {isLoggingIn ? 'Connecting...' : currentUser ? 'Connect Drive' : 'Login'}
                </span>
              </button>
            )}
            <div className="relative z-[110]">
              <button
                type="button"
                onClick={() => setIsAccountMenuOpen((v) => !v)}
                className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-white/10 transition-colors hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-accent/50 sm:h-9 sm:w-9"
                aria-label={currentUser ? 'Account menu' : 'Profile'}
                title={currentUser ? 'Account' : 'Profile'}
              >
                <img
                  src={currentUser?.photoURL || '/passage-building.jpg'}
                  alt="User"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-contain"
                />
              </button>

              {isAccountMenuOpen && currentUser && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-[110] cursor-default"
                    aria-label="Close account menu"
                    onClick={() => setIsAccountMenuOpen(false)}
                  />
                  <div className="absolute right-0 z-[120] mt-2 min-w-44 overflow-hidden rounded-2xl border border-white/10 bg-stone-950/90 shadow-2xl backdrop-blur-xl">
                    <div className="border-b border-white/5 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-widest text-stone-500">Signed in</div>
                      <div className="truncate text-xs text-white">
                        {currentUser.email || currentUser.displayName || 'Google account'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="w-full px-3 py-2.5 text-left text-xs text-stone-300 transition-colors hover:bg-white/10"
                    >
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden px-2 sm:px-4">
      {/* Main Content — flex-1 fills space between header and (desktop) footer; messages scroll inside */}
      <main className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden py-2 sm:py-4">
        <div className="flex-1 min-h-0 flex gap-4 sm:gap-6 overflow-hidden relative">
          
          {/* History + Drive: overlay only (no persistent desktop column) */}
          <AnimatePresence>
            {mode === 'internal' && isSidebarOpen && (
              <>
                <motion.div
                  key="internal-history-backdrop"
                  role="presentation"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm lg:bg-black/40"
                  onClick={() => setIsSidebarOpen(false)}
                />
              <motion.div
                key="internal-history-panel"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="fixed inset-y-0 left-0 z-[80] flex w-[min(18rem,92vw)] flex-col gap-4 overflow-hidden bg-[#05020a] p-6 glass rounded-r-3xl"
              >
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-[10px] uppercase tracking-[0.2em] text-stone-500 font-semibold">History</h3>
                  <button type="button" onClick={() => setIsSidebarOpen(false)} className="rounded-lg p-1 text-stone-500 hover:bg-white/10 hover:text-white" aria-label="Close history">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <button 
                  onClick={createNewSession}
                  className="flex items-center gap-2 w-full p-3 rounded-xl bg-accent/10 border border-accent/20 text-accent text-xs font-medium hover:bg-accent/20 transition-all"
                >
                  <Plus className="w-4 h-4" /> New Chat
                </button>

                <div className="flex-1 overflow-y-auto space-y-2 pr-2 scrollbar-hide">
                  {sessions.map(session => (
                    <div
                      key={session.id}
                      className={`w-full rounded-xl transition-all ${
                        currentSessionId === session.id ? 'bg-accent/20 border border-accent/30' : 'hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-start gap-2 p-3">
                        <button
                          type="button"
                          onClick={() => {
                            setCurrentSessionId(session.id);
                            setMode(session.mode);
                            setIsSidebarOpen(false);
                          }}
                          className="flex-1 text-left"
                        >
                          <span className={`text-[9px] uppercase tracking-widest ${session.mode === 'internal' ? 'text-accent' : 'text-stone-500'}`}>
                            {session.mode}
                          </span>
                          <div className="text-xs text-white truncate font-medium">{session.title}</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSession(session.id)}
                          className="p-1.5 rounded-lg text-stone-500 hover:text-red-300 hover:bg-white/5"
                          title="Delete chat"
                          aria-label="Delete chat"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {sessions.length === 0 && !currentUser && (
                    <div className="text-center py-8 px-4">
                      <p className="text-[10px] text-stone-600 italic">Sign in to save your chat history</p>
                      <button
                        type="button"
                        onClick={handleGoogleLogin}
                        disabled={isLoggingIn}
                        className="mt-4 text-xs text-accent hover:underline disabled:opacity-50"
                      >
                        {isLoggingIn ? 'Connecting...' : 'Sign in with Google'}
                      </button>
                      {!isFirebaseConfigured && (
                        <p className="mt-2 text-[9px] text-stone-600">
                          Missing <span className="font-mono">VITE_FIREBASE_*</span> env vars.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {mode === 'internal' && isAuthenticated && (
                  <div className="pt-4 border-t border-white/5 space-y-4">
                    <h3 className="text-[10px] uppercase tracking-[0.2em] text-stone-500 font-semibold px-2">Drive Context</h3>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {driveFiles.map(file => (
                        <button
                          key={file.id}
                          onClick={() => setSelectedDriveFile(file)}
                          className={`w-full flex items-center gap-2 p-2 rounded-lg text-[10px] text-left transition-all ${
                            selectedDriveFile?.id === file.id ? 'bg-accent/20 text-accent' : 'hover:bg-white/5 text-stone-400'
                          }`}
                        >
                          <FileText className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{file.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Sidebar for Public Mode (Upcoming Shows) - Hover Triggered Overlay */}
          <AnimatePresence>
            {mode === 'public' && messages.length === 0 && (
              <>
                {/* Hover/Click Trigger Area */}
                <button
                  type="button"
                  className="fixed left-0 top-24 bottom-24 w-12 z-[61] cursor-pointer group focus:outline-none"
                  onMouseEnter={() => setIsEventsOpen(true)}
                  onClick={() => setIsEventsPinnedOpen(v => !v)}
                  aria-label="Open Upcoming Events"
                  title="Upcoming Events"
                >
                  {/* Full-height strip (matches this trigger’s vertical span, same visual weight as the events panel edge) */}
                  <div className="pointer-events-none absolute inset-y-0 left-2 w-1.5 rounded-full bg-accent/40 shadow-[0_0_18px_rgba(139,92,246,0.55)] group-hover:bg-accent/80 group-hover:shadow-[0_0_28px_rgba(139,92,246,0.85)] transition-all" />
                  <div className="pointer-events-none absolute inset-y-0 left-1.5 w-3 rounded-full bg-accent/10 blur-[6px] opacity-80 group-hover:opacity-100 transition-opacity" />
                  <span className="absolute left-5 top-1/2 -translate-y-1/2 -rotate-90 text-[9px] uppercase tracking-[0.35em] text-accent/80 opacity-0 group-hover:opacity-100 transition-opacity select-none lg:hidden">
                    Events
                  </span>
                </button>

                {/* Mobile backdrop to close */}
                {(isEventsPinnedOpen || isEventsOpen) && (
                  <div
                    className="fixed inset-0 z-[55] bg-black/40 backdrop-blur-[1px] lg:hidden"
                    onClick={() => {
                      setIsEventsPinnedOpen(false);
                      setIsEventsOpen(false);
                    }}
                  />
                )}

                {/* The Sidebar Overlay — closed state must use full width + left offset; fixed -280px left a ~24px sliver on lg:w-72 */}
                <motion.div 
                  initial={false}
                  animate={{
                    x: (isEventsPinnedOpen || isEventsOpen) ? 0 : "calc(-100% - 1rem)",
                    opacity: 1,
                  }}
                  onMouseLeave={() => setIsEventsOpen(false)}
                  transition={{ type: "spring", damping: 28, stiffness: 260 }}
                  style={{ willChange: "transform" }}
                  className="fixed left-4 top-24 bottom-24 z-[60] w-64 lg:w-72 max-w-[min(18rem,calc(100vw-2rem))] glass rounded-3xl p-4 lg:p-5 flex flex-col gap-4 lg:gap-5 overflow-hidden border border-white/10 shadow-2xl backdrop-blur-xl"
                >
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-[10px] uppercase tracking-[0.3em] text-accent font-bold">Upcoming Events</h3>
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3 h-3 text-accent animate-pulse" />
                      <button
                        type="button"
                        className="lg:hidden p-1.5 rounded-lg hover:bg-white/10 text-stone-400 hover:text-white"
                        onClick={() => {
                          setIsEventsPinnedOpen(false);
                          setIsEventsOpen(false);
                        }}
                        aria-label="Close events panel"
                        title="Close"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-5 lg:space-y-6 pr-2 scrollbar-hide">
                    {/* Three Pillars Section */}
                    <div className="space-y-3 mb-8">
                      <h4 className="text-[8px] uppercase tracking-[0.2em] text-stone-500 font-bold px-1">Our Three Pillars</h4>
                      {[
                        { name: 'Trenton Premieres', img: 'https://static.wixstatic.com/media/f5611b_e5f5de295192441c943dbac1442d198d~mv2.png/v1/fill/w_1702,h_626,al_c,q_90,enc_avif,quality_auto/f5611b_e5f5de295192441c943dbac1442d198d~mv2.png', link: 'https://www.passagetheatre.org/trentonpremieres' },
                        { name: 'Trenton Makes', img: 'https://static.wixstatic.com/media/f5611b_8589589e49634a659f9d51ea0c31a5ae~mv2.png/v1/fill/w_1702,h_626,al_c,q_90,enc_avif,quality_auto/f5611b_8589589e49634a659f9d51ea0c31a5ae~mv2.png', link: 'https://www.passagetheatre.org/trentonmakes' },
                        { name: 'Trenton Presents', img: 'https://static.wixstatic.com/media/f5611b_11ef8f2686814d249aa58cfcc8808039~mv2.png/v1/fill/w_1702,h_626,al_c,q_90,enc_avif,quality_auto/f5611b_11ef8f2686814d249aa58cfcc8808039~mv2.png', link: 'https://www.passagetheatre.org/trentonpresents' }
                      ].map((pillar) => (
                        <div key={pillar.name} className="relative rounded-lg overflow-hidden h-12 border border-white/5 hover:border-accent/30 transition-all cursor-pointer group" onClick={() => window.open(pillar.link, '_blank')}>
                          <img src={pillar.img} alt={pillar.name} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" referrerPolicy="no-referrer" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                            <span className="text-[8px] uppercase tracking-widest font-bold text-white">{pillar.name}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <h4 className="text-[8px] uppercase tracking-[0.2em] text-stone-500 font-bold px-1">Upcoming Events</h4>
                    {UPCOMING_SHOWS.map((file) => (
                      <div 
                        key={file.id} 
                        className={`group ${file.link ? 'cursor-pointer' : 'cursor-default'}`} 
                        onClick={() => {
                          if ((file as any).link) {
                            window.open((file as any).link, '_blank', 'noopener,noreferrer');
                          } else {
                            setInput(`Tell me more about ${file.name}`);
                          }
                        }}
                      >
                        <div className="relative rounded-xl overflow-hidden aspect-[14/10] mb-2 lg:mb-3 bg-white/5 border border-white/10 group-hover:border-accent/50 transition-all shadow-lg">
                          <img 
                            src={file.thumbnailLink} 
                            alt={file.name} 
                            referrerPolicy="no-referrer" 
                            className={`w-full h-full object-cover ${file.id === 'gala-2026' ? 'object-top' : ''} group-hover:scale-110 transition-transform duration-700`} 
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
                          <div className="absolute bottom-2 left-2 right-2">
                            <span className="text-[7px] lg:text-[8px] uppercase tracking-widest bg-accent px-2 py-0.5 rounded-full text-white font-bold">Featured</span>
                          </div>
                        </div>
                        <p className="text-xs lg:text-sm font-semibold text-white group-hover:text-accent transition-colors leading-tight">{file.name}</p>
                        <p className="text-[9px] lg:text-[10px] text-stone-500 line-clamp-2 mt-1 lg:mt-1.5 leading-relaxed">{file.description}</p>
                      </div>
                    ))}
                  </div>
                  <div className="pt-4 border-t border-white/5">
                    <button 
                      onClick={() => window.open('https://www.passagetheatre.org/tickets', '_blank')}
                      className="w-full py-2.5 lg:py-3 rounded-xl bg-white/5 hover:bg-white/10 text-[9px] lg:text-[10px] uppercase tracking-widest text-stone-400 hover:text-white transition-all border border-white/5"
                    >
                      Get tickets
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Chat Area */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden items-center h-full min-w-0">
            {messages.length === 0 ? (
              <div className="flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch] px-4 pb-6 scrollbar-hide sm:mx-auto">
                <div className="flex flex-1 flex-col items-center justify-center gap-6 py-6 text-center sm:gap-8 sm:py-10">
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-3 sm:space-y-4"
                >
                  <h2 className="text-4xl font-light leading-tight text-white sm:text-5xl md:text-6xl">
                    {mode === 'public' ? (
                      <>
                        <span className="font-editorial">Explore</span>
                        <br />
                        <span className="font-editorial italic text-accent">Passage</span>
                      </>
                    ) : (
                      <>
                        <span className="font-editorial">Master</span>{' '}
                        <span className="font-sans font-light tracking-tight text-white/85">the</span>
                        <br />
                        <span className="font-editorial italic text-accent">Workflow</span>
                      </>
                    )}
                  </h2>
                  <p className="mx-auto max-w-sm font-sans text-xs leading-relaxed text-stone-400 sm:text-sm">
                    {mode === 'public' 
                      ? "Discover our current season, learn about our community programs, and find your seat at the theatre."
                      : "Connect your Drive, write grants, and streamline your internal operations."}
                  </p>
                </motion.div>

                <div className="mx-auto grid w-full max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
                  {(mode === 'public' ? [
                    "Tell me about 'Season 41'",
                    "What's the theme of the current season?",
                    "Where is Mill Hill Playhouse?",
                    "How do I buy tickets?"
                  ] : [
                    "Draft a grant for TrentonPREMIERES",
                    "Analyze the budget from my Drive",
                    "Write a proposal for the next season",
                    "Summarize the latest project brief"
                  ]).map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(suggestion)}
                      className="group rounded-2xl border border-white/10 bg-stone-900/40 p-3 text-left text-[10px] text-stone-300 backdrop-blur-xl transition-all hover:bg-white/10 sm:p-4 sm:text-xs"
                    >
                      <p className="mb-1 opacity-60 transition-opacity group-hover:opacity-100">Suggestion</p>
                      <p className="font-medium">{suggestion}</p>
                    </button>
                  ))}
                </div>
                </div>
              </div>
            ) : (
              <div
                ref={scrollRef}
                className="min-h-0 flex-1 w-full max-w-4xl mx-auto overflow-y-auto overflow-x-hidden overscroll-y-contain [-webkit-overflow-scrolling:touch] space-y-6 sm:space-y-8 pr-2 sm:pr-4 scrollbar-hide pb-4 sm:pb-6"
              >
                <AnimatePresence initial={false}>
                  {messages.map((message) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex gap-3 sm:gap-4 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                    >
                      <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                        message.role === 'user' ? 'bg-stone-800' : 'bg-accent/20 border border-accent/30'
                      }`}>
                        {message.role === 'user' ? <User className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-accent" />}
                      </div>
                      <div className={`max-w-[85%] sm:max-w-[80%] space-y-1 ${message.role === 'user' ? 'text-right' : ''}`}>
                        <div className={`p-3 sm:p-4 rounded-2xl overflow-hidden ${
                          message.role === 'user' 
                            ? 'bg-stone-800/50 text-white' 
                            : 'glass text-stone-200 text-sm sm:text-base leading-relaxed'
                        }`}>
                          {message.image && (
                            <img src={message.image} alt="User upload" className="rounded-xl mb-3 max-h-48 sm:max-h-60 w-auto mx-auto" referrerPolicy="no-referrer" />
                          )}
                          <div className="whitespace-pre-wrap">
                            {renderContent(message.content)}
                          </div>
                          {message.role === 'model' && (
                            <button 
                              type="button"
                              onClick={() => speakText(message.content, message.id)}
                              className="mt-3 p-1.5 hover:bg-white/10 rounded-full transition-colors flex items-center gap-2 text-[9px] uppercase tracking-widest text-stone-500 hover:text-accent group"
                              title="Listen to response"
                            >
                              <Volume2
                                className={`w-3.5 h-3.5 ${
                                  ttsTargetId === message.id && ttsPhase === 'loading'
                                    ? 'text-stone-400 animate-pulse'
                                    : ttsTargetId === message.id && ttsPhase === 'playing'
                                      ? 'text-accent animate-pulse'
                                      : 'group-hover:scale-110 transition-transform'
                                }`}
                              />
                              <span
                                className={`transition-opacity ${
                                  ttsTargetId === message.id && ttsPhase !== 'idle'
                                    ? 'opacity-100'
                                    : 'opacity-0 group-hover:opacity-100'
                                }`}
                              >
                                {ttsTargetId === message.id && ttsPhase === 'loading'
                                  ? 'Preparing audio…'
                                  : ttsTargetId === message.id && ttsPhase === 'playing'
                                    ? 'Playing…'
                                    : 'Listen'}
                              </span>
                            </button>
                          )}
                        </div>
                        <p className="text-[9px] text-stone-500 uppercase tracking-widest px-2">
                          {message.timestamp?.toDate ? message.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
                {streamDraft !== null && (
                  <div className="flex gap-3 sm:gap-4">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center">
                      <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-accent" />
                    </div>
                    <div className="max-w-[85%] sm:max-w-[80%] space-y-1">
                      <div className="p-3 sm:p-4 rounded-2xl overflow-hidden glass text-stone-200 text-sm sm:text-base leading-relaxed">
                        {streamRevealText.length === 0 && (streamDraft?.length ?? 0) === 0 ? (
                          <div className="flex items-center gap-2">
                            <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin text-accent shrink-0" />
                            <span className="text-[10px] sm:text-xs text-stone-400 italic">Passage is composing…</span>
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap">
                            {renderContent(streamRevealText)}
                            {streamRevealText.length < (streamDraft?.length ?? 0) && (
                              <span className="inline-block w-0.5 h-[1em] ml-0.5 align-[-0.15em] bg-accent/80 animate-pulse rounded-sm" aria-hidden />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {isLoading && streamDraft === null && (
                  <div className="flex gap-3 sm:gap-4">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center animate-pulse">
                      <Bot className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-accent" />
                    </div>
                    <div className="glass p-3 sm:p-4 rounded-2xl flex items-center gap-2">
                      <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin text-accent" />
                      <span className="text-[10px] sm:text-xs text-stone-400 italic">
                        {isGeneratingImage ? `Passage is manifesting your ${imageSize} vision...` : 'Passage is contemplating...'}
                      </span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}

            {/* Composer — pinned above footer; footer collapses on focus via hideFooterChrome */}
            <div className="relative z-20 mt-auto w-full shrink-0 border-t border-transparent pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:border-t-0 sm:pb-3">
              <div className="relative mx-auto w-full max-w-4xl px-1 sm:px-0">
              {selectedImage && (
                <div className="absolute bottom-full mb-3 left-0 flex items-center gap-2 rounded-xl border border-white/5 bg-stone-900/40 p-2 backdrop-blur-md">
                  <img src={selectedImage.preview} alt="Preview" className="w-10 h-10 object-cover rounded-lg" />
                  <button onClick={() => setSelectedImage(null)} className="p-1 hover:bg-white/10 rounded-full">
                    <X className="w-3 h-3 text-stone-400" />
                  </button>
                </div>
              )}
              <form 
                onSubmit={handleSubmit}
                ref={composerFormRef}
                className="relative flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <textarea
                    ref={composerRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={mode === 'internal' && !currentUser}
                    onFocus={handleComposerFocus}
                    onBlur={handleComposerBlur}
                    onKeyDown={(e) => {
                      const isEnter = e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter';
                      if (isEnter && !e.shiftKey) {
                        e.preventDefault();
                        if (!isLoading) composerFormRef.current?.requestSubmit();
                      }
                    }}
                    rows={1}
                    enterKeyHint="send"
                    placeholder={
                      mode === 'public'
                        ? "Whisper your thoughts..."
                        : !currentUser
                          ? "Sign in (Google) to use Internal mode..."
                          : !isAuthenticated
                            ? "Draft a grant… (Connect Drive to attach files from Drive)"
                            : "Draft a grant or analyze data..."
                    }
                    className="w-full max-w-full resize-none overflow-x-hidden overflow-y-auto rounded-2xl border border-purple-500/15 bg-purple-950/25 py-3.5 pl-4 pr-20 text-[16px] leading-relaxed text-stone-100 shadow-none backdrop-blur-xl placeholder:text-stone-500 focus:border-purple-400/25 focus:outline-none focus:ring-2 focus:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-60 sm:py-4 sm:pl-6 sm:pr-32 sm:text-sm [transform:translateZ(0)]"
                  />
                  <div className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5 sm:gap-1">
                    <button
                      type="button"
                      onClick={toggleListening}
                      className={`rounded-xl p-1.5 transition-all sm:p-2 ${isListening ? 'animate-pulse bg-red-500/20 text-red-400' : 'text-stone-400 hover:bg-white/10 hover:text-white'}`}
                      title="Voice Input"
                    >
                      {isListening ? <MicOff className="w-3.5 h-3.5 sm:w-5 sm:h-5" /> : <Mic className="w-3.5 h-3.5 sm:w-5 sm:h-5" />}
                    </button>
                    {mode === 'internal' && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setIsImageSizeOpen(v => !v)}
                          className="rounded-xl p-1.5 text-stone-400 transition-all hover:bg-white/10 hover:text-white sm:p-2"
                          title={`Image size: ${imageSize}`}
                          aria-label="Select image size"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                        </button>
                        {isImageSizeOpen && (
                          <div className="absolute right-0 bottom-full mb-2 glass rounded-xl p-1 border border-white/10 shadow-xl min-w-[140px]">
                            <div className="px-2 py-1 text-[8px] uppercase tracking-widest text-stone-500">Image size</div>
                            <div className="flex gap-1 p-1">
                              {(["1K", "2K", "4K"] as const).map((size) => (
                                <button
                                  key={size}
                                  type="button"
                                  onClick={() => {
                                    setImageSize(size);
                                    setIsImageSizeOpen(false);
                                  }}
                                  className={`flex-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all ${
                                    imageSize === size ? 'bg-accent text-white' : 'text-stone-400 hover:bg-white/5 hover:text-white'
                                  }`}
                                >
                                  {size}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {mode === 'internal' && (
                      <>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="rounded-xl p-1.5 text-stone-400 transition-all hover:bg-white/10 hover:text-white sm:p-2"
                          title="Upload Image"
                        >
                          <ImageIcon className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
                        </button>
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          onChange={handleImageSelect} 
                          accept="image/*" 
                          className="hidden" 
                        />
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={((!input.trim() && !selectedImage) || isLoading) || (mode === 'internal' && !currentUser)}
                  className="p-3.5 sm:p-4 rounded-2xl bg-accent text-white hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_15px_rgba(139,92,246,0.3)]"
                >
                  <Send className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </form>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer — collapses on composer focus + stays hidden once the thread has messages */}
      <div
        className={`relative z-[100] shrink-0 overflow-hidden transition-[max-height,opacity] duration-300 ease-out motion-reduce:transition-none ${
          hideFooterChrome ? 'pointer-events-none max-h-0 opacity-0' : 'max-h-[min(52vh,520px)] opacity-100'
        }`}
        aria-hidden={hideFooterChrome}
      >
      <footer className="flex shrink-0 flex-col gap-6 border-t border-white/5 bg-black/5 px-4 pt-4 pb-8 backdrop-blur-sm sm:flex-row sm:items-end sm:justify-between sm:px-8">
        <div className="flex flex-col items-center gap-4 sm:items-start">
          <span className="text-[10px] uppercase tracking-widest text-stone-500">&copy; 2026 Passage Theatre Company</span>
          <div className="flex flex-wrap items-center justify-center gap-4 sm:justify-start">
            <a
              href="https://www.passagetheatre.org/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open Passage Theatre Company website"
              title="Passage Theatre Company"
              className="inline-flex rounded-md focus:outline-none focus:ring-2 focus:ring-accent/60"
            >
              <img 
                src="https://static.wixstatic.com/media/f5611b_7510767165fa4d41a3e6f648576b45f4~mv2.png/v1/fill/w_284,h_90,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/PassagelogoresetWHITE(1)(2).png" 
                alt="Passage Theatre Company"
                className="h-8 grayscale opacity-50 transition-all duration-300 hover:opacity-100 hover:grayscale-0 sm:h-10"
                referrerPolicy="no-referrer"
              />
            </a>
            <a
              href="https://www.passagetheatre.org/trentonpremieres"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open Trenton Premieres"
              title="Trenton Premieres"
              className="inline-flex rounded-md focus:outline-none focus:ring-2 focus:ring-accent/60"
            >
              <img 
                src="https://static.wixstatic.com/media/f5611b_e2e51aa273424cbeaaff2cdf18bb44ac~mv2.png/v1/fill/w_192,h_114,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Trenton%20Premieres.png" 
                alt="Trenton Premieres"
                className="h-7 grayscale opacity-50 transition-all duration-300 hover:opacity-100 hover:grayscale-0 sm:h-8"
                referrerPolicy="no-referrer"
              />
            </a>
            <a
              href="https://www.passagetheatre.org/trentonmakes"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open Trenton Makes"
              title="Trenton Makes"
              className="inline-flex rounded-md focus:outline-none focus:ring-2 focus:ring-accent/60"
            >
              <img 
                src="https://static.wixstatic.com/media/f5611b_da92e1d28bf64ee38e9d6418f0c657c3~mv2.png/v1/fill/w_230,h_132,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Trenton%20Makes.png" 
                alt="Trenton Makes"
                className="h-7 grayscale opacity-50 transition-all duration-300 hover:opacity-100 hover:grayscale-0 sm:h-8"
                referrerPolicy="no-referrer"
              />
            </a>
            <a
              href="https://www.passagetheatre.org/trentonpresents"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open Trenton Presents"
              title="Trenton Presents"
              className="inline-flex rounded-md focus:outline-none focus:ring-2 focus:ring-accent/60"
            >
              <img 
                src="https://static.wixstatic.com/media/f5611b_04ad1e5a26904b49949ec678966a1034~mv2.png/v1/fill/w_230,h_132,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Trenton%20Presents.png" 
                alt="Trenton Presents"
                className="h-7 grayscale opacity-50 transition-all duration-300 hover:opacity-100 hover:grayscale-0 sm:h-8"
                referrerPolicy="no-referrer"
              />
            </a>
          </div>
        </div>
        <div className="flex w-full justify-center text-[10px] uppercase tracking-widest text-stone-500 sm:w-auto sm:justify-end">
          <div className="flex flex-col items-center gap-1.5 sm:items-end">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end">
              <span>{mode === 'internal' ? 'Internal Access' : 'Public Access'}</span>
              <span className="text-stone-700">•</span>
              <a
                href="https://beightechai.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold tracking-[0.2em] text-accent/80 hover:underline"
              >
                BeighTech
              </a>
            </div>
            <span className="max-w-[min(100%,20rem)] text-center text-[10px] normal-case tracking-normal text-accent/70 sm:max-w-xs sm:text-right">
              Account: {currentUser ? (currentUser.email || 'Signed in') : 'Guest'} · Drive:{' '}
              {isAuthenticated ? 'Connected' : 'Off'}
            </span>
          </div>
        </div>
      </footer>
      </div>
      </div>
    </div>
  );
}
