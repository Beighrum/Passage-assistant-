import { useState, useRef, useEffect, FormEvent, ChangeEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Sparkles, User, Bot, Loader2, Command, Image as ImageIcon, Lock, Globe, LogIn, FileText, X, Volume2, Mic, MicOff, History, Plus } from 'lucide-react';
import { generateResponse, generateImage, MessagePart } from './lib/gemini';
import {
  auth,
  db,
  getRedirectAuthResult,
  isFirebaseConfigured,
  signInWithDrive,
  signInWithDriveRedirect,
  signInWithGoogle,
  signInWithGoogleRedirect,
} from './lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, setDoc, getDocs, limit } from 'firebase/firestore';

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

const UPCOMING_SHOWS = [
  { 
    id: 'gala-2026', 
    name: '2026 Gala: "Freedom Has No Rehearsal"', 
    description: 'Saturday April 25th, 2026 at the Trenton War Memorial. Celebrating Season 41: "Not Afraid".',
    thumbnailLink: 'https://res.cloudinary.com/onthestage/image/upload/v1772576647/orgpageimage/aod5l3awtwvimqtengbv.jpg',
    link: 'https://www.passagetheatre.org/shows-events',
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
    link: 'https://www.passagetheatre.org/shows-events',
    mimeType: 'image/png'
  },
  { 
    id: 'dutchman', 
    name: 'The Dutchman', 
    description: 'Amiri Baraka\'s classic play. A tense, symbolic encounter on a New York subway.',
    thumbnailLink: 'https://static.wixstatic.com/media/f5611b_0f67008f4c6c4253a5b95a1d33cc51a6~mv2.png/v1/fill/w_810,h_1012,al_c,q_90,usm_0.66_1.00_0.01,enc_avif,quality_auto/Dutchman.png',
    link: 'https://www.passagetheatre.org/shows-events',
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

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const [imageSize, setImageSize] = useState<"1K" | "2K" | "4K">("1K");
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const recognitionRef = useRef<any>(null);

  const PUBLIC_FOLDER_ID = '1SGoxWRv2WE_SKy4MwJhCl3A6nSy2KGwS';
  const INTERNAL_FOLDER_IDS = ['1l3KRkEaOKsVJLizriswqHn-whyc93aUk', '1j07-wxP7u9r9Y-V4ootX4KN3XB3YY0X4'];

  useEffect(() => {
    if (!auth) return;

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      if (user) {
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
    const onResize = () => {
      if (window.innerWidth >= 1024) setIsEventsPinnedOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
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

  const speakText = (text: string) => {
    const stop = () => {
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
      setIsSpeaking(false);
    };

    if (isSpeaking) {
      stop();
      return;
    }

    const cleanText = text.replace(/\[PURPLE\]|\[\/PURPLE\]|\*\*|\*/g, '').trim();
    if (!cleanText) return;

    const controller = new AbortController();
    ttsAbortRef.current = controller;
    setIsSpeaking(true);

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
        const audio = new Audio(url);
        ttsAudioRef.current = audio;
        audio.onended = () => stop();
        audio.onerror = () => stop();
        return audio.play();
      })
      .catch((e) => {
        if (e?.name !== 'AbortError') {
          console.error('[TTS] Failed:', e);
          alert('Voice playback failed. Check ELEVENLABS_API_KEY on the server.');
        }
        stop();
      });
  };

  const renderContent = (content: string) => {
    // Replace [PURPLE]text[/PURPLE] with styled span or link
    const parts = content.split(/(\[PURPLE\].*?\[\/PURPLE\])/g);
    return parts.map((part, i) => {
      if (part.startsWith('[PURPLE]')) {
        const text = part.replace('[PURPLE]', '').replace('[/PURPLE]', '');
        const isTicketing = text.toLowerCase().includes('ticket') || text.toLowerCase().includes('buy');
        
        if (isTicketing) {
          return (
            <a 
              key={i} 
              href="https://www.passagetheatre.org/shows-events" 
              target="_blank" 
              rel="noopener noreferrer"
              className="highlight-purple underline decoration-accent/30"
            >
              {text}
            </a>
          );
        }
        return <span key={i} className="highlight-purple">{text}</span>;
      }
      return part;
    });
  };

  useEffect(() => {
    checkAuthStatus();
    fetchDriveFiles(PUBLIC_FOLDER_ID, setPublicFiles);
    const handleMessage = (event: MessageEvent) => {
      console.log("[OAuth] Received message from popup:", event.data);
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        console.log("[OAuth] Auth success message confirmed. Updating state.");
        setIsAuthenticated(true);
        fetchAllFolders();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    // Complete Firebase redirect sign-in (mobile-friendly).
    (async () => {
      try {
        const r = await getRedirectAuthResult();
        if (!r?.user) return;
        setCurrentUser(r.user);

        // If redirect granted Drive access, establish server session too.
        if (r.accessToken) {
          const res = await fetch('/api/auth/firebase-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: r.accessToken }),
          });
          if (res.ok) {
            setIsAuthenticated(true);
            fetchAllFolders();
          }
        }
      } catch (e) {
        console.error('[Firebase] Redirect completion failed', e);
      }
    })();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchAllFolders();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchAllFolders = async () => {
    fetchDriveFiles(PUBLIC_FOLDER_ID, setPublicFiles);
    // Fetch from both internal folders and combine
    const files1 = await fetchDriveFiles(INTERNAL_FOLDER_IDS[0]);
    const files2 = await fetchDriveFiles(INTERNAL_FOLDER_IDS[1]);
    setDriveFiles([...(files1 || []), ...(files2 || [])]);
  };

  const checkAuthStatus = async () => {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      setIsAuthenticated(data.isAuthenticated);
    } catch (e) {
      console.error("Auth status check failed", e);
    }
  };

  const fetchDriveFiles = async (folderId: string, setter?: (files: any[]) => void) => {
    try {
      const res = await fetch(`/api/drive/files?folderId=${folderId}`);
      const data = await res.json();
      if (setter) setter(data.files || []);
      return data.files || [];
    } catch (e) {
      console.error(`Failed to fetch drive files for ${folderId}`, e);
      return [];
    }
  };

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isFirebaseLoggingIn, setIsFirebaseLoggingIn] = useState(false);

  const handleFirebaseLogin = async () => {
    setIsFirebaseLoggingIn(true);
    try {
      if (!isFirebaseConfigured) {
        alert("Missing Firebase env vars (VITE_FIREBASE_*). Add them to your .env, restart dev server, then try again.");
        return;
      }
      const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        await signInWithGoogleRedirect();
        return;
      }
      await signInWithGoogle();
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

      const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        await signInWithDriveRedirect();
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
        body: JSON.stringify({ accessToken })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to establish server session");
      }

      console.log("[OAuth] Login successful!");
      setIsAuthenticated(true);
      fetchAllFolders();
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

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if ((!input.trim() && !selectedImage) || isLoading) return;

    let sessionId = currentSessionId;
    if (!sessionId && currentUser && db) {
      // Auto-create session if none exists
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
    }

    const userMessageContent = input;
    const userMessageImage = selectedImage?.preview;

    if (db && currentUser && sessionId) {
      await addDoc(collection(db, 'users', currentUser.uid, 'sessions', sessionId, 'messages'), {
        role: 'user',
        content: userMessageContent,
        image: userMessageImage || null,
        timestamp: serverTimestamp()
      });
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

        const history = messages.map(m => ({
          role: m.role,
          parts: [{ text: m.content }] as MessagePart[]
        }));

        const response = await generateResponse(
          userMessageContent, 
          history, 
          mode, 
          imagePart,
          selectedDriveFile ? `Context from file ${selectedDriveFile.name}: [Content would be fetched here]` : undefined
        );
        
        responseContent = response || "I'm sorry, I couldn't process that.";

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
      const errorContent = "The ethereal connection was interrupted. Please try again.";
      if (!currentUser) {
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', content: errorContent, timestamp: new Date() }]);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden flex flex-col">
      {/* Background Atmosphere */}
      <div className="fixed inset-0 z-0 atmosphere pointer-events-none" />
      
      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-4 sm:px-8 py-4 sm:py-6 border-b border-white/5 backdrop-blur-md">
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => window.open('https://www.passagetheatre.org', '_blank', 'noopener,noreferrer')}
            className="w-9 h-9 sm:w-12 sm:h-12 rounded-full border-2 border-accent/30 flex items-center justify-center overflow-hidden bg-stone-900 shadow-[0_0_20px_rgba(139,92,246,0.2)] cursor-pointer transition-transform hover:scale-[1.03] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-accent/60"
            aria-label="Open Passage Theatre website"
            title="Open Passage Theatre"
          >
            <img 
              src="/passage.jpeg" 
              alt="Passage Logo" 
              referrerPolicy="no-referrer" 
              className="w-full h-full object-contain" 
            />
          </button>
          <div className="hidden xs:block">
            <h1 className="text-base sm:text-xl font-medium tracking-tight text-white leading-none">Passage</h1>
            <p className="text-[7px] sm:text-[9px] uppercase tracking-[0.3em] text-accent font-bold mt-1">Theatre Assistant</p>
          </div>
        </div>
        
        <div className="flex items-center gap-1 sm:gap-2 p-1 bg-white/5 rounded-full border border-white/10 scale-90 sm:scale-100">
          <button 
            onClick={() => setMode('public')}
            className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1 sm:py-1.5 rounded-full text-[8px] sm:text-[10px] uppercase tracking-widest transition-all ${
              mode === 'public' ? 'bg-accent text-white' : 'text-stone-400 hover:text-white'
            }`}
          >
            <Globe className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> <span className="hidden xs:inline">Public</span>
          </button>
          <button 
            onClick={() => setMode('internal')}
            className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1 sm:py-1.5 rounded-full text-[8px] sm:text-[10px] uppercase tracking-widest transition-all ${
              mode === 'internal' ? 'bg-accent text-white' : 'text-stone-400 hover:text-white'
            }`}
          >
            <Lock className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> <span className="hidden xs:inline">Internal</span>
          </button>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <button
            type="button"
            onClick={resetConversation}
            className="p-2 hover:bg-white/10 rounded-xl text-stone-400"
            title="New chat"
            aria-label="New chat"
          >
            <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 hover:bg-white/10 rounded-xl text-stone-400"
          >
            <History className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          {mode === 'internal' && !isAuthenticated && (
            <div className="flex items-center gap-2">
              <button 
                onClick={handleGoogleLogin}
                disabled={isLoggingIn}
                className="flex items-center gap-2 px-2.5 py-1.5 sm:px-4 sm:py-2 bg-white/10 hover:bg-white/20 rounded-xl text-[9px] sm:text-xs transition-all disabled:opacity-50"
              >
                {isLoggingIn ? <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" /> : <LogIn className="w-3 h-3 sm:w-4 sm:h-4" />}
                <span className="hidden sm:inline">{isLoggingIn ? 'Connecting...' : 'Login'}</span>
              </button>
              <button 
                onClick={async () => {
                  await fetch('/api/auth/logout');
                  window.location.reload();
                }}
                className="p-2 hover:bg-white/10 rounded-xl text-stone-500 text-[8px] uppercase tracking-widest"
              >
                Reset
              </button>
            </div>
          )}
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-white/10 flex items-center justify-center overflow-hidden">
            <img src={currentUser?.photoURL || "/passage-building.jpg"} alt="User" referrerPolicy="no-referrer" className="w-full h-full object-contain" />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col max-w-6xl mx-auto w-full px-2 sm:px-4 py-4 sm:py-8 overflow-hidden">
        <div className="flex-1 flex gap-4 sm:gap-6 overflow-hidden relative">
          
          {/* Sidebar for Chat History (Mobile Overlay / Desktop Sidebar for Internal) */}
          <AnimatePresence>
            {(isSidebarOpen || (mode === 'internal' && typeof window !== 'undefined' && window.innerWidth >= 1024)) && (
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className={`
                  ${isSidebarOpen ? 'fixed inset-y-0 left-0 z-50 w-72 bg-[#05020a] p-6' : 'hidden lg:flex w-64 p-4'}
                  glass rounded-r-3xl lg:rounded-3xl flex flex-col gap-4 overflow-hidden
                `}
              >
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-[10px] uppercase tracking-[0.2em] text-stone-500 font-semibold">History</h3>
                  <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden text-stone-500"><X className="w-4 h-4" /></button>
                </div>

                <button 
                  onClick={createNewSession}
                  className="flex items-center gap-2 w-full p-3 rounded-xl bg-accent/10 border border-accent/20 text-accent text-xs font-medium hover:bg-accent/20 transition-all"
                >
                  <Plus className="w-4 h-4" /> New Chat
                </button>

                <div className="flex-1 overflow-y-auto space-y-2 pr-2 scrollbar-hide">
                  {sessions.map(session => (
                    <button
                      key={session.id}
                      onClick={() => {
                        setCurrentSessionId(session.id);
                        setMode(session.mode);
                        setIsSidebarOpen(false);
                      }}
                      className={`w-full flex flex-col gap-1 p-3 rounded-xl text-left transition-all ${
                        currentSessionId === session.id ? 'bg-accent/20 border border-accent/30' : 'hover:bg-white/5'
                      }`}
                    >
                      <span className={`text-[9px] uppercase tracking-widest ${session.mode === 'internal' ? 'text-accent' : 'text-stone-500'}`}>
                        {session.mode}
                      </span>
                      <span className="text-xs text-white truncate font-medium">{session.title}</span>
                    </button>
                  ))}
                  {sessions.length === 0 && !currentUser && (
                    <div className="text-center py-8 px-4">
                      <p className="text-[10px] text-stone-600 italic">Sign in to save your chat history</p>
                      <button 
                        onClick={handleFirebaseLogin} 
                        disabled={isFirebaseLoggingIn}
                        className="mt-4 text-xs text-accent hover:underline disabled:opacity-50"
                      >
                        {isFirebaseLoggingIn ? 'Connecting...' : 'Sign In'}
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
            )}
          </AnimatePresence>

          {/* Sidebar for Public Mode (Upcoming Shows) - Hover Triggered Overlay */}
          <AnimatePresence>
            {mode === 'public' && messages.length === 0 && (
              <>
                {/* Hover/Click Trigger Area */}
                <div 
                  className="fixed left-0 top-24 bottom-24 w-8 z-40 cursor-pointer group"
                  onMouseEnter={() => setIsEventsOpen(true)}
                  onClick={() => setIsEventsPinnedOpen(v => !v)}
                >
                  <div className="h-full w-1 bg-accent/20 group-hover:bg-accent/50 transition-colors rounded-full ml-2" />
                </div>

                {/* Mobile backdrop to close */}
                {(isEventsPinnedOpen || isEventsOpen) && (
                  <div
                    className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] lg:hidden"
                    onClick={() => {
                      setIsEventsPinnedOpen(false);
                      setIsEventsOpen(false);
                    }}
                  />
                )}

                {/* The Sidebar Overlay */}
                <motion.div 
                  initial={{ x: -300, opacity: 0 }}
                  animate={{ 
                    x: (isEventsPinnedOpen || isEventsOpen) ? 0 : -280, 
                    opacity: 1 
                  }}
                  onMouseLeave={() => setIsEventsOpen(false)}
                  transition={{ type: "spring", damping: 25, stiffness: 200 }}
                  className="fixed left-4 top-24 bottom-24 z-50 w-64 lg:w-72 glass rounded-3xl p-4 lg:p-5 flex flex-col gap-4 lg:gap-5 overflow-hidden border border-white/10 shadow-2xl backdrop-blur-xl"
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
                        { name: 'Trenton Premieres', img: 'https://static.wixstatic.com/media/f5611b_e5f5de295192441c943dbac1442d198d~mv2.png/v1/fill/w_1702,h_626,al_c,q_90,enc_avif,quality_auto/f5611b_e5f5de295192441c943dbac1442d198d~mv2.png', link: 'https://www.passagetheatre.org/trenton-premieres' },
                        { name: 'Trenton Makes', img: 'https://static.wixstatic.com/media/f5611b_8589589e49634a659f9d51ea0c31a5ae~mv2.png/v1/fill/w_1702,h_626,al_c,q_90,enc_avif,quality_auto/f5611b_8589589e49634a659f9d51ea0c31a5ae~mv2.png', link: 'https://www.passagetheatre.org/trenton-makes' },
                        { name: 'Trenton Presents', img: 'https://static.wixstatic.com/media/f5611b_11ef8f2686814d249aa58cfcc8808039~mv2.png/v1/fill/w_1702,h_626,al_c,q_90,enc_avif,quality_auto/f5611b_11ef8f2686814d249aa58cfcc8808039~mv2.png', link: 'https://www.passagetheatre.org/trenton-presents' }
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
                        className="group cursor-pointer" 
                        onClick={() => {
                          if ((file as any).link) {
                            window.open((file as any).link, '_blank');
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
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" 
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
                      onClick={() => window.open('https://www.passagetheatre.org/shows-events', '_blank')}
                      className="w-full py-2.5 lg:py-3 rounded-xl bg-white/5 hover:bg-white/10 text-[9px] lg:text-[10px] uppercase tracking-widest text-stone-400 hover:text-white transition-all border border-white/5"
                    >
                      View All Events
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* Chat Area */}
          <div className="flex-1 flex flex-col overflow-hidden items-center">
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6 sm:space-y-8 px-4 max-w-3xl w-full">
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-3 sm:space-y-4"
                >
                  <h2 className="serif text-4xl sm:text-5xl md:text-6xl font-light italic text-white leading-tight">
                    {mode === 'public' ? "Explore" : "Master the"} <br />
                    <span className="text-accent">{mode === 'public' ? "Passage" : "Workflow"}</span>
                  </h2>
                  <p className="text-stone-400 max-w-sm mx-auto text-xs sm:text-sm leading-relaxed">
                    {mode === 'public' 
                      ? "Discover our current season, learn about our community programs, and find your seat at the theatre."
                      : "Connect your Drive, write grants, and streamline your internal operations."}
                  </p>
                </motion.div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 w-full max-w-2xl">
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
                      className="glass p-3 sm:p-4 rounded-2xl text-left text-[10px] sm:text-xs text-stone-300 hover:bg-white/10 transition-all group"
                    >
                      <p className="opacity-60 mb-1 group-hover:opacity-100 transition-opacity">Suggestion</p>
                      <p className="font-medium">{suggestion}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div 
                ref={scrollRef}
                className="flex-1 overflow-y-auto space-y-6 sm:space-y-8 pr-2 sm:pr-4 scrollbar-hide pb-32"
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
                              onClick={() => speakText(message.content)}
                              className="mt-3 p-1.5 hover:bg-white/10 rounded-full transition-colors flex items-center gap-2 text-[9px] uppercase tracking-widest text-stone-500 hover:text-accent group"
                              title="Listen to response"
                            >
                              <Volume2 className={`w-3.5 h-3.5 ${isSpeaking ? 'text-accent animate-pulse' : 'group-hover:scale-110 transition-transform'}`} />
                              <span className="opacity-0 group-hover:opacity-100 transition-opacity">{isSpeaking ? 'Speaking...' : 'Listen'}</span>
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
                {isLoading && (
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
              </div>
            )}

            {/* Input Area */}
            <div className="sticky bottom-0 mt-4 sm:mt-6 relative w-full max-w-3xl px-2 sm:px-0 pb-2 sm:pb-0">
              <div className="absolute inset-x-0 bottom-full h-10 bg-gradient-to-t from-[#05020a] to-transparent pointer-events-none" />
              {/* Image Size Selection Affordance - Internal Only */}
              {mode === 'internal' && (
                <div className="absolute bottom-full mb-3 right-0 flex items-center gap-2 p-1.5 glass rounded-xl">
                  <span className="text-[8px] uppercase tracking-widest text-stone-500 px-1">Image Size:</span>
                  {(["1K", "2K", "4K"] as const).map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setImageSize(size)}
                      className={`px-2 py-0.5 rounded-md text-[9px] font-medium transition-all ${
                        imageSize === size ? 'bg-accent text-white' : 'text-stone-500 hover:text-stone-300'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              )}

              {selectedImage && (
                <div className="absolute bottom-full mb-3 left-0 flex items-center gap-2 p-2 glass rounded-xl">
                  <img src={selectedImage.preview} alt="Preview" className="w-10 h-10 object-cover rounded-lg" />
                  <button onClick={() => setSelectedImage(null)} className="p-1 hover:bg-white/10 rounded-full">
                    <X className="w-3 h-3 text-stone-400" />
                  </button>
                </div>
              )}
              <form 
                onSubmit={handleSubmit}
                className="relative flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={mode === 'public' ? "Whisper your thoughts..." : "Draft a grant or analyze data..."}
                    className="w-full glass bg-white/5 rounded-2xl py-3.5 sm:py-5 pl-4 sm:pl-6 pr-20 sm:pr-32 text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all placeholder:text-stone-600"
                  />
                  <div className="absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 flex items-center gap-0.5 sm:gap-1">
                    <button
                      type="button"
                      onClick={toggleListening}
                      className={`p-1.5 sm:p-2 rounded-xl transition-all ${isListening ? 'bg-red-500/20 text-red-400 animate-pulse' : 'text-stone-500 hover:text-white hover:bg-white/5'}`}
                      title="Voice Input"
                    >
                      {isListening ? <MicOff className="w-3.5 h-3.5 sm:w-5 sm:h-5" /> : <Mic className="w-3.5 h-3.5 sm:w-5 sm:h-5" />}
                    </button>
                    {mode === 'internal' && (
                      <>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="p-1.5 sm:p-2 rounded-xl text-stone-500 hover:text-white hover:bg-white/5 transition-all"
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
                  disabled={(!input.trim() && !selectedImage) || isLoading}
                  className="p-3.5 sm:p-4 rounded-2xl bg-accent text-white hover:bg-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_15px_rgba(139,92,246,0.3)]"
                >
                  <Send className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>

      {/* Footer Decoration */}
      <footer className="relative z-10 px-8 py-6 flex flex-col sm:flex-row justify-between items-center gap-6 border-t border-white/5 bg-black/20 backdrop-blur-sm">
        <div className="flex flex-col items-center sm:items-start gap-4">
          <span className="text-[10px] uppercase tracking-widest text-stone-500">&copy; 2026 Passage Theatre Company</span>
          <div className="flex flex-wrap items-center gap-4 justify-center sm:justify-start">
            <img 
              src="https://static.wixstatic.com/media/f5611b_7510767165fa4d41a3e6f648576b45f4~mv2.png/v1/fill/w_284,h_90,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/PassagelogoresetWHITE(1)(2).png" 
              alt="Passage Logo" 
              className="h-10 opacity-80 hover:opacity-100 transition-opacity"
              referrerPolicy="no-referrer"
            />
            <img 
              src="https://static.wixstatic.com/media/f5611b_e2e51aa273424cbeaaff2cdf18bb44ac~mv2.png/v1/fill/w_192,h_114,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Trenton%20Premieres.png" 
              alt="Trenton Premieres" 
              className="h-8 opacity-60 hover:opacity-100 transition-opacity grayscale hover:grayscale-0"
              referrerPolicy="no-referrer"
            />
            <img 
              src="https://static.wixstatic.com/media/f5611b_da92e1d28bf64ee38e9d6418f0c657c3~mv2.png/v1/fill/w_230,h_132,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Trenton%20Makes.png" 
              alt="Trenton Makes" 
              className="h-8 opacity-60 hover:opacity-100 transition-opacity grayscale hover:grayscale-0"
              referrerPolicy="no-referrer"
            />
            <img 
              src="https://static.wixstatic.com/media/f5611b_04ad1e5a26904b49949ec678966a1034~mv2.png/v1/fill/w_230,h_132,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Trenton%20Presents.png" 
              alt="Trenton Presents" 
              className="h-8 opacity-60 hover:opacity-100 transition-opacity grayscale hover:grayscale-0"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
        <div className="flex gap-6 text-[10px] uppercase tracking-widest text-stone-500">
          <div className="flex flex-col items-center sm:items-end gap-1.5">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-stone-500">
              <span>{mode === 'internal' ? 'Internal Access' : 'Public Access'}</span>
              <span className="text-stone-700">•</span>
              <a
                href="https://beightechai.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent/80 font-bold tracking-[0.2em] hover:underline"
              >
                BeighTech
              </a>
            </div>
            <span className="text-accent/60">Status: {isAuthenticated ? 'Authenticated' : 'Guest'}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
