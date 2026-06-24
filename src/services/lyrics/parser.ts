export interface LyricLine {
    time: number;
    text: string;
    romanizedText?: string;
}

export const parseTimeToSeconds = (timeStr: string): number => {
    timeStr = timeStr.trim();
    if (timeStr.endsWith('ms')) {
        return parseFloat(timeStr.slice(0, -2)) / 1000;
    }
    if (timeStr.endsWith('s')) {
        return parseFloat(timeStr.slice(0, -1));
    }
    
    const parts = timeStr.split(':');
    if (parts.length === 3) {
        const hrs = parseFloat(parts[0]);
        const mins = parseFloat(parts[1]);
        const secs = parseFloat(parts[2]);
        return hrs * 3600 + mins * 60 + secs;
    } else if (parts.length === 2) {
        const mins = parseFloat(parts[0]);
        const secs = parseFloat(parts[1]);
        return mins * 60 + secs;
    }
    
    const parsed = parseFloat(timeStr);
    return isNaN(parsed) ? 0 : parsed;
};

export const secondsToLrcTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    
    const minsStr = mins.toString().padStart(2, '0');
    const secsStr = secs.toString().padStart(2, '0');
    const msStr = ms.toString().padStart(2, '0');
    
    return `[${minsStr}:${secsStr}.${msStr}]`;
};

const getAttributeBySuffix = (el: Element, suffix: string): string => {
    const direct = el.getAttribute(suffix);
    if (direct) return direct;
    if (el.attributes) {
        for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            if (attr.name.toLowerCase() === suffix.toLowerCase() || attr.name.toLowerCase().endsWith(':' + suffix.toLowerCase())) {
                return attr.value;
            }
        }
    }
    return '';
};

export const convertTTMLToLRC = (ttmlText: string): { 
    plain: string; 
    synced: string;
    plainRom?: string;
    syncedRom?: string;
} => {
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(ttmlText, "application/xml");
        
        const parserError = xmlDoc.querySelector("parsererror");
        if (parserError) {
            console.error("[Lyrics] DOMParser error parsing TTML:", parserError.textContent);
            return { plain: ttmlText, synced: "" };
        }
        
        const transliterations = xmlDoc.getElementsByTagName("transliteration");
        const romMap: Record<string, string> = {};
        for (let i = 0; i < transliterations.length; i++) {
            const trans = transliterations[i];
            const lang = getAttributeBySuffix(trans, "lang") || "";
            if (lang.toLowerCase().includes("latn")) {
                const texts = trans.getElementsByTagName("text");
                for (let j = 0; j < texts.length; j++) {
                    const txt = texts[j];
                    const key = getAttributeBySuffix(txt, "for");
                    if (key) {
                        romMap[key] = txt.textContent?.trim() || "";
                    }
                }
            }
        }
        
        const paragraphs = xmlDoc.getElementsByTagName("p");
        const plainLines: string[] = [];
        const syncedLines: string[] = [];
        const plainRomLines: string[] = [];
        const syncedRomLines: string[] = [];
        let hasRom = false;
        
        for (let i = 0; i < paragraphs.length; i++) {
            const p = paragraphs[i];
            const begin = p.getAttribute("begin");
            const text = p.textContent?.trim() || "";
            const key = getAttributeBySuffix(p, "key");
            const romText = key ? romMap[key] : "";
            
            if (text) {
                plainLines.push(text);
                plainRomLines.push(romText || "");
                if (romText) hasRom = true;
                
                if (begin) {
                    const secs = parseTimeToSeconds(begin);
                    const lrcTime = secondsToLrcTime(secs);
                    syncedLines.push(`${lrcTime} ${text}`);
                    if (romText) {
                        syncedRomLines.push(`${lrcTime} ${romText}`);
                    }
                }
            }
        }
        
        return {
            plain: plainLines.join('\n'),
            synced: syncedLines.join('\n'),
            plainRom: hasRom ? plainRomLines.join('\n') : undefined,
            syncedRom: hasRom ? syncedRomLines.join('\n') : undefined
        };
    } catch (e) {
        console.error("[Lyrics] Failed to parse TTML:", e);
        return { plain: "", synced: "" };
    }
};

export const extractTTML = (responseText: string): string => {
    const trimmed = responseText.trim();
    if (trimmed.startsWith("<")) {
        return trimmed;
    }
    try {
        const parsed = JSON.parse(trimmed);
        return parsed.ttml || parsed.lyrics || "";
    } catch (e) {
        return "";
    }
};

export const parseSyncedLyrics = (lrc: string): LyricLine[] => {
    if (!lrc) return [];
    
    const lines = lrc.split('\n');
    const result: LyricLine[] = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
    
    lines.forEach(line => {
        const match = line.match(timeRegex);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const milliseconds = parseInt(match[3]);
            
            const msFactor = match[3].length === 2 ? 10 : 1;
            const time = minutes * 60 + seconds + (milliseconds * msFactor) / 1000;
            
            const text = line.replace(timeRegex, '').trim();
            if (text) {
                result.push({ time, text });
            }
        }
    });
    
    return result.sort((a, b) => a.time - b.time);
};
