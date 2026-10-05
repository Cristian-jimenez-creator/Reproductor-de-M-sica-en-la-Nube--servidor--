import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido.' })
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : ''
  if (q.length < 2) return res.status(400).json({ error: 'Escribe al menos dos caracteres.' })
  const key = process.env.YOUTUBE_API_KEY
  if (!key) return res.status(503).json({ error: 'La búsqueda de YouTube aún no está configurada. Añade YOUTUBE_API_KEY en las variables de entorno del servidor.' })

  try {
    const params = new URLSearchParams({ part: 'snippet', type: 'video', videoCategoryId: '10', maxResults: '12', safeSearch: 'none', q, key })
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`)
    const data = await response.json()
    if (!response.ok) return res.status(response.status).json({ error: data?.error?.message ?? 'YouTube no pudo completar la búsqueda.' })
    const items = (data.items ?? []).filter((item: any) => item.id?.videoId)
    const ids = items.map((item: any) => item.id.videoId).join(',')
    const durationParams = new URLSearchParams({ part: 'contentDetails', id: ids, key })
    const durationResponse = ids ? await fetch(`https://www.googleapis.com/youtube/v3/videos?${durationParams}`) : null
    const durationData = durationResponse?.ok ? await durationResponse.json() : { items: [] }
    const durations = new Map((durationData.items ?? []).map((item: any) => {
      const match = String(item.contentDetails?.duration ?? '').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/)
      return [item.id, match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0]
    }))
    const videos = items.flatMap((item: any) => item.id?.videoId ? [{
      id: item.id.videoId,
      title: item.snippet?.title ?? 'Video sin título',
      artist: item.snippet?.channelTitle ?? 'YouTube',
      thumbnail: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? '',
      duration: durations.get(item.id.videoId) ?? 0,
      source: 'youtube',
    }] : [])
    return res.status(200).json({ videos })
  } catch {
    return res.status(502).json({ error: 'No se pudo conectar con YouTube. Inténtalo de nuevo.' })
  }
}
