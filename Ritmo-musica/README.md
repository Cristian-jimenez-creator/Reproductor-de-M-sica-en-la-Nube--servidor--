# Ritmo — Music Player

A TypeScript, React, and Vite music player built around a doubly linked playlist. The application includes local music search, YouTube discovery, favorites, custom playlists, playback history, lyrics display, and player controls.

## Local music

A cloud-hosted webpage cannot silently scan a visitor's device. Users choose audio files explicitly with **Agregar música**. Files play in the browser and are stored in that browser's IndexedDB for later visits; they are not uploaded to the server. Local search filters selected file names and artists.

## YouTube search and playback

Public video search uses the YouTube Data API v3 through `api/youtube.ts`. The API key stays on the server. Search results are played by YouTube's embedded player and follow YouTube's availability and playback rules.

To configure the API key:

1. Create a Google Cloud project, enable YouTube Data API v3, and create an API key.
2. For local development, copy `.env.example` to `.env.local` and set `YOUTUBE_API_KEY`.
3. In Vercel, add the same variable under **Project Settings → Environment Variables**. Do not use the `VITE_` prefix, which would expose the key to the browser.

## Lyrics

The serverless function in `api/lyrics.ts` searches LRCLIB for synchronized or plain lyrics. Lyrics are shown in the center of the screen while playback and Thump Mode are active, when the provider has a matching entry. Requests identify the app as required by the LRCLIB API guidelines.

## Run locally

```bash
npm install
npm run dev
```

The Vite development server serves the frontend. To use the `/api/*` routes locally, run the project with Vercel CLI and configure `YOUTUBE_API_KEY` in `.env.local`. Create a production build with `npm run build`.

## Production deployment

The current production deployment is available at <https://temporary-instant-crimson-2mnez9m.vercel.app>. The frontend and the `/api/youtube` and `/api/lyrics` serverless functions run in the same Vercel project.

## Thump Mode

For local audio, Thump Mode uses the Web Audio API to boost low frequencies and analyze bass energy for the visual pulse. YouTube playback is isolated in its embedded player, so Ritmo cannot inspect its waveform; YouTube uses an approximate visual pulse instead.
