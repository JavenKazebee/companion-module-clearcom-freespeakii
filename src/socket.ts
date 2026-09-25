import { EventEmitter } from 'node:events'
import io from 'socket.io-client'

// Topics the CCM UI subscribes to. The server answers each with `live:<topic> {updated:true}` dirty flags.
const LIVE_TOPICS = ['devices', 'interfaces', 'ports', 'roles', 'connections', 'vpl', 'calls', 'alerts', 'endpoints']

export interface FsiiSocketEvents {
	connect: []
	disconnect: [reason: string]
	/** Every server event, e.g. ('EndpointUpdated', {...}) or ('live:roles', {updated:true}) */
	event: [name: string, data: unknown]
}

/**
 * socket.io 2.x client for the base (the server speaks Engine.IO v3, so newer clients cannot connect).
 * Re-subscribes and requests fresh snapshots after every (re)connect.
 */
export class FsiiSocket extends EventEmitter<FsiiSocketEvents> {
	#socket: SocketIOClient.Socket | null = null

	constructor(private readonly host: string) {
		super()
	}

	get connected(): boolean {
		return this.#socket?.connected ?? false
	}

	start(): void {
		const socket = io(`http://${this.host}/`, {
			transports: ['websocket'],
			reconnection: true,
			reconnectionDelay: 1000,
			reconnectionDelayMax: 5000,
			timeout: 5000,
		})
		this.#socket = socket

		// socket.io v2 has no onAny(): wrap onevent to forward every server event.
		const s = socket as unknown as { onevent: (packet: { data: [string, ...unknown[]] }) => void }
		const onevent = s.onevent
		s.onevent = (packet) => {
			const [name, data] = packet.data
			this.emit('event', name, data)
			onevent.call(socket, packet)
		}

		socket.on('connect', () => {
			this.#subscribe()
			this.emit('connect')
		})
		socket.on('disconnect', (reason: string) => this.emit('disconnect', reason))
	}

	#subscribe(): void {
		const socket = this.#socket
		if (!socket) return
		for (const topic of LIVE_TOPICS) socket.emit('live:update', { [topic]: 'start' })
		// EndpointInit replies are broadcast to every connected client, so only ask on (re)connect.
		socket.emit('EndpointInit', {})
		socket.emit('GpiInit', {})
		socket.emit('GpoInit', {})
	}

	stop(): void {
		this.#socket?.removeAllListeners()
		this.#socket?.close()
		this.#socket = null
		this.removeAllListeners()
	}
}
