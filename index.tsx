/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2025 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./style.css";

import { get as DataStoreGet, set as DataStoreSet } from "@api/DataStore";
import { BaseText } from "@components/BaseText";
import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { PluginNative } from "@utils/types";
import { User } from "@vencord/discord-types";
import { findCssClassesLazy } from "@webpack";
import { Button, Forms, React, ScrollerThin, Text, TextInput, Toasts, useCallback, useEffect, UserStore, useState } from "@webpack/common";

const Native = VencordNative.pluginHelpers.SuperBoard as PluginNative<typeof import("./native")>;

const ProfileListClasses = findCssClassesLazy("empty", "textContainer", "connectionIcon");
const TabBarClasses = findCssClassesLazy("tabPanelScroller", "tabBarPanel");

// ==================== Constants ====================

const STORE_KEY_MUSIC = "FavMusic_favorites";
const STORE_KEY_MUSIC_TOKEN = "FavMusic_syncToken";
const STORE_KEY_FAV = "FavAnime_favorites";
const STORE_KEY_HATE = "FavAnime_hated";
const STORE_KEY_ANIME_TOKEN = "FavAnime_syncToken";
const logger = new Logger("SuperBoard");

type ListMode = "fav" | "hate";

// ==================== Types ====================

interface MusicData {
    id: number;
    title: string;
    artist_name: string;
    album_title: string;
    cover_small: string;
    cover_medium: string;
    cover_big: string;
    preview_url: string;
    duration: number;
    link: string;
}

interface AnimeData {
    mal_id: number;
    title: string;
    title_english: string | null;
    images: {
        jpg: {
            image_url: string;
            small_image_url: string;
            large_image_url: string;
        };
    };
    score: number | null;
    episodes: number | null;
    type: string;
    status: string;
    synopsis: string | null;
    year: number | null;
    genres: Array<{ mal_id: number; name: string; }>;
}

// ==================== Music Data Layer ====================

let cachedMusic: MusicData[] = [];

function slimMusic(m: MusicData): MusicData {
    return {
        id: m.id,
        title: m.title,
        artist_name: m.artist_name,
        album_title: m.album_title,
        cover_small: m.cover_small,
        cover_medium: m.cover_medium,
        cover_big: m.cover_big,
        preview_url: m.preview_url,
        duration: m.duration,
        link: m.link,
    };
}

async function loadMusic(): Promise<MusicData[]> {
    try {
        const data = await DataStoreGet(STORE_KEY_MUSIC) as MusicData[] | undefined;
        cachedMusic = data ?? [];
    } catch (e) {
        logger.error("Failed to load music:", e);
        cachedMusic = [];
    }
    return cachedMusic;
}

async function addMusic(music: MusicData) {
    if (cachedMusic.some(m => m.id === music.id)) return;
    cachedMusic = [...cachedMusic, music];
    await DataStoreSet(STORE_KEY_MUSIC, cachedMusic);
    scheduleMusicSync();
}

async function removeMusic(id: number) {
    cachedMusic = cachedMusic.filter(m => m.id !== id);
    await DataStoreSet(STORE_KEY_MUSIC, cachedMusic);
    scheduleMusicSync();
}

// ==================== Anime Data Layer ====================

let cachedFavorites: AnimeData[] = [];
let cachedHated: AnimeData[] = [];

function slimAnime(a: AnimeData): AnimeData {
    return {
        mal_id: a.mal_id,
        title: a.title,
        title_english: a.title_english,
        images: { jpg: { image_url: a.images.jpg.image_url, small_image_url: a.images.jpg.small_image_url, large_image_url: a.images.jpg.large_image_url } },
        score: a.score,
        episodes: a.episodes,
        type: a.type,
        status: a.status,
        synopsis: null,
        year: a.year,
        genres: [],
    };
}

async function loadFavorites(): Promise<AnimeData[]> {
    try {
        const data = await DataStoreGet(STORE_KEY_FAV) as AnimeData[] | undefined;
        cachedFavorites = data ?? [];
    } catch (e) {
        logger.error("Failed to load favorites:", e);
        cachedFavorites = [];
    }
    return cachedFavorites;
}

async function loadHated(): Promise<AnimeData[]> {
    try {
        const data = await DataStoreGet(STORE_KEY_HATE) as AnimeData[] | undefined;
        cachedHated = data ?? [];
    } catch (e) {
        logger.error("Failed to load hated:", e);
        cachedHated = [];
    }
    return cachedHated;
}

async function addFavorite(anime: AnimeData) {
    if (cachedFavorites.some(f => f.mal_id === anime.mal_id)) return;
    cachedFavorites = [...cachedFavorites, anime];
    await DataStoreSet(STORE_KEY_FAV, cachedFavorites);
    scheduleAnimeSync();
}

async function removeFavorite(malId: number) {
    cachedFavorites = cachedFavorites.filter(f => f.mal_id !== malId);
    await DataStoreSet(STORE_KEY_FAV, cachedFavorites);
    scheduleAnimeSync();
}

async function addHated(anime: AnimeData) {
    if (cachedHated.some(f => f.mal_id === anime.mal_id)) return;
    cachedHated = [...cachedHated, anime];
    await DataStoreSet(STORE_KEY_HATE, cachedHated);
    scheduleAnimeSync();
}

async function removeHated(malId: number) {
    cachedHated = cachedHated.filter(f => f.mal_id !== malId);
    await DataStoreSet(STORE_KEY_HATE, cachedHated);
    scheduleAnimeSync();
}

// ==================== Remote Caches ====================

const REMOTE_CACHE_MAX = 200;
const REMOTE_CACHE_TTL = 120_000; // 2 minutes

