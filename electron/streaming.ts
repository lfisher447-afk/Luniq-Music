import { app } from 'electron';
import path from 'path';
import { YoutubeiAudio } from '../Plugin/youtubei-audio.js';

export const ytDlp = new YoutubeiAudio();
export const activeSearches = new Map<string, { 
    controller: AbortController; 
    promise: Promise<string>;
    requesters: Set<string>;
}>();
export const activeDownloads = new Map<string, AbortController>();

const ytCookiesPath = path.join(app.getPath('userData'), 'yt-cookies.txt');
ytDlp.setCookiesPath(ytCookiesPath);
