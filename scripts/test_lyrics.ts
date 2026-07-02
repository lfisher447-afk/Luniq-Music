import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock global variables needed in Node environment
const store: Record<string, string> = {};
global.localStorage = {
  getItem: (key: string) => store[key] || null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k in store) delete store[k]; },
  length: 0,
  key: (index: number) => null
} as any;

// Keep console functions enabled to see log errors

// Load Spotify Credentials from Luniq's local configuration file on disk
let spotifyCreds: any = null;
try {
  const configPath = path.join(os.homedir(), 'AppData/Roaming/luniq-music/config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.spotify_access_token) {
      spotifyCreds = {
        accessToken: config.spotify_access_token,
        cookies: config.spotify_cookies,
        expiration: config.spotify_expires_at
      };
    }
  }
} catch (e) {
  // Silent catch
}

// Mock window.ipcRenderer for the Spotify provider
global.window = {
  ipcRenderer: {
    invoke: async (channel: string) => {
      if (channel === 'get-spotify-credentials') {
        return spotifyCreds;
      }
      return null;
    }
  }
} as any;

import { fetchSpotifyLyrics } from '../src/services/lyrics/spotify';

const testTrack = {
  title: "Shape of You",
  artist: "Ed Sheeran",
  duration: 233 // seconds
};

async function testSpotify() {
  console.log(`\n=== Testing Native Spotify Lyrics for "${testTrack.title}" by ${testTrack.artist} ===\n`);

  if (!spotifyCreds || !spotifyCreds.accessToken) {
    console.log("❌ ERROR: No Spotify token found in C:\\Users\\saraa\\AppData\\Roaming\\luniq-music\\config.json.");
    console.log("Please make sure you are logged into Spotify inside the Luniq app first!");
    return;
  }

  process.stdout.write("Testing [Spotify Native]... ");
  const start = Date.now();
  try {
    const res = await fetchSpotifyLyrics(testTrack.title, testTrack.artist, testTrack.duration, undefined, "7qiZfU4dY1lWllzX7mPBI3");
    const elapsed = Date.now() - start;
    if (res && (res.syncedLyrics || res.plainLyrics)) {
      console.log(`✅ SUCCESS (${elapsed}ms)`);
      const snippet = (res.syncedLyrics || res.plainLyrics).split('\n').slice(0, 5).join('\n');
      console.log(`\n=== Synced Lyrics Snippet ===\n${snippet}\n=============================\n`);
    } else {
      console.log(`❌ FAILED (${elapsed}ms) - No lyrics returned. Check if the song has lyrics on Spotify.`);
    }
  } catch (err: any) {
    console.log(`❌ ERROR (${Date.now() - start}ms) - ${err.message}`);
  }
}

testSpotify().catch(console.error);
