import { LyricData } from './index';

export const fetchLrcLibLyrics = async (
    cleanTrackName: string,
    primaryArtist: string,
    duration?: number
): Promise<LyricData | null> => {
    const tryFetch = async (useDuration: boolean): Promise<LyricData | null> => {
        try {
            const params = new URLSearchParams({
                track_name: cleanTrackName,
                artist_name: primaryArtist,
            });
            
            if (useDuration && duration) {
                params.append('duration', Math.round(duration).toString());
            }

            const response = await fetch(`https://lrclib.net/api/get?${params.toString()}`);
            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            console.warn("[Lyrics] LRCLib API call failed:", e);
        }
        return null;
    };

    try {
        let data = await tryFetch(true);
        if (!data && duration) {
            console.log(`[Lyrics] LRCLib duration match failed, trying without duration...`);
            data = await tryFetch(false);
        }
        if (data) return data;

        console.log(`[Lyrics] LRCLib exact match failed, trying search fallback for: ${cleanTrackName} ${primaryArtist}`);
        const searchParams = new URLSearchParams({
            q: `${cleanTrackName} ${primaryArtist}`
        });

        const searchResponse = await fetch(`https://lrclib.net/api/search?${searchParams.toString()}`);
        if (searchResponse.ok) {
            const results = await searchResponse.json();
            if (Array.isArray(results) && results.length > 0) {
                const bestMatch = results.find(r => r.syncedLyrics) || results.find(r => r.plainLyrics) || results[0];
                return bestMatch;
            }
        }
    } catch (e) {
        console.error('[Lyrics] Error fetching lyrics from LRCLib:', e);
    }
    return null;
};
