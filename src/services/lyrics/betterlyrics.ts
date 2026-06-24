import { LyricData } from './index';
import { extractTTML, convertTTMLToLRC } from './parser';

export const fetchBetterLyrics = async (
    trackName: string,
    artistName: string,
    duration?: number,
    albumName?: string
): Promise<LyricData | null> => {
    const cleanTrack = trackName.trim();
    const cleanArtist = artistName.trim();
    if (!cleanTrack || !cleanArtist) return null;

    const endpoints = [
        "https://lyrics-api.boidu.dev/getLyrics",
        "https://lyrics-api.boidu.dev/kugou/getLyrics"
    ];

    for (const endpoint of endpoints) {
        try {
            const params = new URLSearchParams({
                s: cleanTrack,
                a: cleanArtist,
            });
            if (albumName) {
                params.append("al", albumName.trim());
            }
            if (duration && duration > 0) {
                params.append("d", Math.round(duration).toString());
            }

            const response = await fetch(`${endpoint}?${params.toString()}`);
            if (response.ok) {
                const text = await response.text();
                const ttml = extractTTML(text);
                if (ttml) {
                    const { plain, synced, plainRom, syncedRom } = convertTTMLToLRC(ttml);
                    if (plain || synced) {
                        return {
                            id: Date.now(),
                            name: cleanTrack,
                            trackName: cleanTrack,
                            artistName: cleanArtist,
                            albumName: albumName || "",
                            duration: duration || 0,
                            instrumental: false,
                            plainLyrics: plain,
                            syncedLyrics: synced,
                            romanizedLyrics: synced ? (syncedRom || undefined) : (syncedRom || plainRom)
                        };
                    }
                }
            }
        } catch (e) {
            console.warn(`[Lyrics] BetterLyrics endpoint failed (${endpoint}):`, e);
        }
    }
    return null;
};
