import { LyricData } from './index';

const decodeBase64Utf8 = (base64: string): string => {
    const binString = atob(base64);
    const bytes = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) {
        bytes[i] = binString.charCodeAt(i);
    }
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
};

export const fetchKugouLyrics = async (
    trackName: string,
    artistName: string,
    duration?: number,
    albumName?: string
): Promise<LyricData | null> => {
    const cleanTrack = trackName.trim();
    const cleanArtist = artistName.trim();
    if (!cleanTrack || !cleanArtist) return null;

    try {
        const keyword = `${cleanTrack} - ${cleanArtist}`;
        const searchUrl = `https://mobileservice.kugou.com/api/v3/search/song?version=9108&plat=0&pagesize=8&showtype=0&keyword=${encodeURIComponent(keyword)}`;
        
        const searchRes = await fetch(searchUrl);
        if (!searchRes.ok) return null;
        const searchData = await searchRes.json();

        if (!searchData.data || !searchData.data.info || searchData.data.info.length === 0) {
            return null;
        }

        const hash = searchData.data.info[0].hash;
        
        const lyricsSearchUrl = `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&hash=${hash}`;
        const lyricsSearchRes = await fetch(lyricsSearchUrl);
        if (!lyricsSearchRes.ok) return null;
        const lyricsSearchData = await lyricsSearchRes.json();

        if (!lyricsSearchData.candidates || lyricsSearchData.candidates.length === 0) {
            return null;
        }

        const candidate = lyricsSearchData.candidates[0];
        const downloadUrl = `https://lyrics.kugou.com/download?fmt=lrc&charset=utf8&client=pc&ver=1&id=${candidate.id}&accesskey=${candidate.accesskey}`;
        
        const downloadRes = await fetch(downloadUrl);
        if (!downloadRes.ok) return null;
        const downloadData = await downloadRes.json();

        if (!downloadData.content) {
            return null;
        }

        const decoded = decodeBase64Utf8(downloadData.content);
        const hasTimestamps = /\[\d{2}:\d{2}\.\d{2,3}\]/.test(decoded);

        return {
            id: Date.now(),
            name: cleanTrack,
            trackName: cleanTrack,
            artistName: cleanArtist,
            albumName: albumName || "",
            duration: duration || 0,
            instrumental: false,
            plainLyrics: hasTimestamps ? "" : decoded,
            syncedLyrics: hasTimestamps ? decoded : "",
        };

    } catch (e) {
        console.warn(`[Lyrics] KuGou endpoint failed:`, e);
        return null;
    }
};
