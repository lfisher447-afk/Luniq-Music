import { Innertube, Platform } from "youtubei.js";
import fs from "fs";
import { Readable } from "stream";

Platform.shim.eval = async (data: any) => {
  return new Function(data.output)();
};

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_SIZE = 200;

export class YoutubeiAudio {
  private youtube: Innertube | null = null;
  private initPromise: Promise<Innertube> | null = null;
  private urlCache = new Map<string, CacheEntry>();
  private cookiesPath: string = "";

  setCookiesPath(cookiesPath: string) {
    this.cookiesPath = cookiesPath;
  }

  setYtDlpInstance(_instance: any) {}

  private parseNetscapeCookies(filePath: string): string {
    try {
      if (!fs.existsSync(filePath)) return "";
      const lines = fs.readFileSync(filePath, "utf-8").split("\n");
      const cookies: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const parts = trimmed.split("\t");
        if (parts.length >= 7) {
          cookies.push(`${parts[5]}=${parts[6]}`);
        }
      }
      return cookies.join("; ");
    } catch (err) {
      console.warn("[Youtubei] Failed to parse Netscape cookies:", err);
      return "";
    }
  }

  private async getYoutubeInstance(): Promise<Innertube> {
    if (this.youtube) return this.youtube;
    if (this.initPromise) return this.initPromise;

    console.log("[Youtubei] Initializing Innertube...");
    const options: any = {};
    if (this.cookiesPath) {
      const cookie = this.parseNetscapeCookies(this.cookiesPath);
      if (cookie) {
        options.cookie = cookie;
      }
    }

    this.initPromise = Innertube.create(options)
      .then((instance) => {
        this.youtube = instance;
        return instance;
      })
      .catch((err) => {
        this.initPromise = null;
        console.error("[Youtubei] Failed to initialize Innertube:", err);
        throw err;
      });
    return this.initPromise;
  }

  private getCacheKey(
    trackName: string,
    artistName: string,
    quality?: string,
    formatExt?: string,
  ): string {
    return `${trackName.toLowerCase().trim()}::${artistName.toLowerCase().trim()}::${quality || "default"}::${formatExt || "default"}`;
  }

  private getCachedUrl(key: string): string | null {
    const entry = this.urlCache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.urlCache.delete(key);
      return null;
    }

    return entry.url;
  }

  private setCachedUrl(key: string, url: string): void {
    if (this.urlCache.size >= MAX_CACHE_SIZE) {
      const firstKey = this.urlCache.keys().next().value;
      if (firstKey) {
        console.log(
          `[Youtubei] Cache full. Evicting oldest entry: ${firstKey}`,
        );
        this.urlCache.delete(firstKey);
      }
    }

    this.urlCache.set(key, {
      url,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  async getStreamUrl(
    trackName: any,
    artistName: any,
    quality?: string,
    formatExt?: string,
    signal?: AbortSignal,
    _isPriority = false,
  ): Promise<string> {
    formatExt = "webm";
    const tName =
      typeof trackName === "string"
        ? trackName
        : trackName?.name || String(trackName || "unknown");
    const aName =
      typeof artistName === "string"
        ? artistName
        : artistName?.name || String(artistName || "unknown");
    const cacheKey = this.getCacheKey(tName, aName, quality, formatExt);

    const cachedUrl = this.getCachedUrl(cacheKey);
    if (cachedUrl) {
      console.log(`[Youtubei] Cache hit for "${tName}" by ${aName}`);
      return cachedUrl;
    }

    console.log(`[Youtubei] Fetching stream URL for "${tName}" by ${aName}...`);
    const query = `"${tName}" ${aName}`;

    try {
      if (signal?.aborted)
        throw Object.assign(new Error("AbortError"), { name: "AbortError" });

      const yt = await this.getYoutubeInstance();
      if (signal?.aborted)
        throw Object.assign(new Error("AbortError"), { name: "AbortError" });

      const searchResults = await yt.search(query, { type: "video" });
      if (!searchResults.videos || searchResults.videos.length === 0) {
        throw new Error(`No search results found for "${query}"`);
      }

      const firstVideo = searchResults.videos[0];
      const videoId = (firstVideo as any).id;

      if (!videoId) {
        throw new Error("Video ID not found in search result");
      }

      if (signal?.aborted)
        throw Object.assign(new Error("AbortError"), { name: "AbortError" });

      let videoInfo;
      try {
        console.log(
          `[Youtubei] Fetching video info with TV client for ID: ${videoId}`,
        );
        videoInfo = await yt.getInfo(videoId, { client: "TV" });
      } catch (tvErr) {
        console.warn(
          "[Youtubei] TV client getInfo failed, falling back to ANDROID:",
          tvErr,
        );
        try {
          videoInfo = await yt.getInfo(videoId, { client: "ANDROID" });
        } catch (androidErr) {
          console.warn(
            "[Youtubei] ANDROID client getInfo failed, falling back to WEB_REMIX (music):",
            androidErr,
          );
          try {
            videoInfo = await yt.music.getInfo(videoId);
          } catch (musicErr) {
            console.warn(
              "[Youtubei] WEB_REMIX music info failed, falling back to default:",
              musicErr,
            );
            videoInfo = await yt.getInfo(videoId);
          }
        }
      }

      if (signal?.aborted)
        throw Object.assign(new Error("AbortError"), { name: "AbortError" });

      let format;
      try {
        const adaptiveFormats =
          videoInfo.streaming_data?.adaptive_formats || [];
        const audioFormats = adaptiveFormats.filter(
          (f: any) => f.has_audio && !f.has_video,
        );

        if (audioFormats && audioFormats.length > 0) {
          let filtered = audioFormats;
          if (formatExt && formatExt !== "any" && formatExt !== "default") {
            filtered = audioFormats.filter((f: any) => {
              const mime = (f.mime_type || "").toLowerCase();
              return mime.includes(formatExt.toLowerCase());
            });
          }
          if (filtered.length === 0) {
            filtered = audioFormats;
          }

          if (quality && quality !== "default") {
            const targetBitrate = parseInt(quality, 10) * 1000;
            filtered.sort((a: any, b: any) => {
              const bitrateA = a.average_bitrate || a.bitrate || 128000;
              const bitrateB = b.average_bitrate || b.bitrate || 128000;
              return (
                Math.abs(bitrateA - targetBitrate) -
                Math.abs(bitrateB - targetBitrate)
              );
            });
            format = filtered[0];
          } else {
            filtered.sort((a: any, b: any) => {
              const bitrateA = a.average_bitrate || a.bitrate || 0;
              const bitrateB = b.average_bitrate || b.bitrate || 0;
              return bitrateB - bitrateA;
            });
            format = filtered[0];
          }
        }
      } catch (err) {
        console.warn(
          "[Youtubei] Custom format selection failed, falling back to chooseFormat:",
          err,
        );
      }

      if (!format) {
        format = videoInfo.chooseFormat({
          type: "audio",
          quality: "best",
        });
      }

      if (!format) {
        throw new Error("Failed to choose audio format");
      }

      const url = await format.decipher(yt.session.player);
      if (!url) {
        throw new Error("Stream URL is empty");
      }

      console.log(`[Youtubei] Resolved URL: ${url.slice(0, 100)}...`);
      this.setCachedUrl(cacheKey, url);
      return url;
    } catch (error: any) {
      if (signal?.aborted || error.name === "AbortError") {
        const abortError = new Error("AbortError");
        abortError.name = "AbortError";
        throw abortError;
      }
      console.error("[Youtubei] Error getting stream URL:", error);
      throw error;
    }
  }

  async downloadTrack(
    trackName: any,
    artistName: any,
    outputPath: string,
    quality?: string,
    formatExt?: string,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    formatExt = "webm";
    const tName =
      typeof trackName === "string"
        ? trackName
        : trackName?.name || String(trackName || "unknown");
    const aName =
      typeof artistName === "string"
        ? artistName
        : artistName?.name || String(artistName || "unknown");
    const query = `"${tName}" ${aName}`;

    console.log(
      `[Youtubei] Downloading "${tName}" by ${aName} to ${outputPath}...`,
    );

    try {
      if (signal?.aborted)
        throw Object.assign(new Error("AbortError"), { name: "AbortError" });

      const yt = await this.getYoutubeInstance();
      if (signal?.aborted)
        throw Object.assign(new Error("AbortError"), { name: "AbortError" });

      const searchResults = await yt.search(query, { type: "video" });
      if (!searchResults.videos || searchResults.videos.length === 0) {
        throw new Error(`No search results found for "${query}"`);
      }

      const videoId = (searchResults.videos[0] as any).id;
      if (!videoId) throw new Error("Video ID not found in search result");

      if (signal?.aborted)
        throw Object.assign(new Error("AbortError"), { name: "AbortError" });

      let videoInfo;
      try {
        console.log(
          `[Youtubei] Fetching video info with TV client for ID: ${videoId}`,
        );
        videoInfo = await yt.getInfo(videoId, { client: "TV" });
      } catch (tvErr) {
        console.warn(
          "[Youtubei] TV client getInfo failed, falling back to ANDROID:",
          tvErr,
        );
        try {
          videoInfo = await yt.getInfo(videoId, { client: "ANDROID" });
        } catch (androidErr) {
          console.warn(
            "[Youtubei] ANDROID client getInfo failed, falling back to WEB_REMIX (music):",
            androidErr,
          );
          try {
            videoInfo = await yt.music.getInfo(videoId);
          } catch (musicErr) {
            console.warn(
              "[Youtubei] WEB_REMIX music info failed, falling back to default:",
              musicErr,
            );
            videoInfo = await yt.getInfo(videoId);
          }
        }
      }

      if (signal?.aborted)
        throw Object.assign(new Error("AbortError"), { name: "AbortError" });

      let format;
      try {
        const adaptiveFormats =
          videoInfo.streaming_data?.adaptive_formats || [];
        const audioFormats = adaptiveFormats.filter(
          (f: any) => f.has_audio && !f.has_video,
        );

        if (audioFormats && audioFormats.length > 0) {
          let filtered = audioFormats;
          if (formatExt && formatExt !== "any" && formatExt !== "default") {
            filtered = audioFormats.filter((f: any) => {
              const mime = (f.mime_type || "").toLowerCase();
              return mime.includes(formatExt.toLowerCase());
            });
          }
          if (filtered.length === 0) {
            filtered = audioFormats;
          }

          if (quality && quality !== "default") {
            const targetBitrate = parseInt(quality, 10) * 1000;
            filtered.sort((a: any, b: any) => {
              const bitrateA = a.average_bitrate || a.bitrate || 128000;
              const bitrateB = b.average_bitrate || b.bitrate || 128000;
              return (
                Math.abs(bitrateA - targetBitrate) -
                Math.abs(bitrateB - targetBitrate)
              );
            });
            format = filtered[0];
          } else {
            filtered.sort((a: any, b: any) => {
              const bitrateA = a.average_bitrate || a.bitrate || 0;
              const bitrateB = b.average_bitrate || b.bitrate || 0;
              return bitrateB - bitrateA;
            });
            format = filtered[0];
          }
        }
      } catch (err) {
        console.warn(
          "[Youtubei] Custom download format selection failed:",
          err,
        );
      }

      if (!format) {
        format = videoInfo.chooseFormat({
          type: "audio",
          quality: "best",
        });
      }

      if (!format) throw new Error("No suitable audio format found");

      await format.decipher(yt.session.player);

      const contentLength = format.content_length
        ? Number(format.content_length)
        : 0;

      const stream = await videoInfo.download({
        type: "audio",
        itag: format.itag,
      });

      if (signal?.aborted)
        throw Object.assign(new Error("AbortError"), { name: "AbortError" });

      const writeStream = fs.createWriteStream(outputPath);
      let downloadedBytes = 0;

      const reader: any = (stream as any)[Symbol.asyncIterator]
        ? stream
        : Readable.from(stream as any);

      for await (const chunk of reader) {
        if (signal?.aborted) {
          writeStream.destroy();
          try {
            fs.unlinkSync(outputPath);
          } catch (e) {}
          throw Object.assign(new Error("AbortError"), { name: "AbortError" });
        }

        writeStream.write(chunk);
        downloadedBytes += chunk.length;

        if (onProgress && contentLength > 0) {
          const progress = (downloadedBytes / contentLength) * 100;
          onProgress(Math.min(100, Math.max(0, progress)));
        }
      }

      writeStream.end();
      return outputPath;
    } catch (error: any) {
      if (signal?.aborted || error.name === "AbortError") {
        const abortError = new Error("AbortError");
        abortError.name = "AbortError";
        throw abortError;
      }
      console.error("[Youtubei] Error downloading track:", error);
      throw error;
    }
  }

  async clearCache(): Promise<void> {
    this.urlCache.clear();
    console.log("[Youtubei] URL Cache cleared");
  }

  async update(): Promise<string> {
    console.log("[Youtubei] Update requested (no-op for youtubei)");
    return "youtubei.js is managed via npm packages.";
  }
}
