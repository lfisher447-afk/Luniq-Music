const GIST_URL =
  "https://gist.githubusercontent.com/saraansx/c50367808cbbf6ea7352920e4b556ac3/raw/spotify_hashes.json";

const CACHE_TTL_MS = 30 * 60 * 1000;

interface HashStore {
  [category: string]: {
    [operation: string]: string;
  };
}

let cachedHashes: HashStore | null = null;
let lastFetchedAt = 0;
let fetchPromise: Promise<HashStore> | null = null;

async function fetchRemoteHashes(): Promise<HashStore> {
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      console.log("[HashRegistry] Fetching remote hashes from gist...");
      const res = await fetch(GIST_URL, {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const data: HashStore = await res.json();
      cachedHashes = data;
      lastFetchedAt = Date.now();
      console.log("[HashRegistry] Remote hashes loaded successfully");
      return data;
    } catch (err) {
      console.error("[HashRegistry] Failed to fetch remote hashes:", err);
      if (cachedHashes) {
        console.warn("[HashRegistry] Using previously cached hashes");
        return cachedHashes;
      }
      throw new Error(
        "Failed to fetch remote hashes and no cached hashes available",
      );
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

async function getHashes(): Promise<HashStore> {
  const now = Date.now();
  if (cachedHashes && now - lastFetchedAt < CACHE_TTL_MS) {
    return cachedHashes;
  }
  return fetchRemoteHashes();
}

async function getHash(category: string, operation: string): Promise<string> {
  const hashes = await getHashes();
  const hash = hashes?.[category]?.[operation];
  if (!hash) {
    throw new Error(
      `[HashRegistry] No hash found for ${category}.${operation}. ` +
        `Available categories: ${Object.keys(hashes).join(", ")}`,
    );
  }
  return hash;
}

async function preloadHashes(): Promise<void> {
  await getHashes();
}

function invalidateHashCache(): void {
  lastFetchedAt = 0;
  console.log("[HashRegistry] Cache invalidated — will re-fetch on next call");
}

export { getHash, getHashes, preloadHashes, invalidateHashCache };
export type { HashStore };
