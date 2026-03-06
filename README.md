[Vencord Plugin](https://docs.vencord.dev/installing/custom-plugins/)

# SuperBoard

A unified profile board for Discord — combines **MusicBoard**, **AniBoard**, and **GameBoard** into a single tab. Music powered by iTunes, anime powered by MyAnimeList (Jikan API). No other plugins required.

## Features

- Adds a **SuperBoard** tab to user profiles with an interactive board selector.
- **🎵 MusicBoard** — Search and add music from iTunes with album art and **30-second audio previews**.
- **🎬 AniBoard** — Search and add anime from MyAnimeList. Supports favorites and hate lists. Import from MAL username.
- **🎮 GameBoard** — Info about Discord's built-in game activity feature.
- **Fully self-contained** — no need to install FavAnime or any other plugin.
- **Cloud sync** — your music and anime lists are synced to the server so other users can see them on your profile.
- **Backward compatible** — if you previously used FavAnime, your data transfers seamlessly.

## Usage

1. Enable the **SuperBoard** plugin in Vencord settings.
2. Open any user's profile and click the **SuperBoard** tab.
3. Choose **MusicBoard**, **AniBoard**, or **GameBoard** from the selector.
4. Use the **Add** button to search and add items to your lists.
5. Your lists sync automatically. Use **Sync Now** in settings for manual sync.

## Board Types

### 🎵 MusicBoard
- Search songs, artists, and albums via iTunes.
- Album art grid with hover effects.
- Click ▶ to play a 30-second audio preview.
- Click on any card to open the Apple Music page.

### 🎬 AniBoard
- Search and add anime from MyAnimeList via Jikan API.
- **Favorites** — anime you love, with score badges.
- **Hate list** — anime you can't stand, with 💔 badges.
- **MAL Import** — enter your MAL username to import favorites automatically.
- Click on any card to open the MyAnimeList page.

### 🎮 GameBoard
- Informational — Discord natively supports game activity display.

## Settings

In the plugin settings panel you can:
- **Add/remove music** from your favorites list.
- **Add/remove anime** from favorites and hate lists.
- **Import from MAL** — bulk import your MAL favorites.
- **Sync Now** — manually sync all lists to the server.

## API Disclaimer

This plugin uses the following external APIs:

- **[iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/)** — Music search. No authentication required. Apple's [Terms of Service](https://www.apple.com/legal/internet-services/itunes/) apply.
- **[Jikan API](https://jikan.moe/)** — Unofficial MyAnimeList API for anime search and MAL user favorites import. No authentication required.
- **Custom sync server** — anachter.dev backend. Stores music and anime lists by Discord user ID.

## Deploying the Sync Server

SuperBoard uses a Cloudflare Worker backend (anachter.dev).

If you want to self-host:

1. Create a Cloudflare Worker.
2. Create two KV Namespaces: `FAVANIME_KV` (anime) and `FAVMUSIC_KV` (music). Bind both to the worker.
3. Deploy `favanime-worker.js` as the worker code.
4. Update `API_BASE` and `MUSIC_API_BASE` in `native.ts` to point to your worker URL.
