import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, ChevronDown, CircleHelp, Disc3, FolderOpen, Heart, History, ListMusic, LoaderCircle, MoreHorizontal, Music2, Pause, Play, Plus, Radio, Search, SkipBack, SkipForward, SlidersHorizontal, Volume2, X, Youtube, Waves } from 'lucide-react'

type Track = { id: string; title: string; artist: string; source: 'local' | 'youtube'; file?: File; videoId?: string; cover?: string; duration?: number }
type Node = { track: Track; prev: Node | null; next: Node | null }
type LyricLine = { time: number; text: string }
type YouTubePlayer = { getDuration: () => number; getCurrentTime: () => number; seekTo: (time: number, allowSeekAhead: boolean) => void; destroy: () => void }
declare global { interface Window { YT?: { Player: new (element: HTMLIFrameElement, options: Record<string, unknown>) => YouTubePlayer }; onYouTubeIframeAPIReady?: () => void } }
const loadYouTubeApi = () => new Promise<NonNullable<Window['YT']>>(resolve => { if (window.YT?.Player) { resolve(window.YT); return }; const previous = window.onYouTubeIframeAPIReady; window.onYouTubeIframeAPIReady = () => { previous?.(); if (window.YT) resolve(window.YT) }; if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) { const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(script) } })
const TRACK_DB = 'ritmo-library'
const openTrackDb = () => new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(TRACK_DB, 1); request.onupgradeneeded = () => request.result.createObjectStore('tracks', { keyPath: 'id' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
const storeTrack = async (track: Track) => { try { const db = await openTrackDb(); const tx = db.transaction('tracks', 'readwrite'); tx.objectStore('tracks').put(track); tx.oncomplete = () => db.close() } catch { /* searchable metadata is also stored separately */ } }
const deleteStoredTrack = async (id: string) => { try { const db = await openTrackDb(); const tx = db.transaction('tracks', 'readwrite'); tx.objectStore('tracks').delete(id); tx.oncomplete = () => db.close() } catch { /* best-effort cleanup */ } }
const loadStoredTracks = async () => { const db = await openTrackDb(); return new Promise<Track[]>((resolve, reject) => { const request = db.transaction('tracks', 'readonly').objectStore('tracks').getAll(); request.onsuccess = () => { db.close(); resolve(request.result as Track[]) }; request.onerror = () => { db.close(); reject(request.error) } }) }
class DoublyLinkedPlaylist {
  head: Node | null = null
  tail: Node | null = null
  length = 0
  toArray() { const rows: Track[] = []; let node = this.head; while (node) { rows.push(node.track); node = node.next }; return rows }
  insert(track: Track, index = this.length) {
    const node: Node = { track, prev: null, next: null }
    if (!this.head) this.head = this.tail = node
    else if (index <= 0) { node.next = this.head; this.head.prev = node; this.head = node }
    else if (index >= this.length) { node.prev = this.tail; this.tail!.next = node; this.tail = node }
    else { let at = this.head; for (let i = 0; i < index; i++) at = at!.next!; node.prev = at.prev; node.next = at; at.prev!.next = node; at.prev = node }
    this.length++
  }
  remove(id: string) {
    let node = this.head
    while (node && node.track.id !== id) node = node.next
    if (!node) return
    if (node.prev) node.prev.next = node.next; else this.head = node.next
    if (node.next) node.next.prev = node.prev; else this.tail = node.prev
    this.length--
  }
}
const fmt = (s?: number) => !s || !Number.isFinite(s) ? '—:—' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export default function App() {
  const playlist = useRef(new DoublyLinkedPlaylist())
  const audio = useRef<HTMLAudioElement>(null)
  const youtubeFrame = useRef<HTMLIFrameElement>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const bassFilter = useRef<BiquadFilterNode | null>(null)
  const analyser = useRef<AnalyserNode | null>(null)
  const audioSource = useRef<MediaElementAudioSourceNode | null>(null)
  const youtubePlayer = useRef<YouTubePlayer | null>(null)
  const [tracks, setTracks] = useState<Track[]>(() => { try { const saved = JSON.parse(localStorage.getItem('ritmo-tracks') || '[]'); return saved.length ? saved : JSON.parse(localStorage.getItem('ritmo-history') || '[]') } catch { return [] } })
  if (playlist.current.length === 0 && tracks.length) tracks.forEach(track => playlist.current.insert(track))
  const [active, setActive] = useState<Track | null>(null)
  const [playing, setPlaying] = useState(false)
  const [query, setQuery] = useState('')
  const [localQuery, setLocalQuery] = useState('')
  const [results, setResults] = useState<Track[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [filter, setFilter] = useState<'all' | 'local' | 'youtube'>('all')
  const [favorites, setFavorites] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('ritmo-favorites') || '[]') } catch { return [] } })
  const [userLists, setUserLists] = useState<{ id: string; name: string; trackIds: string[] }[]>(() => { try { return JSON.parse(localStorage.getItem('ritmo-lists') || '[]') } catch { return [] } })
  const [selectedList, setSelectedList] = useState('')
  const [listName, setListName] = useState('')
  const [showListForm, setShowListForm] = useState(false)
  const [listPickerTrack, setListPickerTrack] = useState<Track | null>(null)
  const [history, setHistory] = useState<Track[]>(() => { try { return JSON.parse(localStorage.getItem('ritmo-history') || '[]') } catch { return [] } })
  const [showHistory, setShowHistory] = useState(false)
  const [thumpMode, setThumpMode] = useState(false)
  const [lyrics, setLyrics] = useState<{ plainLyrics: string | null; syncedLyrics: string | null } | null>(null)
  const [lyricsLoading, setLyricsLoading] = useState(false)
  const [audioFxReady, setAudioFxReady] = useState(false)
  const [bassEnergy, setBassEnergy] = useState(0)
  const [insertAt, setInsertAt] = useState('end')
  const [position, setPosition] = useState('1')
  const [localSrc, setLocalSrc] = useState('')
  const filePicker = useRef<HTMLInputElement>(null)
  const collectionTracks = useMemo(() => selectedList === 'favorites' ? tracks.filter(t => favorites.includes(t.id)) : selectedList ? tracks.filter(t => userLists.find(list => list.id === selectedList)?.trackIds.includes(t.id)) : tracks, [tracks, selectedList, favorites, userLists])
  const visibleTracks = useMemo(() => collectionTracks.filter(t => (filter === 'all' || t.source === filter) && `${t.title} ${t.artist}`.toLowerCase().includes(localQuery.toLowerCase())), [collectionTracks, filter, localQuery])
  const parsedLyrics = useMemo<LyricLine[]>(() => (lyrics?.syncedLyrics ?? '').split(/\r?\n/).flatMap(line => { const match = line.match(/^\[(\d{2}):(\d{2})(?:[.:](\d{2,3}))?\](.*)$/); if (!match) return []; const fraction = match[3] ? Number(`0.${match[3]}`) : 0; return [{ time: Number(match[1]) * 60 + Number(match[2]) + fraction, text: match[4].trim() }] }).filter(line => line.text), [lyrics])
  const lyricTextLines = useMemo(() => (lyrics?.plainLyrics ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean), [lyrics])
  const lyricIndex = parsedLyrics.length ? parsedLyrics.reduce((selected, line, index) => line.time <= currentTime ? index : selected, 0) : lyricTextLines.length ? Math.min(lyricTextLines.length - 1, Math.floor(currentTime / Math.max(1, duration / lyricTextLines.length))) : -1
  useEffect(() => { playlist.current = new DoublyLinkedPlaylist(); tracks.forEach(track => playlist.current.insert(track)) }, [tracks])
  useEffect(() => { try { localStorage.setItem('ritmo-tracks', JSON.stringify(tracks.map(({ file: _file, ...track }) => track))) } catch { /* IndexedDB retains the audio */ }; tracks.forEach(track => { if (track.file) void storeTrack(track) }) }, [tracks])
  useEffect(() => { let alive = true; void loadStoredTracks().then(saved => { if (!alive || !saved.length) return; const byId = new Map(saved.map(track => [track.id, track])); setTracks(current => { const merged = current.map(track => byId.get(track.id) ?? track); const ids = new Set(merged.map(track => track.id)); return [...merged, ...saved.filter(track => !ids.has(track.id))] }) }).catch(() => {}); return () => { alive = false } }, [])
  useEffect(() => { localStorage.setItem('ritmo-favorites', JSON.stringify(favorites)) }, [favorites])
  useEffect(() => { localStorage.setItem('ritmo-lists', JSON.stringify(userLists)) }, [userLists])
  useEffect(() => { localStorage.setItem('ritmo-history', JSON.stringify(history.slice(0, 30).map(({ file: _file, ...track }) => track))) }, [history])
  const toggleFavorite = (track: Track) => setFavorites(ids => ids.includes(track.id) ? ids.filter(id => id !== track.id) : [...ids, track.id])
  const createList = (event: React.FormEvent) => { event.preventDefault(); const name = listName.trim(); if (!name) return; const list = { id: crypto.randomUUID(), name, trackIds: [] }; setUserLists(items => [...items, list]); setSelectedList(list.id); setListName(''); setShowListForm(false) }
  const addToSelectedList = (track: Track) => setListPickerTrack(track)
  const addTrackToList = (listId: string) => { if (!listPickerTrack) return; setUserLists(items => items.map(list => list.id === listId && !list.trackIds.includes(listPickerTrack.id) ? { ...list, trackIds: [...list.trackIds, listPickerTrack.id] } : list)); setListPickerTrack(null) }
  const removeFromCurrentView = (track: Track) => { if (selectedList === 'favorites') { setFavorites(ids => ids.filter(id => id !== track.id)); return }; if (selectedList) { setUserLists(lists => lists.map(list => list.id === selectedList ? { ...list, trackIds: list.trackIds.filter(id => id !== track.id) } : list)); return }; remove(track) }
  const createListForTrack = (event: React.FormEvent) => { event.preventDefault(); const name = listName.trim(); if (!name) return; const list = { id: crypto.randomUUID(), name, trackIds: listPickerTrack ? [listPickerTrack.id] : [] }; setUserLists(items => [...items, list]); setSelectedList(list.id); setListName(''); setListPickerTrack(null); setShowListForm(false) }
  const add = (track: Track, index?: number) => { if (tracks.some(item => item.id === track.id)) return; const target = index ?? (insertAt === 'start' ? 0 : insertAt === 'position' ? Math.max(0, Number(position) - 1) : playlist.current.length); playlist.current.insert(track, target); const next = playlist.current.toArray(); setTracks(next); if (!active) setActive(track) }
  const remove = (track: Track) => { playlist.current.remove(track.id); void deleteStoredTrack(track.id); const next = playlist.current.toArray(); setTracks(next); setFavorites(ids => ids.filter(id => id !== track.id)); setUserLists(lists => lists.map(list => ({ ...list, trackIds: list.trackIds.filter(id => id !== track.id) }))); if (active?.id === track.id) { const oldIndex = Math.max(0, tracks.findIndex(t => t.id === track.id)); const upcoming = next[Math.min(oldIndex, next.length - 1)]; setActive(upcoming ?? null); setPlaying(false) } }
  const enableAudioProcessing = async (enabled: boolean) => {
    const element = audio.current
    if (!element) return
    try {
      if (!audioContext.current && window.AudioContext) {
        const context = new AudioContext(); const filter = context.createBiquadFilter(); const compressor = context.createDynamicsCompressor(); const meter = context.createAnalyser()
        filter.type = 'lowshelf'; filter.frequency.value = 105; filter.gain.value = enabled ? 8 : 0
        compressor.threshold.value = -9; compressor.knee.value = 7; compressor.ratio.value = 9; compressor.attack.value = .003; compressor.release.value = .2
        meter.fftSize = 2048; meter.smoothingTimeConstant = .72
        audioSource.current = context.createMediaElementSource(element); audioSource.current.connect(filter); filter.connect(meter); meter.connect(compressor); compressor.connect(context.destination)
        audioContext.current = context; bassFilter.current = filter; analyser.current = meter; setAudioFxReady(true)
      }
      if (bassFilter.current) bassFilter.current.gain.setTargetAtTime(enabled ? 8 : 0, audioContext.current?.currentTime ?? 0, .06)
      await audioContext.current?.resume()
    } catch { /* If audio filtering is unavailable, ordinary playback continues. */ }
  }
  const play = async (track: Track) => {
    setActive(track); setHistory(items => [track, ...items.filter(item => item.id !== track.id)].slice(0, 30)); setPlaying(true)
    if (track.source === 'local') requestAnimationFrame(() => {
      const element = audio.current
      if (!element) return
      void enableAudioProcessing(thumpMode)
      element.play().catch(() => setPlaying(false))
    })
  }
  const skip = (direction: -1 | 1) => { if (!active || !tracks.length) return; const index = tracks.findIndex(t => t.id === active.id); const next = tracks[(index + direction + tracks.length) % tracks.length]; play(next) }
  const addFiles = (files: FileList | null) => {
    if (!files) return
    const audioFiles = Array.from(files).filter(file => file.type.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|flac|aac|opus)$/i.test(file.name))
    const startIndex = insertAt === 'start' ? 0 : insertAt === 'position' ? Math.max(0, Number(position) - 1) : playlist.current.length
    audioFiles.forEach((file, index) => {
      const rawName = file.name.replace(/\.[^.]+$/, '')
      const [artist, ...rest] = rawName.split(' - ')
      add({ id: crypto.randomUUID(), title: rest.length ? rest.join(' - ') : rawName, artist: rest.length ? artist : 'Tu dispositivo', source: 'local', file, cover: '' }, startIndex + index)
    })
    if (filePicker.current) filePicker.current.value = ''
  }
  const searchYoutube = async (event: React.FormEvent) => {
    event.preventDefault(); if (query.trim().length < 2) return
    setSearching(true); setError(''); setResults([])
    try {
      const res = await fetch(`/api/youtube?q=${encodeURIComponent(query.trim())}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'No se pudo realizar la búsqueda.')
      setResults((data.videos ?? []).map((v: any) => ({ id: `yt-${v.id}`, videoId: v.id, title: v.title, artist: v.artist, source: 'youtube', cover: v.thumbnail, duration: v.duration || undefined })))
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo conectar con YouTube.') }
    finally { setSearching(false) }
  }
  useEffect(() => { if (audio.current) audio.current.volume = volume }, [volume, active])
  useEffect(() => { if (bassFilter.current) bassFilter.current.gain.setTargetAtTime(thumpMode ? 8 : 0, audioContext.current?.currentTime ?? 0, .08) }, [thumpMode])
  useEffect(() => {
    if (!thumpMode || !playing || active?.source !== 'local' || !audioFxReady || !analyser.current) { setBassEnergy(0); return }
    const meter = analyser.current; const bins = new Uint8Array(meter.frequencyBinCount); let frame = 0; let lastPaint = 0; let smooth = 0
    const sample = (now: number) => { meter.getByteFrequencyData(bins); let sum = 0; const count = Math.min(12, bins.length - 1); for (let i = 1; i <= count; i++) sum += bins[i] / 255; const level = sum / count; const raw = Math.min(1, Math.max(0, level - .05) * 1.45); smooth = smooth * .76 + raw * .24; if (now - lastPaint > 45) { setBassEnergy(smooth); lastPaint = now }; frame = requestAnimationFrame(sample) }
    frame = requestAnimationFrame(sample)
    return () => { cancelAnimationFrame(frame); setBassEnergy(0) }
  }, [thumpMode, playing, active?.id, active?.source, audioFxReady])
  useEffect(() => { let alive = true; setLyrics(null); if (!active) return; setLyricsLoading(true); const params = new URLSearchParams({ track: active.title, artist: active.artist }); void fetch(`/api/lyrics?${params}`).then(response => response.ok ? response.json() : null).then(data => { if (alive && data && (data.syncedLyrics || data.plainLyrics)) setLyrics(data) }).catch(() => {}).finally(() => { if (alive) setLyricsLoading(false) }); return () => { alive = false } }, [active?.id])
  useEffect(() => {
    if (active?.source !== 'youtube' || !active.videoId) return
    let cancelled = false; let timer = 0
    setCurrentTime(0); setDuration(active.duration ?? 0)
    void loadYouTubeApi().then(YT => {
      if (cancelled || !youtubeFrame.current) return
      youtubePlayer.current = new YT.Player(youtubeFrame.current, { events: { onReady: (event: { target: YouTubePlayer }) => { if (cancelled) return; youtubePlayer.current = event.target; const sync = () => { const nextDuration = event.target.getDuration(); setCurrentTime(event.target.getCurrentTime() || 0); if (nextDuration > 0) { setDuration(nextDuration); setActive(current => current?.id === active.id && current.duration !== nextDuration ? { ...current, duration: nextDuration } : current); setTracks(rows => rows.some(track => track.id === active.id && track.duration !== nextDuration) ? rows.map(track => track.id === active.id ? { ...track, duration: nextDuration } : track) : rows) } }; sync(); timer = window.setInterval(sync, 500) } } })
    }).catch(() => {})
    return () => { cancelled = true; window.clearInterval(timer); youtubePlayer.current?.destroy(); youtubePlayer.current = null }
  }, [active?.id])
  useEffect(() => { if (!active?.file) { setLocalSrc(''); return }; const url = URL.createObjectURL(active.file); setLocalSrc(url); return () => URL.revokeObjectURL(url) }, [active?.id])
  useEffect(() => { if (active?.source !== 'local' || !audio.current) return; if (playing) audio.current.play().catch(() => setPlaying(false)); else audio.current.pause() }, [playing, localSrc])
  useEffect(() => { if (active?.source !== 'youtube') return; youtubeFrame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: playing ? 'playVideo' : 'pauseVideo', args: [] }), 'https://www.youtube-nocookie.com') }, [playing, active?.id])
  useEffect(() => { const el = audio.current; if (!el) return; const time = () => setCurrentTime(el.currentTime); const meta = () => { const length = Number.isFinite(el.duration) ? el.duration : 0; setDuration(length); if (active && length) { setActive(current => current?.id === active.id ? { ...current, duration: length } : current); setTracks(rows => rows.map(track => track.id === active.id ? { ...track, duration: length } : track)) } }; const end = () => skip(1); el.addEventListener('timeupdate', time); el.addEventListener('loadedmetadata', meta); el.addEventListener('ended', end); return () => { el.removeEventListener('timeupdate', time); el.removeEventListener('loadedmetadata', meta); el.removeEventListener('ended', end) } }, [tracks, active])
  useEffect(() => { setCurrentTime(0); setDuration(active?.duration ?? 0) }, [active?.id, active?.duration])
  const flip = () => { if (!active && tracks[0]) { play(tracks[0]); return }; if (!active) return; if (active.source === 'local' && audio.current) { if (playing) audio.current.pause(); else audio.current.play().catch(() => setPlaying(false)) }; setPlaying(!playing) }

  const pulse = active?.source === 'youtube' ? .62 : bassEnergy
  const pulseStyle = { '--pulse-scale': 1 + pulse * .09, '--pulse-glow': `${10 + pulse * 36}px`, '--pulse-opacity': .12 + pulse * .5 } as React.CSSProperties
  return <div className={`app-shell ${thumpMode && playing ? 'bass-mode-active' : ''}`} style={pulseStyle}>
    <aside className="sidebar">
      <a className="brand" href="#"><span className="brand-mark"><AudioLines size={19}/></span><span>ritmo<span className="brand-dot">.</span></span></a>
      <div className="sidebar-label">MENÚ</div>
      <nav className="nav-list"><button className="nav-item active"><Disc3 size={18}/> Mi biblioteca</button><button className="nav-item" onClick={() => document.getElementById('youtube-search')?.focus()}><Search size={18}/> Explorar música</button><button className="nav-item" onClick={() => filePicker.current?.click()}><FolderOpen size={18}/> Archivos locales</button></nav>
      <div className="sidebar-label collection-label">TU COLECCIÓN <button onClick={() => setShowListForm(true)} aria-label="Crear lista"><Plus size={15}/></button></div>
      <button className={`collection-card ${!selectedList ? 'active' : ''}`} onClick={() => { setSelectedList(''); setFilter('all') }}><span className="collection-icon"><ListMusic size={17}/></span><span><b>Mi playlist</b><small>{tracks.length} canciones</small></span><ChevronDown size={15}/></button>
      <button className={`collection-card ${selectedList === 'favorites' ? 'active' : ''}`} onClick={() => { setSelectedList('favorites'); setFilter('all') }}><span className="collection-icon"><Heart size={17}/></span><span><b>Favoritos</b><small>{favorites.length} canciones</small></span></button>
      {userLists.map(list => <button className={`collection-card ${selectedList === list.id ? 'active' : ''}`} key={list.id} onClick={() => { setSelectedList(list.id); setFilter('all') }}><span className="collection-icon"><ListMusic size={17}/></span><span><b>{list.name}</b><small>{list.trackIds.length} canciones</small></span></button>)}
      {showListForm && <form className="new-list-form" onSubmit={createList}><input autoFocus value={listName} onChange={e => setListName(e.target.value)} placeholder="Nombre de la lista" aria-label="Nombre de la lista"/><button type="submit" aria-label="Crear"><Plus size={15}/></button><button type="button" onClick={() => setShowListForm(false)} aria-label="Cancelar"><X size={15}/></button></form>}
      <button className={`nav-item history-nav ${showHistory ? 'active' : ''}`} onClick={() => setShowHistory(value => !value)}><History size={17}/> Historial <span>{history.length}</span></button>
      {showHistory && <div className="history-list">{history.length ? history.slice(0, 8).map(track => <button key={track.id} onClick={() => { const playable = tracks.find(item => item.id === track.id) ?? track; if (playable.source === 'local' && !playable.file) { setError('Vuelve a elegir este archivo local para reproducirlo.'); filePicker.current?.click(); return }; play(playable) }}><b>{track.title}</b><small>{track.artist}</small></button>) : <small className="history-empty">Todavía no has reproducido canciones.</small>}</div>}
      <div className="sidebar-tip"><div className="tip-icon"><Music2 size={16}/></div><strong>Tu música, a tu manera.</strong><span>Elige canciones del dispositivo o explora YouTube.</span></div>
      <div className="sidebar-bottom"><span className="cloud-status"><i/> Lista para desplegar</span><button className="help"><CircleHelp size={16}/> Acerca de Ritmo</button></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="breadcrumb">Biblioteca <span>/</span> <b>{selectedList === 'favorites' ? 'Favoritos' : userLists.find(l => l.id === selectedList)?.name ?? 'Mi playlist'}</b></div><div className="top-actions"><span className="cloud-pill"><i/> Lista para desplegar</span><button className="avatar">M</button></div></header>
      <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> TU ESPACIO MUSICAL</div><h1>Todo tu ritmo.<br/><em>En un solo lugar.</em></h1><p>Tu colección personal y la música que aún no conoces.</p><div className="hero-buttons"><button className="primary-btn" onClick={() => filePicker.current?.click()}><Plus size={17}/> Agregar música</button><button className="secondary-btn" onClick={() => document.getElementById('youtube-search')?.focus()}><Search size={17}/> Explorar canciones</button></div></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="vinyl"><div className="vinyl-groove"/><div className="vinyl-label"><AudioLines size={27}/></div></div><div className="floating-note note-a">♪</div><div className="floating-note note-b">♫</div><div className="art-caption">PRESS PLAY<br/><b>FEEL EVERYTHING</b></div></div></section>

      <section className="search-section"><div className="section-heading"><div><span className="section-kicker">ENCUENTRA ALGO NUEVO</span><h2>Buscar música</h2></div><span className="youtube-badge"><Youtube size={16}/> YouTube</span></div><form id="youtube-search" className="search-box" onSubmit={searchYoutube}><Search size={18}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Busca artistas, canciones o álbumes en YouTube" aria-label="Buscar música en YouTube"/><button type="submit" disabled={searching || query.trim().length < 2}>{searching ? <LoaderCircle size={17} className="spin"/> : 'Buscar'}</button></form>
      {error && <div className="error-box"><span>{error}</span><button onClick={() => setError('')} aria-label="Cerrar"><X size={15}/></button></div>}
      {results.length > 0 && <div className="results-grid">{results.map(track => <article className="result-card" key={track.id}><button className="result-cover" onClick={() => { add(track); play(track) }} aria-label={`Reproducir ${track.title}`}><img src={track.cover} alt=""/><span><Play size={18} fill="currentColor"/></span></button><div className="result-meta"><strong title={track.title}>{track.title}</strong><small>{track.artist}</small></div><button className="icon-button result-add" onClick={() => add(track)} title="Añadir a la playlist"><Plus size={17}/></button></article>)}</div>}
      </section>

      <section className="playlist-section"><div className="playlist-heading"><div><span className="section-kicker">TU COLECCIÓN PERSONAL</span><h2>{selectedList === 'favorites' ? 'Favoritos' : userLists.find(l => l.id === selectedList)?.name ?? 'Mi playlist'} <span className="count">{selectedList === 'favorites' ? favorites.length : selectedList ? userLists.find(l => l.id === selectedList)?.trackIds.length ?? 0 : tracks.length}</span></h2></div><div className="playlist-tools"><label className="local-search"><Search size={14}/><input value={localQuery} onChange={e => setLocalQuery(e.target.value)} placeholder="Buscar en tu música" aria-label="Buscar en tu playlist"/></label><select className="insert-select" aria-label="Dónde agregar canciones" value={insertAt} onChange={e => setInsertAt(e.target.value)}><option value="end">Añadir al final</option><option value="start">Añadir al inicio</option><option value="position">Elegir posición</option></select>{insertAt === 'position' && <input className="position-input" aria-label="Posición de inserción" type="number" min="1" max={tracks.length + 1} value={position} onChange={e => setPosition(e.target.value)} />}<button className="sort-button" onClick={() => setFilter(filter === 'all' ? 'local' : filter === 'local' ? 'youtube' : 'all')}><SlidersHorizontal size={16}/>{filter === 'all' ? 'Todo' : filter === 'local' ? 'Dispositivo' : 'YouTube'}<ChevronDown size={14}/></button></div></div>
      <div className="track-table"><div className="track-header"><span>#</span><span>TÍTULO</span><span>FUENTE</span><span>DURACIÓN</span><span/></div>
        {visibleTracks.map((track, index) => <div className={`track-row ${active?.id === track.id ? 'selected' : ''}`} key={track.id} onDoubleClick={() => play(track)}><span className="track-index">{active?.id === track.id && playing ? <AudioLines size={16} className="playing-mark"/> : String(index + 1).padStart(2, '0')}</span><div className="track-title"><button className="cover-mini" onClick={() => play(track)}>{track.cover ? <img src={track.cover} alt=""/> : <Music2 size={17}/>}</button><div><strong>{track.title}</strong><small>{track.artist}</small></div></div><span className={`source-tag ${track.source}`}>{track.source === 'local' ? <><FolderOpen size={13}/> Mi dispositivo</> : <><Youtube size={13}/> YouTube</>}</span><span className="track-duration">{fmt(track.duration)}</span><button className={`icon-button favorite-row ${favorites.includes(track.id) ? 'is-favorite' : ''}`} onClick={() => toggleFavorite(track)} aria-label={favorites.includes(track.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'}><Heart size={15} fill={favorites.includes(track.id) ? 'currentColor' : 'none'}/></button><button className="icon-button add-list-row" onClick={() => addToSelectedList(track)} aria-label="Agregar a una lista" title="Agregar a una lista"><ListMusic size={15}/></button><button className="icon-button delete-track" onClick={() => removeFromCurrentView(track)} aria-label={`Quitar ${track.title} de esta lista`}><X size={16}/></button></div>)}
        {visibleTracks.length === 0 && <div className="empty-state"><div className="empty-disc"><Music2 size={24}/></div><strong>{collectionTracks.length ? 'No hay canciones en esta vista' : selectedList === 'favorites' ? 'Aún no tienes favoritos' : selectedList ? 'Esta lista está vacía' : 'Tu playlist empieza aquí'}</strong><span>{collectionTracks.length ? 'Prueba con otro filtro o búsqueda.' : selectedList === 'favorites' ? 'Pulsa el corazón de una canción para guardarla aquí.' : selectedList ? 'Usa el botón de lista junto a una canción para añadirla.' : 'Agrega archivos de audio de tu dispositivo o busca música en YouTube.'}</span>{!tracks.length && <button onClick={() => filePicker.current?.click()}><Plus size={15}/> Elegir archivos</button>}</div>}
      </div>
      {tracks.length > 0 && <div className="table-footer"><span><span className="footer-pip"/> Cambios guardados en esta sesión</span><button onClick={() => filePicker.current?.click()}><Plus size={14}/> Agregar canciones</button></div>}
      </section>
    </main>

    <aside className={`now-playing ${thumpMode ? 'thump-mode' : ''} ${playing ? 'is-playing' : ''}`}><div className="thump-flash"/><div className="now-top"><span>REPRODUCIENDO AHORA</span><button className={`thump-toggle ${thumpMode ? 'enabled' : ''}`} onClick={() => { const enabled = !thumpMode; setThumpMode(enabled); if (active?.source === 'local') void enableAudioProcessing(enabled) }} aria-pressed={thumpMode}><Waves size={15}/> {thumpMode ? 'Retumbe activo' : 'Modo retumbe'}</button></div><div className={`player-art ${active?.source === 'youtube' ? 'youtube-art' : ''}`}>{active?.source === 'youtube' && active.videoId ? <iframe ref={youtubeFrame} key={active.id} src={`https://www.youtube-nocookie.com/embed/${active.videoId}?autoplay=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`} title={`Reproduciendo ${active.title}`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen/> : active?.cover ? <img src={active.cover} alt=""/> : <div className="art-placeholder"><div className="art-ring"><AudioLines size={36}/></div><span>RITMO</span></div>}</div>
      <div className="now-track"><div><span className="now-source">{active ? active.source === 'local' ? 'DESDE TU DISPOSITIVO' : 'YOUTUBE MUSIC' : 'TU REPRODUCTOR'}</span><h3>{active?.title ?? '¿Qué escuchamos?'}</h3><p>{active?.artist ?? 'Elige una canción para empezar'}</p></div><button className={`heart-button ${active && favorites.includes(active.id) ? 'is-favorite' : ''}`} onClick={() => active && toggleFavorite(active)} aria-label="Agregar a favoritos"><Heart size={19} fill={active && favorites.includes(active.id) ? 'currentColor' : 'none'}/></button></div>
      <audio ref={audio} src={active?.source === 'local' ? localSrc || undefined : undefined} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
      {active?.source === 'youtube' && <p className="youtube-note">Reproducción oficial de YouTube</p>}
      <div className="waveform" aria-hidden="true">{Array.from({ length: 45 }, (_, i) => <i key={i} style={{ height: `${8 + ((i * 37 + 13) % 29)}px`, opacity: i < Math.round(currentTime / (duration || 1) * 45) ? .9 : .32 }}/>)}</div>
      <div className="timeline"><span>{fmt(currentTime)}</span><input aria-label="Progreso de reproducción" type="range" min="0" max={duration || 100} value={duration ? currentTime : 0} onChange={e => { const time = Number(e.target.value); if (active?.source === 'local' && audio.current) audio.current.currentTime = time; else youtubePlayer.current?.seekTo(time, true) }}/><span>{fmt(duration)}</span></div>
      <div className="player-controls"><button className="subtle-control" aria-label="Anterior" onClick={() => skip(-1)}><SkipBack size={19} fill="currentColor"/></button><button className="play-control" aria-label={playing ? 'Pausar' : 'Reproducir'} onClick={flip}>{playing ? <Pause size={22} fill="currentColor"/> : <Play size={22} fill="currentColor"/>}</button><button className="subtle-control" aria-label="Siguiente" onClick={() => skip(1)}><SkipForward size={19} fill="currentColor"/></button></div>
      <div className="player-bottom"><span><Radio size={15}/> En reproducción</span><div className="volume-control"><Volume2 size={16}/><input aria-label="Volumen" type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(Number(e.target.value))}/></div></div>
      <div className="queue-card"><div className="queue-icon"><ListMusic size={16}/></div><div><b>Cola de reproducción</b><small>{tracks.length} {tracks.length === 1 ? 'canción' : 'canciones'} en tu playlist</small></div><ChevronDown size={15}/></div>
    </aside>
    {thumpMode && playing && active && <div className="center-lyrics" aria-live="polite"><span className="lyrics-label">LETRA {parsedLyrics.length ? 'SINCRONIZADA' : 'APROXIMADA'}</span><div className="lyrics-stack">{lyricsLoading ? <p className="lyric-current">Buscando la letra…</p> : lyricIndex < 0 ? <p className="lyric-current">No encontramos la letra de esta canción</p> : <>{(parsedLyrics.length ? parsedLyrics.map(line => line.text) : lyricTextLines).slice(Math.max(0, lyricIndex - 1), lyricIndex + 2).map((line, index, rows) => <p className={`lyric-line ${index === Math.min(1, rows.length - 1) ? 'lyric-current' : ''}`} key={`${index}-${line}`}>{line}</p>)}</>}</div><a href="https://lrclib.net" target="_blank" rel="noreferrer">Letras proporcionadas por LRCLIB</a></div>}
    <input ref={filePicker} className="hidden-input" type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac,.opus" multiple onChange={e => addFiles(e.target.files)} />
    {listPickerTrack && <div className="modal-backdrop" onClick={() => setListPickerTrack(null)}><section className="list-picker-modal" role="dialog" aria-modal="true" aria-labelledby="list-picker-title" onClick={event => event.stopPropagation()}><div className="modal-heading"><div><span className="section-kicker">TU COLECCIÓN</span><h2 id="list-picker-title">Agregar a una lista</h2><p>{listPickerTrack.title}</p></div><button className="icon-button" onClick={() => setListPickerTrack(null)} aria-label="Cerrar"><X size={18}/></button></div><div className="list-picker-options">{userLists.length ? userLists.map(list => <button key={list.id} onClick={() => addTrackToList(list.id)}><ListMusic size={17}/><span><b>{list.name}</b><small>{list.trackIds.length} canciones</small></span><Plus size={16}/></button>) : <p>Aún no has creado listas. Crea una para guardar esta canción.</p>}</div><form className="create-list-inline" onSubmit={createListForTrack}><input value={listName} onChange={e => setListName(e.target.value)} placeholder="Nombre de una lista nueva" aria-label="Nombre de una lista nueva"/><button type="submit" disabled={!listName.trim()}><Plus size={15}/> Crear lista</button></form></section></div>}
  </div>
}
