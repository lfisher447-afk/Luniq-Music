import { LyricData } from './index';
import { convertTTMLToLRC } from './parser';

export const fetchPaxsenixLyrics = async (
    trackName: string,
    artistName: string,
    duration?: number,
    albumName?: string
): Promise<LyricData | null> => {
    const cleanTrack = trackName.trim();
    const cleanArtist = artistName.trim();
    if (!cleanTrack || !cleanArtist) return null;

    try {
        const query = `${cleanTrack} ${cleanArtist}`;
        const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=10`;
        
        const searchRes = await fetch(searchUrl);
        if (!searchRes.ok) return null;

        const searchData = await searchRes.json();
        const songs = searchData?.results;
        
        if (!songs || !Array.isArray(songs) || songs.length === 0) return null;

        let bestMatch = songs[0];
        if (duration && duration > 0 && songs.length > 1) {
            const durationMs = duration * 1000;
            bestMatch = songs.reduce((prev: any, curr: any) => {
                const prevDiff = Math.abs((prev.trackTimeMillis || 0) - durationMs);
                const currDiff = Math.abs((curr.trackTimeMillis || 0) - durationMs);
                return currDiff < prevDiff ? curr : prev;
            });
        }

        const songId = bestMatch.trackId;
        if (!songId) return null;

        const paxsenixUrl = `https://lyrics.paxsenix.org/apple-music/lyrics?id=${songId}&ttml=true`;
        
        const lyricsRes = await fetch(paxsenixUrl, {
            headers: {
                "User-Agent": "Lune-Music",
                "Accept": "application/json, text/plain, */*"
            }
        });

        if (!lyricsRes.ok) return null;

        const rawBody = await lyricsRes.text();
        let ttmlContent = "";

        if (rawBody.startsWith("<tt") || rawBody.startsWith("<?xml")) {
            ttmlContent = rawBody;
        } else {
            const data = JSON.parse(rawBody);
            if (data.content && (data.content.includes("<tt") || data.content.includes("<?xml"))) {
                ttmlContent = data.content;
            }
        }

        if (!ttmlContent) return null;

        const { plain, synced } = convertTTMLToLRC(ttmlContent);

        if (!plain && !synced) return null;

        return {
            id: Date.now(),
            name: cleanTrack,
            trackName: bestMatch.trackName || cleanTrack,
            artistName: bestMatch.artistName || cleanArtist,
            albumName: bestMatch.collectionName || albumName || "",
            duration: bestMatch.trackTimeMillis ? Math.floor(bestMatch.trackTimeMillis / 1000) : (duration || 0),
            instrumental: false,
            plainLyrics: plain,
            syncedLyrics: synced,
        };

    } catch (e) {
        console.warn(`[Lyrics] Paxsenix endpoint failed:`, e);
        return null;
    }
};