const remoteMusicCache = new Map<string, { music: MusicData[]; fetchedAt: number; }>();
function remoteMusicCacheSet(userId: string, value: { music: MusicData[]; fetchedAt: number; }) {
    if (remoteMusicCache.size >= REMOTE_CACHE_MAX) remoteMusicCache.delete(remoteMusicCache.keys().next().value!);
    remoteMusicCache.set(userId, value);
}

const remoteAnimeCache = new Map<string, { favs: AnimeData[]; hated: AnimeData[]; fetchedAt: number; }>();
function remoteAnimeCacheSet(userId: string, value: { favs: AnimeData[]; hated: AnimeData[]; fetchedAt: number; }) {
    if (remoteAnimeCache.size >= REMOTE_CACHE_MAX) remoteAnimeCache.delete(remoteAnimeCache.keys().next().value!);
    remoteAnimeCache.set(userId, value);
}

// ==================== Music Server Sync ====================

let musicSyncToken: string | null = null;
let musicSyncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleMusicSync() {
    if (musicSyncTimer) clearTimeout(musicSyncTimer);
    musicSyncTimer = setTimeout(() => { musicSyncTimer = null; syncMusicToServer().catch(() => { }); }, 2000);
}

async function loadMusicSyncToken(): Promise<string> {
    if (musicSyncToken) return musicSyncToken;
    let token = await DataStoreGet(STORE_KEY_MUSIC_TOKEN) as string | undefined;
    if (!token) {
        const arr = new Uint8Array(24);
        crypto.getRandomValues(arr);
        token = Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
        await DataStoreSet(STORE_KEY_MUSIC_TOKEN, token);
    }
    musicSyncToken = token;
    return token;
}

async function syncMusicToServer(): Promise<boolean> {
    try {
        const token = await loadMusicSyncToken();
        const userId = UserStore.getCurrentUser()?.id;
        if (!userId) return false;
        const result = await Native.syncMusicList(userId, token, cachedMusic.map(slimMusic));
        if (!result.success) { logger.error("Music sync failed:", result.error); return false; }
        return true;
    } catch (e) { logger.error("Music sync exception:", e); return false; }
}

async function fetchRemoteMusicList(userId: string): Promise<{ music: MusicData[]; } | null> {
    const cached = remoteMusicCache.get(userId);
    if (cached && Date.now() - cached.fetchedAt < REMOTE_CACHE_TTL) return cached;
    try {
        const data = await Native.fetchMusicList(userId);
        const music: MusicData[] = data.favorites ?? [];
        if (music.length === 0) return null;
        const result = { music, fetchedAt: Date.now() };
        remoteMusicCacheSet(userId, result);
        return result;
    } catch (e) { logger.error(`Failed to fetch remote music for ${userId}:`, e); return null; }
}

// ==================== Anime Server Sync ====================

let animeSyncToken: string | null = null;
let animeSyncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAnimeSync() {
    if (animeSyncTimer) clearTimeout(animeSyncTimer);
    animeSyncTimer = setTimeout(() => { animeSyncTimer = null; syncAnimeToServer().catch(() => { }); }, 2000);
}

async function loadAnimeSyncToken(): Promise<string> {
    if (animeSyncToken) return animeSyncToken;
    let token = await DataStoreGet(STORE_KEY_ANIME_TOKEN) as string | undefined;
    if (!token) {
        const arr = new Uint8Array(24);
        crypto.getRandomValues(arr);
        token = Array.from(arr, b => b.toString(16).padStart(2, "0")).join("");
        await DataStoreSet(STORE_KEY_ANIME_TOKEN, token);
    }
    animeSyncToken = token;
    return token;
}

async function syncAnimeToServer(): Promise<boolean> {
    try {
        const token = await loadAnimeSyncToken();
        const userId = UserStore.getCurrentUser()?.id;
        if (!userId) return false;
        const result = await Native.syncAnimeList(userId, token, cachedFavorites.map(slimAnime), cachedHated.map(slimAnime));
        if (!result.success) { logger.error("Anime sync failed:", result.error); return false; }
        return true;
    } catch (e) { logger.error("Anime sync exception:", e); return false; }
}

async function fetchRemoteAnimeList(userId: string): Promise<{ favs: AnimeData[]; hated: AnimeData[]; } | null> {
    const cached = remoteAnimeCache.get(userId);
    if (cached && Date.now() - cached.fetchedAt < REMOTE_CACHE_TTL) return cached;
    try {
        const data = await Native.fetchAnimeList(userId);
        const favs: AnimeData[] = data.favorites ?? [];
        const hated: AnimeData[] = data.hated ?? [];
        if (favs.length === 0 && hated.length === 0) return null;
        const result = { favs, hated, fetchedAt: Date.now() };
        remoteAnimeCacheSet(userId, result);
        return result;
    } catch (e) { logger.error(`Failed to fetch remote anime for ${userId}:`, e); return null; }
}

// ==================== Search ====================

async function searchMusicItunes(query: string): Promise<MusicData[]> {
    if (!query.trim()) return [];
    try {
        return (await Native.searchMusic(query) ?? []) as MusicData[];
    } catch (e) { logger.error("Music search failed:", e); return []; }
}

async function searchAnimeJikan(query: string): Promise<AnimeData[]> {
    if (!query.trim()) return [];
    try {
        return (await Native.searchAnime(query) ?? []) as AnimeData[];
    } catch (e) { logger.error("Anime search failed:", e); return []; }
}

async function fetchMALUserFavorites(username: string): Promise<AnimeData[]> {
    if (!username.trim()) return [];
    try {
        return (await Native.fetchUserFavorites(username) ?? []) as AnimeData[];
    } catch (e) { logger.error("MAL user favorites fetch failed:", e); return []; }
}

// ==================== Helpers ====================

function useDebounce<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// ==================== Audio Player ====================

let globalAudio: HTMLAudioElement | null = null;
let globalPlayingId: number | null = null;
const audioListeners = new Set<() => void>();

function notifyAudioListeners() { audioListeners.forEach(fn => fn()); }

