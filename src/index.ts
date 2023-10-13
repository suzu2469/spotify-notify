import { RESTPostAPIWebhookWithTokenJSONBody } from 'discord-api-types/v10'
import { Buffer } from 'node:buffer'

export interface Env {
	SPOTIFY_CLIENT_ID: string
	SPOTIFY_CLIENT_SECRET: string
	SPOTIFY_PLAYLIST_ID: string
	DISCORD_WEBHOOK_URL: string
}

export default {
	async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		console.log(env)
		ctx.waitUntil((async () => {
			const accessToken = await requestAccessToken(env)
			if (accessToken instanceof Error) {
				console.error(accessToken)
				return
			}

			const items = await requestReleaseRador(env.SPOTIFY_PLAYLIST_ID, accessToken)
			if (items instanceof Error) {
				console.error(items)
				return
			}

			const result = await notifyToDiscord(env.DISCORD_WEBHOOK_URL, items)
			if (result instanceof Error) {
				console.error(result)
				return
			}

			console.info("notify completed")
		})())
	},
};

type SpotifyAccessTokenResponseBody = {
	access_token: string
	token_type: string
	expires_in: number
}

async function requestAccessToken(env: Env): Promise<string | Error> {
	const data = new URLSearchParams()

	data.append("grant_type", "client_credentials")
	data.append("client_id", env.SPOTIFY_CLIENT_ID)
	data.append("client_secret", env.SPOTIFY_CLIENT_SECRET)

	const res = await fetch('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: data.toString()
	})

	if (!res.ok) {
		return new Error(`failed request token status: ${res.status}: ${await res.text()}`)
	}

	const body: SpotifyAccessTokenResponseBody = await res.json()
	return body.access_token
}

type SpotifyPlaylistTracksResponseBody = {
	href: string
	limit: string
	next: string
	offset: string
	previous: string
	total: string
	items: SpotifyPlaylistTrack[]
}

type SpotifyPlaylistTrack = {
	added_at: string
	added_by: Record<string, unknown>
	is_local: boolean
	track: SpotifyTrack
}

type SpotifyTrack = {
	id: string
	artists: SpotifyArtist[]
	external_urls: {
		spotify: string
	}
	name: string
	album: SpotifyAlbum
}

type SpotifyAlbum = {
	images: SpotifyAlbumImage[]
}

type SpotifyAlbumImage = {
	url: string
	height: number
	width: number
}

type SpotifyArtist = {
	id: string
	name: string
}

async function requestReleaseRador(playlistID: string, accessToken: string): Promise<SpotifyPlaylistTrack[] | Error> {
	const url = new URL(`https://api.spotify.com/v1/playlists/${playlistID}/tracks`)
	const res = await fetch(url, { headers: { "Authorization": `Bearer ${accessToken}` } })

	if (!res.ok) {
		return new Error(`Failed to get playlist items: ${await res.text()}`)
	}

	const body: SpotifyPlaylistTracksResponseBody = await res.json()
	return body.items
}

async function notifyToDiscord(webhookURL: string, items: SpotifyPlaylistTrack[]): Promise<Error | null> {
	const requestBody: RESTPostAPIWebhookWithTokenJSONBody = {
		content: "Weekly Release Rador",
		embeds: items.filter((_, i) => i <= 9).map(item => ({
			title: item.track.name,
			author: {
				name: item.track.artists.reduce((curr, prev) => curr !== "" ? `${curr}, ${prev.name}` : prev.name, "") ?? ""
			},
			url: item.track.external_urls.spotify,
			thumbnail: {
				url: item.track.album.images[0].url,
				height: item.track.album.images[0].height,
				width: item.track.album.images[0].width,
			}
		}))
	}
	const res = await fetch(webhookURL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) })
	if (!res.ok) {
		return new Error(`Failed to notify to discord status: ${res.status}: ${await res.text()}`)
	}

	return null
}
