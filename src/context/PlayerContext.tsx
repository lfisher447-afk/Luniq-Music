import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { LuniqTrack, normalizeTrack } from "../types/track";
import { usePlayback } from "./PlaybackContext";
import { fetchLyricsSmart as fetchLyrics } from "../services/lyricshelper";

// ==========================================
// 1. Types & Interfaces
// ==========================================

export interface QueuedTrack extends LuniqTrack {
  queueId?: string;
}

export type LoopMode = "none" | "all" | "one";
export type NavType = "manual" | "next" | "prev" | "loop-restart";

export interface PlayerContextType {
  currentTrack: LuniqTrack | null;
  isPlaying: boolean;
  isShuffle: boolean;
  isLoop: LoopMode;
  queue: QueuedTrack[];
  shuffledQueue: QueuedTrack[];
  history: LuniqTrack[];
  sessionHistory: LuniqTrack[];
  sessionIndex: number;
  contextTracks: LuniqTrack[];
  prefetchMap: Record<string, { url: string; timestamp: number }>;
  showQueue: boolean;
  showFullNowPlaying: boolean;
  showLyrics: boolean;
  autoplayQueue: LuniqTrack[];
  isRadioLoading: boolean;

  setAutoplayQueue: React.Dispatch<React.SetStateAction<LuniqTrack[]>>;
  setIsRadioLoading: (loading: boolean) => void;
  setIsPlaying: (playing: boolean) => void;
  setIsShuffle: (shuffle: boolean) => void;
  setIsLoop: (loop: LoopMode) => void;
  setShowQueue: (show: boolean) => void;
  setShowFullNowPlaying: (show: boolean) => void;
  setShowLyrics: (show: boolean) => void;
  setCurrentTrack: (track: LuniqTrack | null) => void;
  setQueue: React.Dispatch<React.SetStateAction<QueuedTrack[]>>;
  setHistory: React.Dispatch<React.SetStateAction<LuniqTrack[]>>;

  handleTrackSelect: (
    track: LuniqTrack,
    playlistTracks?: LuniqTrack[],
    navType?: NavType
  ) => void;
  handleAddToQueue: (track: LuniqTrack | LuniqTrack[]) => void;
  handlePlayNext: (track: LuniqTrack | LuniqTrack[]) => void;
  handleRemoveFromQueue: (index: number) => void;
  clearQueue: () => void;
  handleNextTrack: () => Promise<void>;
  handlePrevTrack: (currentTime?: number) => void;
  formatTrackForPlayer: (t: Partial<LuniqTrack>) => LuniqTrack;
  clearHistory: () => Promise<void>;

  activeBulkDownloads: Set<string>;
  startBulkDownload: (id: string, tracks: LuniqTrack[]) => Promise<void>;
  stopBulkDownload: (id: string) => void;
}

// ==========================================
// 2. Pure Utilities (Extracted for performance)
// ==========================================