const AUDIO_BLOB_CACHE_MAX = 50;
const audioBlobCache = new Map<string, string>();

async function fetchAudioBlob(previewUrl: string): Promise<string> {
    const cached = audioBlobCache.get(previewUrl);
    if (cached) return cached;
    try {
        const dataUri = await Native.fetchAudio(previewUrl);
        if (!dataUri) return "";
        const [header, b64] = dataUri.split(",", 2);
        const mime = header.split(":")[1]?.split(";")[0] || "audio/mpeg";
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        if (audioBlobCache.size >= AUDIO_BLOB_CACHE_MAX) {
            const oldest = audioBlobCache.keys().next().value!;
            URL.revokeObjectURL(audioBlobCache.get(oldest)!);
            audioBlobCache.delete(oldest);
        }
        audioBlobCache.set(previewUrl, blobUrl);
        return blobUrl;
    } catch {
        return "";
    }
}

function togglePreview(previewUrl: string, trackId: number) {
    if (globalAudio) {
        const wasSameTrack = globalPlayingId === trackId;
        globalAudio.pause();
        globalAudio.src = "";
        globalAudio = null;
        globalPlayingId = null;
        notifyAudioListeners();
        if (wasSameTrack) return;
    }
    globalPlayingId = trackId;
    notifyAudioListeners();
    fetchAudioBlob(previewUrl).then(blobUrl => {
        if (globalPlayingId !== trackId) return;
        if (!blobUrl) { globalPlayingId = null; notifyAudioListeners(); return; }
        const audio = new Audio(blobUrl);
        globalAudio = audio;
        audio.volume = 0.5;
        audio.play().catch(() => { globalAudio = null; globalPlayingId = null; notifyAudioListeners(); });
        audio.addEventListener("ended", () => { globalAudio = null; globalPlayingId = null; notifyAudioListeners(); });
        notifyAudioListeners();
    });
}

function stopAllAudio() {
    if (globalAudio) { globalAudio.pause(); globalAudio.src = ""; globalAudio = null; globalPlayingId = null; notifyAudioListeners(); }
}

function useAudioPlaying(trackId: number): boolean {
    const [playing, setPlaying] = useState(globalPlayingId === trackId);
    useEffect(() => {
        const listener = () => setPlaying(globalPlayingId === trackId);
        audioListeners.add(listener);
        return () => { audioListeners.delete(listener); };
    }, [trackId]);
    return playing;
}

// ==================== Components ====================

const IMAGE_CACHE_MAX = 150;
const imageCache = new Map<string, string>();
function imageCacheSet(key: string, value: string) {
    if (imageCache.size >= IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value!);
    imageCache.set(key, value);
}

const imageInflight = new Map<string, Promise<string>>();

