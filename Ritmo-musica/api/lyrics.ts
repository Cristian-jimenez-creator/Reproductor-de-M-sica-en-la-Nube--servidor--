import type { VercelRequest, VercelResponse } from '@vercel/node'

type LyricsRecord = { trackName?: string; artistName?: string; duration?: number; plainLyrics?: string | null; syncedLyrics?: string | null }
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })
  const track = typeof req.query.track === 'string' ? req.query.track.trim().slice(0, 120) : ''
  const artist = typeof req.query.artist === 'string' ? req.query.artist.trim().slice(0, 120) : ''
  if (!track) return res.status(400).json({ error: 'Falta el nombre de la canción.' })

  try {
    const params = new URLSearchParams({ track_name: track, artist_name: artist })
    const response = await fetch(`https://lrclib.net/api/search?${params}`, {
      headers: { 'User-Agent': 'RitmoMusic/1.0 (music playlist web app)', 'Lrclib-Client': 'RitmoMusic/1.0' },
    })
    if (!response.ok) return res.status(response.status === 429 ? 429 : 502).json({ error: 'No se pudieron cargar las letras.' })
    const records = await response.json() as LyricsRecord[]
    const trackName = normalize(track); const artistName = normalize(artist)
    const best = records
      .filter(record => record.syncedLyrics || record.plainLyrics)
      .map(record => {
        const candidateTrack = normalize(record.trackName ?? '')
        const candidateArtist = normalize(record.artistName ?? '')
        const score = (candidateTrack === trackName ? 4 : candidateTrack.includes(trackName) || trackName.includes(candidateTrack) ? 1 : 0)
          + (artistName && candidateArtist === artistName ? 3 : artistName && (candidateArtist.includes(artistName) || artistName.includes(candidateArtist)) ? 1 : 0)
          + (record.syncedLyrics ? .5 : 0)
        return { record, score }
      })
      .sort((a, b) => b.score - a.score)[0]?.record
    return res.status(200).json(best ? { plainLyrics: best.plainLyrics ?? null, syncedLyrics: best.syncedLyrics ?? null, trackName: best.trackName, artistName: best.artistName } : { plainLyrics: null, syncedLyrics: null })
  } catch {
    return res.status(502).json({ error: 'No se pudo conectar con el proveedor de letras.' })
  }
}