const fisherYatesShuffle = <T,>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const generateQueueId = () => `id-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

// ==========================================
// 3. Custom Hooks (Separation of Concerns)
// ==========================================

/** Handles LocalStorage init and debounced syncing */
function usePersistentState<T>(key: string, initialValue: T, debounceMs: number = 0) {
  const [state, setState] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : initialValue;
    } catch (e) {
      console.warn(`[State] Failed to parse saved ${key}`, e);
      return initialValue;
    }
  });

  useEffect(() => {
    if (debounceMs > 0) {
      const timer = setTimeout(() => {
        localStorage.setItem(key, JSON.stringify(state));
      }, debounceMs);
      return () => clearTimeout(timer);
    } else {
      localStorage.setItem(key, JSON.stringify(state));
    }
  }, [key, state, debounceMs]);

  return [state, setState] as const;
}

/** Handles caching and prefetching upcoming audio */
function useAudioPrefetcher(
  sessionHistory: LuniqTrack[],
  sessionIndex: number,
  activeQueue: QueuedTrack[],
  autoplayQueue: LuniqTrack[],
  currentTrackId?: string
) {
  const [prefetchMap, setPrefetchMap] = useState<Record<string, { url: string; timestamp: number }>>({});
  
  useEffect(() => {
    let isCancelled = false;
    const STALE_TIME = 30 * 60 * 1000;

    const prefetchNeighbors = async () => {
      const neighbors: LuniqTrack[] = [];
      
      // Determine logical neighbors based on playback state
      if (sessionIndex < sessionHistory.length - 1) {
        neighbors.push(...sessionHistory.slice(sessionIndex + 1, sessionIndex + 3));
      } else if (activeQueue.length > 0) {
        neighbors.push(...activeQueue.slice(0, 2));
      } else if (autoplayQueue.length > 0) {
        neighbors.push(...autoplayQueue.slice(0, 2));
      }

      const neighborIds = new Set(neighbors.filter(Boolean).map((n) => n.id));
      if (currentTrackId) neighborIds.add(currentTrackId);

      // Prune stale or unneeded cache entries
      setPrefetchMap((prev) => {
        const nextMap: typeof prev = {};
        let changed = false;
        for (const [id, entry] of Object.entries(prev)) {
          const isStale = Date.now() - entry.timestamp > STALE_TIME;
          if (neighborIds.has(id) && !isStale) {
            nextMap[id] = entry;
          } else {
            changed = true;
          }
        }
        return changed ? nextMap : prev;
      });

      // Fetch new neighbors
      const fetchedInThisCycle = new Set<string>();
      for (const track of neighbors) {
        if (isCancelled || !track) continue;

        let alreadyExists = false;
        setPrefetchMap((curr) => {
          const existing = curr[track.id];
          if (existing && Date.now() - existing.timestamp <= STALE_TIME) {
            alreadyExists = true;
          }
          return curr;
        });

        if (alreadyExists || fetchedInThisCycle.has(track.id)) continue;

        try {
          const url = await (window as any).ipcRenderer.invoke(
            "get-stream-url",
            track.name,
            track.artist,
            track.id,
            false,
            `prefetch-${track.id}`,
            track.durationMs || 0
          );

          if (isCancelled) return;

          if (url) {
            fetchedInThisCycle.add(track.id);
            setPrefetchMap((prev) => {
              const updated = { ...prev, [track.id]: { url, timestamp: Date.now() } };
              const sortedEntries = Object.entries(updated).sort((a, b) => b[1].timestamp - a[1].timestamp);
              return Object.fromEntries(sortedEntries.slice(0, 5)); // Keep max 5
            });

            // Fire-and-forget lyrics prefetch
            fetchLyrics(
              track.name,
              track.artist,
              track.durationMs ? track.durationMs / 1000 : undefined,
              undefined,
              track.id
            ).catch(() => {});
          }
        } catch (err) {
          console.warn(`[Prefetch] Failed to prefetch ${track.id}`, err);
        }

        if (isCancelled) return;
        await new Promise((r) => setTimeout(r, 100)); // Throttle
      }
    };

    const timer = setTimeout(prefetchNeighbors, 500);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [currentTrackId, activeQueue, autoplayQueue, sessionHistory, sessionIndex]);

  return { prefetchMap, setPrefetchMap };
}

/** Handles offline bulk downloading streams */
function useBulkDownloader() {
  const [activeBulkDownloads, setActiveBulkDownloads] = useState<Set<string>>(new Set());
  const abortControllers = useRef<Record<string, AbortController>>({});

  const startBulkDownload = useCallback(async (id: string, tracks: LuniqTrack[]) => {
    if (activeBulkDownloads.has(id)) return;

    const controller = new AbortController();
    abortControllers.current[id] = controller;
    setActiveBulkDownloads((prev) => new Set(prev).add(id));

    try {
      for (let i = 0; i < tracks.length; i++) {
        if (controller.signal.aborted) break;

        const track = tracks[i];
        try {
          const exists = await (window as any).ipcRenderer.invoke("check-is-downloaded", track.id);
          if (exists) continue;
          if (controller.signal.aborted) break;

          await (window as any).ipcRenderer.invoke("download-track", {
            id: track.id,
            name: track.name,
            artists: Array.isArray(track.artists)
              ? track.artists.map((a: any) => (typeof a === "string" ? a : a.name))
              : [track.artist || "Unknown Artist"],
            albumArt: track.albumArt || "",
            durationMs: track.durationMs,
          });

          // Throttle between downloads
          if (i < tracks.length - 1 && !controller.signal.aborted) {
            await new Promise((res) => {
              const timeout = setTimeout(res, 2000);
              controller.signal.addEventListener("abort", () => {
                clearTimeout(timeout);
                res(null);
              }, { once: true });
            });
          }
        } catch (err) {
          console.error(`[BulkDownload] Failed track ${track.id}`, err);
        }
      }
    } finally {
      delete abortControllers.current[id];
      setActiveBulkDownloads((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      window.dispatchEvent(new Event("luniq:download-update"));
    }
  }, [activeBulkDownloads]);

  const stopBulkDownload = useCallback((id: string) => {
    if (abortControllers.current[id]) {
      abortControllers.current[id].abort();
    }
  }, []);

  return { activeBulkDownloads, startBulkDownload, stopBulkDownload };
}


// ==========================================
// 4. Main Context Provider
// ==========================================

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { autoplayEnabled, lowDataMode, audioQuality, audioFormat } = usePlayback();

  // ----- State Management -----
  const [currentTrack, setCurrentTrack] = usePersistentState<LuniqTrack | null>("luniq_current_track", null);
  const [isShuffle, setIsShuffle] = usePersistentState<boolean>("luniq_is_shuffle", false);
  const [isLoop, setIsLoop] = usePersistentState<LoopMode>("luniq_is_loop", "none");
  const [queue, setQueue] = usePersistentState<QueuedTrack[]>("luniq_queue", [], 2000);
  const [shuffledQueue, setShuffledQueue] = usePersistentState<QueuedTrack[]>("luniq_shuffled_queue", [], 2000);
  const [contextTracks, setContextTracks] = usePersistentState<LuniqTrack[]>("luniq_context_tracks", [], 1000);
  const [sessionHistory, setSessionHistory] = usePersistentState<LuniqTrack[]>("luniq_session_history", []);
  const [sessionIndex, setSessionIndex] = usePersistentState<number>("luniq_session_index", -1);
  const [autoplayQueue, setAutoplayQueue] = usePersistentState<LuniqTrack[]>("luniq_autoplay_queue", []);
  
  // Non-persistent state
  const [history, setHistory] = useState<LuniqTrack[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRadioLoading, setIsRadioLoading] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [showFullNowPlaying, setShowFullNowPlaying] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);

  // References for async stability
  const activeQueue = useMemo(() => (isShuffle && shuffledQueue.length > 0 ? shuffledQueue : queue), [isShuffle, shuffledQueue, queue]);
  const isNextBusyRef = useRef(false);
  const autoplayQueueRef = useRef(autoplayQueue);
  const isRadioLoadingRef = useRef(isRadioLoading);
  
  // Update refs
  useEffect(() => { autoplayQueueRef.current = autoplayQueue; }, [autoplayQueue]);
  useEffect(() => { isRadioLoadingRef.current = isRadioLoading; }, [isRadioLoading]);

  // ----- Hooks Integration -----
  const { prefetchMap, setPrefetchMap } = useAudioPrefetcher(sessionHistory, sessionIndex, activeQueue, autoplayQueue, currentTrack?.id);
  const { activeBulkDownloads, startBulkDownload, stopBulkDownload } = useBulkDownloader();

  // ----- Startup / Configuration Effects -----
  useEffect(() => {
    if (isShuffle && shuffledQueue.length === 0 && queue.length > 0) {
      setShuffledQueue(fisherYatesShuffle(queue));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialSettingsMount = useRef(true);
  useEffect(() => {
    if (initialSettingsMount.current) {
      initialSettingsMount.current = false;
      return;
    }
    setPrefetchMap({});
    (window as any).ipcRenderer.invoke("clear-cache").catch(() => {});
  }, [lowDataMode, audioQuality, audioFormat, setPrefetchMap]);

  useEffect(() => {
    if (currentTrack && sessionHistory.length === 0) {
      setSessionHistory([currentTrack]);
      setSessionIndex(0);
    }
  }, [currentTrack, sessionHistory.length, setSessionHistory, setSessionIndex]);

  useEffect(() => {
    (window as any).ipcRenderer.invoke("get-recent-tracks")
      .then((saved: any) => { if (Array.isArray(saved)) setHistory(saved); })
      .catch((err: any) => console.warn("Failed to load history", err));
  }, []);

  // ----- Core Handlers -----

  const toggleShuffle = useCallback((shuffle: boolean) => {
    setIsShuffle(shuffle);
    setShuffledQueue(shuffle && queue.length > 0 ? fisherYatesShuffle(queue) : []);
  }, [queue, setIsShuffle, setShuffledQueue]);

  const formatTrackForPlayer = useCallback((t: Partial<LuniqTrack>) => normalizeTrack(t, lowDataMode), [lowDataMode]);

  const handleTrackSelect = useCallback((
    track: LuniqTrack,
    playlistTracks: LuniqTrack[] = [],
    navType: NavType = "manual"
  ) => {
    const formattedTrack = formatTrackForPlayer(track);

    if (currentTrack?.id && currentTrack.id !== formattedTrack.id) {
      (window as any).ipcRenderer.invoke("cancel-stream", currentTrack.id, "player").catch(() => {});
    }

    // Update Global History
    setHistory((prev) => {
      const filtered = prev.filter((t) => t.id !== formattedTrack.id);
      return [formattedTrack, ...filtered].slice(0, 50);
    });
    (window as any).ipcRenderer.invoke("add-recent-track", formattedTrack);

    // Handle Session Navigation
    if (navType === "manual") {
      const newHistory = [...sessionHistory.slice(0, sessionIndex + 1), formattedTrack].slice(-200);
      setSessionHistory(newHistory);
      setSessionIndex(newHistory.length - 1);
    } else if (navType === "next" && sessionIndex === sessionHistory.length - 1) {
      const newHistory = [...sessionHistory, formattedTrack].slice(-200);
      setSessionHistory(newHistory);
      setSessionIndex(newHistory.length - 1);
    } else if (navType === "next") {
      setSessionIndex((prev) => prev + 1);
    } else if (navType === "loop-restart") {
      setSessionIndex(0);
    } // "prev" handles session backwards in `handlePrevTrack`

    // Signal playback logic
    if (currentTrack?.id === formattedTrack.id) {
      window.dispatchEvent(new CustomEvent("luniq:restart-track", { detail: { play: true } }));
    }
    
    setCurrentTrack(formattedTrack);
    setIsPlaying(true);

    // Apply Context if manual select
    if (navType === "manual") {
      setAutoplayQueue([]);
      if (playlistTracks.length > 0) {
        const formattedContext = playlistTracks.map(formatTrackForPlayer);
        setContextTracks(formattedContext);

        const currentIndex = playlistTracks.findIndex((t) => normalizeTrack(t, lowDataMode).id === formattedTrack.id);
        const remainingTracks = playlistTracks.slice(currentIndex + 1).map((t) => ({
          ...formatTrackForPlayer(t),
          queueId: generateQueueId(),
        }));

        setQueue(remainingTracks);
        if (isShuffle) setShuffledQueue(fisherYatesShuffle(remainingTracks));
      } else {
        setContextTracks([formattedTrack]);
      }
    }
  }, [currentTrack, formatTrackForPlayer, isShuffle, sessionHistory, sessionIndex, setAutoplayQueue, setContextTracks, setCurrentTrack, setQueue, setSessionHistory, setSessionIndex, setShuffledQueue]);

  const handleAddToQueue = useCallback((trackData: LuniqTrack | LuniqTrack[]) => {
    const tracks = Array.isArray(trackData) ? trackData : [trackData];
    const formatted = tracks.map((t) => ({ ...formatTrackForPlayer(t), queueId: generateQueueId() }));
    
    setQueue((prev) => [...prev, ...formatted]);
    if (isShuffle) setShuffledQueue((prev) => [...prev, ...formatted]);
  }, [formatTrackForPlayer, isShuffle, setQueue, setShuffledQueue]);

  const handlePlayNext = useCallback((trackData: LuniqTrack | LuniqTrack[]) => {
    const tracks = Array.isArray(trackData) ? trackData : [trackData];
    const formatted = tracks.map((t) => ({ ...formatTrackForPlayer(t), queueId: generateQueueId() }));
    
    setQueue((prev) => [...formatted, ...prev]);
    if (isShuffle) setShuffledQueue((prev) => [...formatted, ...prev]);
  }, [formatTrackForPlayer, isShuffle, setQueue, setShuffledQueue]);

  const handleRemoveFromQueue = useCallback((index: number) => {
    if (isShuffle) {
      const targetId = shuffledQueue[index].queueId;
      setShuffledQueue((prev) => prev.filter((_, i) => i !== index));
      setQueue((prev) => prev.filter((t) => t.queueId !== targetId));
    } else {
      const targetId = queue[index].queueId;
      setQueue((prev) => prev.filter((_, i) => i !== index));
      setShuffledQueue((prev) => prev.filter((t) => t.queueId !== targetId));
    }
  }, [isShuffle, queue, shuffledQueue, setQueue, setShuffledQueue]);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setShuffledQueue([]);
  }, [setQueue, setShuffledQueue]);

  const handleNextTrack = useCallback(async () => {
    if (isNextBusyRef.current) return;
    isNextBusyRef.current = true;

    try {
      // 1. Traverse existing session forwards
      if (sessionIndex < sessionHistory.length - 1) {
        handleTrackSelect(sessionHistory[sessionIndex + 1], [], "next");
        return;
      }

      // 2. Consume from Queue
      if (activeQueue.length > 0) {
        const nextTrack = activeQueue[0];

        if (isShuffle && shuffledQueue.length > 0) {
          setShuffledQueue((prev) => prev.slice(1));
          setQueue((prev) => prev.filter((t) => t.queueId !== nextTrack.queueId));
        } else {
          setQueue((prev) => prev.slice(1));
          if (isShuffle) setShuffledQueue((prev) => prev.filter((t) => t.queueId !== nextTrack.queueId));
        }

        handleTrackSelect(nextTrack, [], "next");
        return;
      }

      // 3. Loop Context
      if (isLoop === "all" && contextTracks.length > 0) {
        let firstTrack: QueuedTrack;
        if (isShuffle) {
          const reshuffled = fisherYatesShuffle(contextTracks).map(t => ({...t, queueId: generateQueueId()}));
          firstTrack = reshuffled[0];
          handleTrackSelect(firstTrack, [], "next");
          setTimeout(() => {
            setShuffledQueue(reshuffled.slice(1));
            setQueue(contextTracks.filter((t) => t.id !== firstTrack.id).map(t => ({...t, queueId: generateQueueId()})));
          }, 50);
        } else {
          firstTrack = contextTracks[0];
          handleTrackSelect(firstTrack, [], "next");
          setTimeout(() => setQueue(contextTracks.slice(1).map(t => ({...t, queueId: generateQueueId()}))), 50);
        }
        return;
      }

      // 4. Autoplay Fallback
      if (autoplayEnabled) {
        if (autoplayQueueRef.current.length === 0) {
          if (!isRadioLoadingRef.current) {
            window.dispatchEvent(new Event("luniq:trigger-pool-fetch"));
          }
          // Polling mechanism to wait for radio
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 500));
            if (autoplayQueueRef.current.length > 0) break;
          }
        }

        if (autoplayQueueRef.current.length > 0) {
          const nextTrack = autoplayQueueRef.current[0];
          setAutoplayQueue((prev) => prev.slice(1));
          handleTrackSelect(nextTrack, [], "next");
          return;
        }
      }

      // 5. Default EOF Behavior
      setIsPlaying(false);
    } finally {
      isNextBusyRef.current = false;
    }
  }, [
    sessionIndex, sessionHistory, activeQueue, isShuffle, shuffledQueue, 
    isLoop, contextTracks, autoplayEnabled, handleTrackSelect, setShuffledQueue, setQueue, setAutoplayQueue
  ]);

  const handlePrevTrack = useCallback((currentTime?: number) => {
    const playerProgress = currentTime ?? parseFloat(localStorage.getItem("luniq_player_progress") || "0");

    if (playerProgress > 3) {
      window.dispatchEvent(new CustomEvent("luniq:restart-track", { detail: { play: true } }));
      setIsPlaying(true);
      return;
    }

    if (sessionIndex > 0) {
      const prevTrack = sessionHistory[sessionIndex - 1];
      setSessionIndex((prev) => prev - 1);
      handleTrackSelect(prevTrack, [], "prev");
    }
  }, [sessionIndex, sessionHistory, setSessionIndex, handleTrackSelect]);

  const clearHistory = useCallback(async () => {
    try {
      await (window as any).ipcRenderer.invoke("clear-recent-tracks");
      setHistory([]);
    } catch (err) {
      console.error("Failed to clear history", err);
    }
  }, []);

  // ----- Context Value Memoization -----
  const contextValue = useMemo<PlayerContextType>(() => ({
    currentTrack, isPlaying, isShuffle, isLoop, 
    queue: activeQueue, shuffledQueue, history, sessionHistory, 
    sessionIndex, contextTracks, prefetchMap, showQueue, showFullNowPlaying, 
    showLyrics, autoplayQueue, isRadioLoading, activeBulkDownloads,
    
    setAutoplayQueue, setIsRadioLoading, setIsPlaying, setIsShuffle: toggleShuffle, 
    setIsLoop, setShowQueue, setShowFullNowPlaying, setShowLyrics, 
    setCurrentTrack, setQueue, setHistory, handleTrackSelect, handleAddToQueue, 
    handlePlayNext, handleRemoveFromQueue, clearQueue, handleNextTrack, 
    handlePrevTrack, formatTrackForPlayer, clearHistory, startBulkDownload, stopBulkDownload
  }), [
    currentTrack, isPlaying, isShuffle, isLoop, activeQueue, shuffledQueue, 
    history, sessionHistory, sessionIndex, contextTracks, prefetchMap, 
    showQueue, showFullNowPlaying, showLyrics, autoplayQueue, isRadioLoading, 
    activeBulkDownloads, setAutoplayQueue, toggleShuffle, setQueue, 
    handleTrackSelect, handleAddToQueue, handlePlayNext, handleRemoveFromQueue, 
    clearQueue, handleNextTrack, handlePrevTrack, formatTrackForPlayer, 
    clearHistory, startBulkDownload, stopBulkDownload
  ]);

  return (
    <PlayerContext.Provider value={contextValue}>
      {children}
    </PlayerContext.Provider>
  );
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (context === undefined) {
    throw new Error("usePlayer must be used within a PlayerProvider");
  }
  return context;
};