function ProxiedImage({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
    const [dataUrl, setDataUrl] = useState<string>(imageCache.get(src ?? "") ?? "");
    useEffect(() => {
        if (!src) return;
        const cached = imageCache.get(src);
        if (cached) { setDataUrl(cached); return; }
        let promise = imageInflight.get(src);
        if (!promise) {
            promise = Native.fetchImage(src).catch(() => "");
            imageInflight.set(src, promise);
            promise.finally(() => imageInflight.delete(src));
        }
        let cancelled = false;
        promise.then(result => { if (!cancelled && result) { imageCacheSet(src, result); setDataUrl(result); } });
        return () => { cancelled = true; };
    }, [src]);
    if (!dataUrl) return <div style={{ width: "100%", height: "100%", background: "var(--background-secondary)" }} />;
    return <img src={dataUrl} alt={alt} {...props} />;
}

function MusicCard({ music, onAdd, onRemove, added, compact }: {
    music: MusicData;
    onAdd?: () => void;
    onRemove?: () => void;
    added?: boolean;
    compact?: boolean;
}) {
    const playing = useAudioPlaying(music.id);
    const imgUrl = compact ? music.cover_medium : (music.cover_big || music.cover_medium);
    return (
        <div className={`vc-superboard-card${compact ? " vc-superboard-card-compact" : ""}`}
            onClick={() => window.open(music.link, "_blank", "noopener,noreferrer")}>
            <div className="vc-superboard-card-poster">
                <ProxiedImage src={imgUrl} alt={music.title} loading="eager" />
                {music.preview_url && (
                    <button className={`vc-superboard-btn-play${playing ? " vc-superboard-btn-playing" : ""}`}
                        onClick={e => { e.stopPropagation(); togglePreview(music.preview_url, music.id); }}
                        title={playing ? "Stop preview" : "Play 30s preview"}>
                        {playing ? "⏸" : "▶"}
                    </button>
                )}
                {onRemove && (
                    <button className="vc-superboard-btn-remove"
                        onClick={e => { e.stopPropagation(); onRemove(); }} title="Remove">✕</button>
                )}
                {onAdd && (
                    <button className={`vc-superboard-btn-add${added ? " vc-superboard-btn-added" : ""}`}
                        onClick={e => { e.stopPropagation(); if (!added) onAdd(); }}
                        title={added ? "Already added" : "Add to favorites"}>
                        {added ? "✓" : "+"}
                    </button>
                )}
            </div>
            <div className="vc-superboard-card-info">
                <span className="vc-superboard-card-title" title={music.title}>{music.title}</span>
                <span className="vc-superboard-card-meta">
                    {music.artist_name}{music.duration ? ` · ${formatDuration(music.duration)}` : ""}
                </span>
            </div>
        </div>
    );
}

function AnimeCard({ anime, onAdd, onRemove, added, compact, hate }: {
    anime: AnimeData;
    onAdd?: () => void;
    onRemove?: () => void;
    added?: boolean;
    compact?: boolean;
    hate?: boolean;
}) {
    const title = anime.title_english || anime.title;
    const imgUrl = compact
        ? anime.images.jpg.image_url
        : (anime.images.jpg.large_image_url || anime.images.jpg.image_url);
    return (
        <div className={`vc-superboard-card${compact ? " vc-superboard-card-compact" : ""}${hate ? " vc-superboard-card-hate" : ""}`}
            onClick={() => window.open(`https://myanimelist.net/anime/${anime.mal_id}`, "_blank", "noopener,noreferrer")}>
            <div className="vc-superboard-card-poster vc-superboard-poster-anime">
                <ProxiedImage src={imgUrl} alt={title} loading="eager" />
                {!hate && anime.score != null && anime.score > 0 && (
                    <span className="vc-superboard-badge-score">★ {anime.score}</span>
                )}
                {onRemove && (
                    <button className="vc-superboard-btn-remove"
                        onClick={e => { e.stopPropagation(); onRemove(); }} title="Remove">✕</button>
                )}
                {onAdd && (
                    <button className={`vc-superboard-btn-add${hate ? " vc-superboard-btn-add-hate" : ""}${added ? " vc-superboard-btn-added" : ""}`}
                        onClick={e => { e.stopPropagation(); if (!added) onAdd(); }}
                        title={added ? "Already added" : (hate ? "Add to hate list" : "Add to favorites")}>
                        {added ? "✓" : (hate ? "💔" : "+")}
                    </button>
                )}
            </div>
            <div className="vc-superboard-card-info">
                <span className="vc-superboard-card-title" title={title}>{title}</span>
                <span className="vc-superboard-card-meta">
                    {anime.type ?? "?"}{anime.episodes ? ` · ${anime.episodes} Ep` : ""}{anime.year ? ` · ${anime.year}` : ""}
                </span>
            </div>
        </div>
    );
}

// ==================== Music Search Modal ====================

function MusicSearchModal({ rootProps, onChanged }: { rootProps: any; onChanged: () => void; }) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<MusicData[]>([]);
    const [loading, setLoading] = useState(false);
    const [addedIds, setAddedIds] = useState<Set<number>>(new Set(cachedMusic.map(m => m.id)));
    const debouncedQuery = useDebounce(query, 400);

    useEffect(() => {
        if (!debouncedQuery.trim()) { setResults([]); return; }
        let cancelled = false;
        setLoading(true);
        searchMusicItunes(debouncedQuery).then(data => { if (!cancelled) { setResults(data); setLoading(false); } });
        return () => { cancelled = true; };
    }, [debouncedQuery]);

    useEffect(() => () => stopAllAudio(), []);

    const handleAdd = useCallback(async (music: MusicData) => {
        await addMusic(music);
        setAddedIds(new Set(cachedMusic.map(m => m.id)));
        onChanged();
    }, [onChanged]);

    return (
        <ModalRoot {...rootProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>🎵 Search Music — iTunes</Text>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <div className="vc-superboard-search-container">
                    <TextInput placeholder="Search for songs, artists, or albums..." value={query} onChange={setQuery} autoFocus />
                    {loading && (
                        <div className="vc-superboard-loading">
                            <div className="vc-superboard-spinner" />
                            <Text variant="text-md/medium">Searching...</Text>
                        </div>
                    )}
                    {!loading && results.length === 0 && debouncedQuery.trim() && (
                        <div className="vc-superboard-empty">
                            <Text variant="text-md/medium">No results for &quot;{debouncedQuery}&quot;</Text>
                        </div>
                    )}
                    {!loading && !debouncedQuery.trim() && (
                        <div className="vc-superboard-empty">
                            <div className="vc-superboard-empty-icon">🔍</div>
                            <Text variant="text-md/medium" style={{ color: "var(--text-muted)" }}>
                                Type above to find your favorite music
                            </Text>
                        </div>
                    )}
                    {!loading && results.length > 0 && (
                        <div className="vc-superboard-search-grid">
                            {results.map(music => (
                                <MusicCard key={music.id} music={music} onAdd={() => handleAdd(music)} added={addedIds.has(music.id)} />
                            ))}
                        </div>
                    )}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

function openMusicSearchModal(onChanged: () => void) {
    openModal(props => <MusicSearchModal rootProps={props} onChanged={onChanged} />);
}

// ==================== Anime Search Modal ====================

function AnimeSearchModal({ rootProps, onChanged, mode }: { rootProps: any; onChanged: () => void; mode: ListMode; }) {
    const isHate = mode === "hate";
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<AnimeData[]>([]);
    const [loading, setLoading] = useState(false);
    const [addedIds, setAddedIds] = useState<Set<number>>(
        new Set((isHate ? cachedHated : cachedFavorites).map(f => f.mal_id))
    );
    const debouncedQuery = useDebounce(query, 400);

    useEffect(() => {
        if (!debouncedQuery.trim()) { setResults([]); return; }
        let cancelled = false;
        setLoading(true);
        searchAnimeJikan(debouncedQuery).then(data => { if (!cancelled) { setResults(data); setLoading(false); } });
        return () => { cancelled = true; };
    }, [debouncedQuery]);

    const handleAdd = useCallback(async (anime: AnimeData) => {
        if (isHate) {
            await addHated(anime);
            setAddedIds(new Set(cachedHated.map(f => f.mal_id)));
        } else {
            await addFavorite(anime);
            setAddedIds(new Set(cachedFavorites.map(f => f.mal_id)));
        }
        onChanged();
    }, [isHate, onChanged]);

    return (
        <ModalRoot {...rootProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>
                    {isHate ? "💔 Add to Hate List" : "Search Anime — MyAnimeList"}
                </Text>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <div className="vc-superboard-search-container">
                    <TextInput
                        placeholder={isHate ? "Find an anime you hate..." : "Search anime"}
                        value={query} onChange={setQuery} autoFocus
                    />
                    {loading && (
                        <div className="vc-superboard-loading">
                            <div className="vc-superboard-spinner" />
                            <Text variant="text-md/medium">Searching...</Text>
                        </div>
                    )}
                    {!loading && results.length === 0 && debouncedQuery.trim() && (
                        <div className="vc-superboard-empty">
                            <Text variant="text-md/medium">No results for &quot;{debouncedQuery}&quot;</Text>
                        </div>
                    )}
                    {!loading && !debouncedQuery.trim() && (
                        <div className="vc-superboard-empty">
                            <div className="vc-superboard-empty-icon">{isHate ? "💔" : "🔍"}</div>
                            <Text variant="text-md/medium" style={{ color: "var(--text-muted)" }}>
                                {isHate ? "Search for anime you despise" : "Type above to find your favorite anime"}
                            </Text>
                        </div>
                    )}
                    {!loading && results.length > 0 && (
                        <div className="vc-superboard-search-grid">
                            {results.map(anime => (
                                <AnimeCard key={anime.mal_id} anime={anime} onAdd={() => handleAdd(anime)} added={addedIds.has(anime.mal_id)} hate={isHate} />
                            ))}
                        </div>
                    )}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

function openAnimeSearchModal(mode: ListMode, onChanged: () => void) {
    openModal(props => <AnimeSearchModal rootProps={props} mode={mode} onChanged={onChanged} />);
}

// ==================== Board Contents ====================

function MusicBoardContent({ user, isCurrentUser, onBack }: { user: User; isCurrentUser: boolean; onBack: () => void; }) {
    const [musicList, setMusicList] = useState<MusicData[]>(isCurrentUser ? cachedMusic : []);
    const [loading, setLoading] = useState(!isCurrentUser);

    useEffect(() => {
        if (isCurrentUser) {
            loadMusic().then(setMusicList);
        } else {
            setLoading(true);
            fetchRemoteMusicList(user.id).then(data => {
                if (data) setMusicList(data.music);
                setLoading(false);
            });
        }
        return () => stopAllAudio();
    }, [user.id]);

    const handleRemove = useCallback(async (id: number) => {
        await removeMusic(id);
        setMusicList([...cachedMusic]);
    }, []);

    const handleAdd = useCallback(() => {
        openMusicSearchModal(() => loadMusic().then(setMusicList));
    }, []);

    if (loading) {
        return (
            <div className="vc-superboard-board-content">
                <div className="vc-superboard-back-row">
                    <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={onBack}>←</Button>
                </div>
                <div className="vc-superboard-loading">
                    <div className="vc-superboard-spinner" />
                    <Text variant="text-md/medium">Loading music list...</Text>
                </div>
            </div>
        );
    }

    return (
        <div className="vc-superboard-board-content">
            <div className="vc-superboard-back-row">
                <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={onBack}>←</Button>
            </div>
            <div className="vc-superboard-board-header">
                <Text variant="text-xs/semibold" style={{ color: "var(--header-secondary)", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                    🎵 ({musicList.length})
                </Text>
                {isCurrentUser && (
                    <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={handleAdd}>Add</Button>
                )}
            </div>
            {musicList.length > 0 ? (
                <div className="vc-superboard-board-grid">
                    {musicList.map(music => (
                        <MusicCard key={music.id} music={music}
                            onRemove={isCurrentUser ? () => handleRemove(music.id) : undefined} compact />
                    ))}
                </div>
            ) : (
                <div className={ProfileListClasses.empty} style={{ padding: "16px 0" }}>
                    <div className={ProfileListClasses.textContainer}>
                        <BaseText tag="h3" size="md" weight="medium" style={{ color: "var(--text-strong)" }}>
                            {isCurrentUser ? "No music added yet. Use the Add button!" : "No favorite music."}
                        </BaseText>
                    </div>
                </div>
            )}
        </div>
    );
}

function AnimeBoardContent({ user, isCurrentUser, onBack }: { user: User; isCurrentUser: boolean; onBack: () => void; }) {
    const [favList, setFavList] = useState<AnimeData[]>(isCurrentUser ? cachedFavorites : []);
    const [hateList, setHateList] = useState<AnimeData[]>(isCurrentUser ? cachedHated : []);
    const [loading, setLoading] = useState(!isCurrentUser);

    useEffect(() => {
        if (isCurrentUser) {
            loadFavorites().then(setFavList);
            loadHated().then(setHateList);
        } else {
            setLoading(true);
            fetchRemoteAnimeList(user.id).then(data => {
                if (data) { setFavList(data.favs); setHateList(data.hated); }
                setLoading(false);
            });
        }
    }, [user.id]);

    const handleRemoveFav = useCallback(async (malId: number) => {
        await removeFavorite(malId);
        setFavList([...cachedFavorites]);
    }, []);

    const handleRemoveHate = useCallback(async (malId: number) => {
        await removeHated(malId);
        setHateList([...cachedHated]);
    }, []);

    const handleAddFav = useCallback(() => {
        openAnimeSearchModal("fav", () => loadFavorites().then(setFavList));
    }, []);

    const handleAddHate = useCallback(() => {
        openAnimeSearchModal("hate", () => loadHated().then(setHateList));
    }, []);

    if (loading) {
        return (
            <div className="vc-superboard-board-content">
                <div className="vc-superboard-back-row">
                    <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={onBack}>←</Button>
                </div>
                <div className="vc-superboard-loading">
                    <div className="vc-superboard-spinner" />
                    <Text variant="text-md/medium">Loading anime list...</Text>
                </div>
            </div>
        );
    }

    if (favList.length === 0 && hateList.length === 0 && !isCurrentUser) {
        return (
            <div className="vc-superboard-board-content">
                <div className="vc-superboard-back-row">
                    <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={onBack}>←</Button>
                </div>
                <div className="vc-superboard-empty">
                    <div className="vc-superboard-empty-icon">🎬</div>
                    <Text variant="text-md/medium" style={{ color: "var(--text-muted)" }}>No anime data found for this user.</Text>
                </div>
            </div>
        );
    }

    return (
        <div className="vc-superboard-board-content">
            <div className="vc-superboard-back-row">
                <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={onBack}>←</Button>
            </div>

            {/* Favorites section */}
            <div className="vc-superboard-board-header">
                <Text variant="text-xs/semibold" style={{ color: "var(--header-secondary)", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                    ❤️ ({favList.length})
                </Text>
                {isCurrentUser && (
                    <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={handleAddFav}>Add</Button>
                )}
            </div>
            {favList.length > 0 ? (
                <div className="vc-superboard-board-grid">
                    {favList.map(anime => (
                        <AnimeCard key={anime.mal_id} anime={anime}
                            onRemove={isCurrentUser ? () => handleRemoveFav(anime.mal_id) : undefined} compact />
                    ))}
                </div>
            ) : (
                <div className={ProfileListClasses.empty} style={{ padding: "16px 0" }}>
                    <div className={ProfileListClasses.textContainer}>
                        <BaseText tag="h3" size="md" weight="medium" style={{ color: "var(--text-strong)" }}>
                            {isCurrentUser ? "No favorites yet. Use the Add button!" : "No favorite anime."}
                        </BaseText>
                    </div>
                </div>
            )}

            {/* Hated section */}
            <div className="vc-superboard-board-divider" />
            <div className="vc-superboard-board-header">
                <Text variant="text-xs/semibold" style={{ color: "var(--header-secondary)", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                    💔 ({hateList.length})
                </Text>
                {isCurrentUser && (
                    <Button size={Button.Sizes.MIN} color={Button.Colors.PRIMARY} onClick={handleAddHate}>Add</Button>
                )}
            </div>
            {hateList.length > 0 ? (
                <div className="vc-superboard-board-grid">
                    {hateList.map(anime => (
                        <AnimeCard key={anime.mal_id} anime={anime}
                            onRemove={isCurrentUser ? () => handleRemoveHate(anime.mal_id) : undefined} compact hate />
                    ))}
                </div>
            ) : (
                <div className={ProfileListClasses.empty} style={{ padding: "16px 0" }}>
                    <div className={ProfileListClasses.textContainer}>
                        <BaseText tag="h3" size="md" weight="medium" style={{ color: "var(--text-strong)" }}>
                            {isCurrentUser ? "No hated anime yet." : "No hated anime."}
                        </BaseText>
                    </div>
                </div>
            )}
        </div>
    );
}

// ==================== Settings Panel ====================

function MusicListSection({ list, onRefresh }: { list: MusicData[]; onRefresh: () => void; }) {
    const handleRemove = useCallback(async (id: number) => { await removeMusic(id); onRefresh(); }, [onRefresh]);
    return (
        <Forms.FormSection>
            <Forms.FormTitle tag="h3">🎵 Your Favorite Music</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: 12 }}>
                Search and add music from iTunes — shown on your profile's SuperBoard.
            </Forms.FormText>
            <Button onClick={() => openMusicSearchModal(onRefresh)} size={Button.Sizes.SMALL} color={Button.Colors.BRAND}>
                🎵 Add Music
            </Button>
            {list.length > 0 ? (
                <div className="vc-superboard-settings-grid">
                    {list.map(music => <MusicCard key={music.id} music={music} onRemove={() => handleRemove(music.id)} />)}
                </div>
            ) : (
                <div className="vc-superboard-settings-empty">
                    <div className="vc-superboard-empty-icon">🎵</div>
                    <Text variant="text-md/medium" style={{ color: "var(--text-muted)" }}>No music added yet. Use the button above to get started!</Text>
                </div>
            )}
        </Forms.FormSection>
    );
}

function AnimeListSection({ title, mode, list, onRefresh }: { title: string; mode: ListMode; list: AnimeData[]; onRefresh: () => void; }) {
    const isHate = mode === "hate";
    const handleRemove = useCallback(async (malId: number) => {
        if (isHate) await removeHated(malId); else await removeFavorite(malId);
        onRefresh();
    }, [isHate, onRefresh]);
    return (
        <Forms.FormSection>
            <Forms.FormTitle tag="h3">{title}</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: 12 }}>
                {isHate ? "Anime you can't stand — shown on your profile." : "Search and add anime from MyAnimeList — shown on your profile."}
            </Forms.FormText>
            <Button onClick={() => openAnimeSearchModal(mode, onRefresh)} size={Button.Sizes.SMALL}
                color={isHate ? Button.Colors.RED : Button.Colors.BRAND}>
                {isHate ? "💔 Add Hated Anime" : "❤️ Add Favorite Anime"}
            </Button>
            {list.length > 0 ? (
                <div className="vc-superboard-settings-grid">
                    {list.map(anime => <AnimeCard key={anime.mal_id} anime={anime} onRemove={() => handleRemove(anime.mal_id)} hate={isHate} />)}
                </div>
            ) : (
                <div className="vc-superboard-settings-empty">
                    <div className="vc-superboard-empty-icon">{isHate ? "💔" : "🎬"}</div>
                    <Text variant="text-md/medium" style={{ color: "var(--text-muted)" }}>
                        {isHate ? "No hated anime added yet." : "No favorites added yet. Use the button above to get started!"}
                    </Text>
                </div>
            )}
        </Forms.FormSection>
    );
}

function MALImportSection({ onImport }: { onImport: () => void; }) {
    const [username, setUsername] = useState("");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");

    const handleImport = useCallback(async () => {
        if (!username.trim()) return;
        setLoading(true);
        setMessage("");
        try {
            const animes = await fetchMALUserFavorites(username);
            if (animes.length === 0) {
                setMessage("No favorite anime found for this user.");
            } else {
                const existing = new Set(cachedFavorites.map(f => f.mal_id));
                const newAnimes = animes.filter(a => !existing.has(a.mal_id));
                if (newAnimes.length > 0) {
                    cachedFavorites = [...cachedFavorites, ...newAnimes];
                    await DataStoreSet(STORE_KEY_FAV, cachedFavorites);
                    scheduleAnimeSync();
                }
                setMessage(`${newAnimes.length} anime imported (${animes.length - newAnimes.length} already in list).`);
                onImport();
            }
        } catch {
            setMessage("Import failed. Please check the username.");
        }
        setLoading(false);
    }, [username, onImport]);

    return (
        <div className="vc-superboard-import-section">
            <Forms.FormTitle tag="h3">Import from MAL</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: 8 }}>
                Enter your MyAnimeList username to automatically import your favorite anime.
            </Forms.FormText>
            <div className="vc-superboard-import-row">
                <TextInput placeholder="MAL username" value={username} onChange={setUsername} style={{ flex: 1 }} />
                <Button onClick={handleImport} disabled={loading || !username.trim()} size={Button.Sizes.SMALL}>
                    {loading ? "Importing..." : "Import"}
                </Button>
            </div>
            {message && (
                <Text variant="text-sm/medium" style={{ marginTop: 8, color: "var(--text-muted)" }}>{message}</Text>
            )}
        </div>
    );
}

function CloudSyncStatus() {
    const [syncing, setSyncing] = useState(false);
    const [lastResult, setLastResult] = useState<string>("");

    const handleSync = useCallback(async () => {
        const hasData = cachedMusic.length > 0 || cachedFavorites.length > 0 || cachedHated.length > 0;
        if (!hasData) {
            Toasts.show({ type: Toasts.Type.FAILURE, message: "No data to sync!", id: Toasts.genId() });
            return;
        }
        setSyncing(true);
        setLastResult("");
        const results = await Promise.all([syncMusicToServer(), syncAnimeToServer()]);
        setSyncing(false);
        const allOk = results.every(Boolean);
        if (allOk) {
            setLastResult("Synced successfully! Other SuperBoard users can now see your lists.");
            Toasts.show({ type: Toasts.Type.SUCCESS, message: "All lists synced!", id: Toasts.genId() });
        } else {
            setLastResult("Some syncs failed. Please try again later.");
            Toasts.show({ type: Toasts.Type.FAILURE, message: "Sync partially failed!", id: Toasts.genId() });
        }
    }, []);

    return (
        <div className="vc-superboard-import-section">
            <Forms.FormTitle tag="h3">Sync to Server</Forms.FormTitle>
            <Forms.FormText style={{ marginBottom: 8 }}>
                If you have problems with automatic sync, you can sync all your lists manually so other users can see them on your profile.
            </Forms.FormText>
            <Button onClick={handleSync} size={Button.Sizes.SMALL} color={Button.Colors.BRAND} disabled={syncing}>
                {syncing ? "Syncing..." : "Sync Now"}
            </Button>
            {lastResult && (
                <Text variant="text-sm/medium" style={{ marginTop: 8, color: "var(--text-muted)" }}>{lastResult}</Text>
            )}
        </div>
    );
}

type SettingsTab = "music" | "anime" | "sync";

function SettingsPanel() {
    const [tab, setTab] = useState<SettingsTab>("music");
    const [musicList, setMusicList] = useState<MusicData[]>(cachedMusic);
    const [favorites, setFavorites] = useState<AnimeData[]>(cachedFavorites);
    const [hated, setHated] = useState<AnimeData[]>(cachedHated);

    const refreshAll = useCallback(() => {
        Promise.all([loadMusic(), loadFavorites(), loadHated()]).then(([m, f, h]) => {
            setMusicList([...m]);
            setFavorites([...f]);
            setHated([...h]);
        });
    }, []);

    useEffect(() => { refreshAll(); }, []);

    return (
        <div className="vc-superboard-settings">
            <div className="vc-superboard-settings-tabs">
                <button className={`vc-superboard-settings-tab${tab === "music" ? " vc-superboard-settings-tab-active" : ""}`}
                    onClick={() => setTab("music")}>🎵 Music</button>
                <button className={`vc-superboard-settings-tab${tab === "anime" ? " vc-superboard-settings-tab-active" : ""}`}
                    onClick={() => setTab("anime")}>🎬 Anime</button>
                <button className={`vc-superboard-settings-tab${tab === "sync" ? " vc-superboard-settings-tab-active" : ""}`}
                    onClick={() => setTab("sync")}>☁️ Sync & Import</button>
            </div>
            {tab === "music" && <MusicListSection list={musicList} onRefresh={refreshAll} />}
            {tab === "anime" && (
                <>
                    <AnimeListSection title="❤️ Your Favorite Anime" mode="fav" list={favorites} onRefresh={refreshAll} />
                    <div style={{ marginTop: 20 }}>
                        <AnimeListSection title="💔 Anime You Hate" mode="hate" list={hated} onRefresh={refreshAll} />
                    </div>
                </>
            )}
            {tab === "sync" && (
                <>
                    <MALImportSection onImport={refreshAll} />
                    <div style={{ marginTop: 16 }}>
                        <CloudSyncStatus />
                    </div>
                </>
            )}
        </div>
    );
}

// ==================== Plugin Definition ====================

const IS_PATCHED = Symbol("SuperBoard.Patched");
let originalBoardText = "Board";

export default definePlugin({
    name: "SuperBoard",
    description: "SuperBoard — A unified profile board with GameBoard, MusicBoard, and AniBoard. Music powered by iTunes, anime powered by MyAnimeList via Jikan API.",
    authors: [{ name: "canplus", id: 852614422235971655n }],

    settingsAboutComponent: () => <SettingsPanel />,

    async start() {
        await Promise.all([loadMusic(), loadFavorites(), loadHated()]);
    },

    stop() {
        stopAllAudio();
    },

    patches: [
        // User Profile Modal (v1)
        {
            find: ".BOT_DATA_ACCESS?(",
            replacement: [
                {
                    match: /\i\.useEffect.{0,100}(\i)\[0\]\.section/,
                    replace: "$self.pushSection($1,arguments[0].user);$&"
                },
                {
                    match: /\(0,\i\.jsx\)\(\i,\{items:\i,section:(\i)/,
                    replace: "$1==='SUPER_BOARD'?$self.renderSuperBoard(arguments[0]):$&"
                },
                {
                    match: /className:\i\.\i(?=,type:"top")/,
                    replace: '$& + " vc-superboard-modal-tab-bar"',
                    noWarn: true
                }
            ]
        },
        // User Profile Modal v2
        {
            find: ".WIDGETS?",
            replacement: [
                {
                    match: /items:(\i),.+?(?=return\(0,\i\.jsxs?\)\("div)/,
                    replace: "$&$self.pushSection($1,arguments[0].user);"
                },
                {
                    match: /\(0,\i\.jsxs?\)\(\i,\{.{0,200}?section:(\i)/,
                    replace: "$1==='SUPER_BOARD'?$self.renderSuperBoard(arguments[0]):$&"
                },
                {
                    match: /type:"top",/,
                    replace: '$&className:"vc-superboard-modal-v2-tab-bar",'
                },
            ]
        },
    ],

    pushSection(sections: any[], user: User) {
        try {
            if (sections[IS_PATCHED]) return;
            sections[IS_PATCHED] = true;
            const origText = sections[0].text;
            const origSection = sections[0].section;
            originalBoardText = origText;
            sections[0].text = "SuperBoard";
            sections[0].section = "SUPER_BOARD";
            sections.splice(1, 0, { text: origText, section: origSection });
        } catch (e) {
            logger.error("Failed to push SuperBoard section:", e);
        }
    },

    renderSuperBoard: ErrorBoundary.wrap(({ user, onClose }: { user: User; onClose: () => void; }) => {
        const containerRef = React.useRef<HTMLDivElement>(null);
        const boardTabRef = React.useRef<HTMLElement | null>(null);
        const currentUser = UserStore.getCurrentUser();
        const isCurrentUser = !!currentUser && !!user && user.id === currentUser.id;
        const [activeBoard, setActiveBoard] = useState<"selector" | "music" | "anime">("selector");

        useEffect(() => {
            const hide = () => {
                if (!containerRef.current || boardTabRef.current) return;
                let el: HTMLElement | null = containerRef.current;
                for (let i = 0; i < 25 && el; i++) {
                    el = el.parentElement;
                    if (!el) break;
                    const tabList = el.querySelector('[role="tablist"]');
                    if (tabList) {
                        for (let j = 0; j < tabList.children.length; j++) {
                            const child = tabList.children[j] as HTMLElement;
                            const txt = child.textContent?.trim() ?? "";
                            if (txt === originalBoardText || txt.startsWith(originalBoardText + " ") || txt.startsWith(originalBoardText + "(")) {
                                child.style.display = "none";
                                boardTabRef.current = child;
                                return;
                            }
                        }
                    }
                }
            };
            const f = requestAnimationFrame(hide);
            const t1 = setTimeout(hide, 50);
            const t2 = setTimeout(hide, 200);
            return () => { cancelAnimationFrame(f); clearTimeout(t1); clearTimeout(t2); };
        }, []);

        const handleGameBoard = useCallback(() => {
            if (boardTabRef.current) {
                boardTabRef.current.style.display = "";
                boardTabRef.current.click();
            }
        }, []);

        const goBack = useCallback(() => {
            stopAllAudio();
            setActiveBoard("selector");
        }, []);

        let content: React.ReactNode;
        switch (activeBoard) {
            case "music":
                content = <MusicBoardContent user={user} isCurrentUser={isCurrentUser} onBack={goBack} />;
                break;
            case "anime":
                content = <AnimeBoardContent user={user} isCurrentUser={isCurrentUser} onBack={goBack} />;
                break;
            case "selector":
            default:
                content = <BoardSelector onSelect={setActiveBoard} onGameBoard={handleGameBoard} />;
                break;
        }

        return (
            <ScrollerThin className={TabBarClasses.tabPanelScroller} fade={true} onClose={onClose}>
                <div ref={containerRef}>
                    {content}
                </div>
            </ScrollerThin>
        );
    }),
});

// ==================== Board Selector ====================

function BoardSelector({ onSelect, onGameBoard }: { onSelect: (board: "music" | "anime") => void; onGameBoard: () => void; }) {
    return (
        <div className="vc-superboard-selector">
            <Text variant="heading-lg/bold" style={{ textAlign: "center", marginBottom: 8 }}>
                SuperBoard
            </Text>
            <Text variant="text-sm/normal" style={{ textAlign: "center", marginBottom: 24, color: "var(--text-muted)" }}>
                Choose a board to view
            </Text>
            <div className="vc-superboard-selector-grid">
                <button className="vc-superboard-selector-card" onClick={onGameBoard}>
                    <span className="vc-superboard-selector-icon">🎮</span>
                    <Text variant="text-sm/bold">GameBoard</Text>
                    <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>Game Widgets</Text>
                </button>
                <button className="vc-superboard-selector-card" onClick={() => onSelect("music")}>
                    <span className="vc-superboard-selector-icon">🎵</span>
                    <Text variant="text-sm/bold">MusicBoard</Text>
                    <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>Favorite Music(s)</Text>
                </button>
                <button className="vc-superboard-selector-card" onClick={() => onSelect("anime")}>
                    <span className="vc-superboard-selector-icon">🎬</span>
                    <Text variant="text-sm/bold">AniBoard</Text>
                    <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>Anime List</Text>
                </button>
            </div>
        </div>
    );
}

// im just saying token for id, not discord token
