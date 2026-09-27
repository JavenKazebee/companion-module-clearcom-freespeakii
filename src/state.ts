import type {
	Connection,
	ConnectionLiveStatus,
	DeviceLiveStatus,
	Endpoint,
	EndpointUpdatedEvent,
	Gpio,
	Port,
	Role,
} from './types.js'
import { isCalling, packName } from './resolve.js'

/** What changed in a state update, so the module only redraws what it must. */
export interface StateChange {
	/** Live values changed: re-check feedbacks and variables. */
	live: boolean
	/** Ids/labels changed: rebuild action/feedback/variable definitions. */
	structure: boolean
}

export interface IncomingCall {
	label: string
	channel: string
	time: Date
}

const NONE: StateChange = { live: false, structure: false }
/** How long a channel call sent from Companion labels the packs it rings (the base does not report the channel). */
const CALL_CHANNEL_MS = 10_000

/** Set `obj.a.b.c = value` for a dotted path, creating intermediate objects. */
export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
	const parts = path.split('.')
	let cur: Record<string, unknown> = obj
	for (const key of parts.slice(0, -1)) {
		if (typeof cur[key] !== 'object' || cur[key] === null) cur[key] = {}
		cur = cur[key] as Record<string, unknown>
	}
	cur[parts[parts.length - 1]] = value
}

/** Identity of an endpoint for dropdown purposes: changes when a pack appears or is renamed, not on live status. */
function endpointStructureKey(e: Endpoint): string {
	return `${e.id}|${e.label}|${e.type}`
}

export class FsiiState {
	endpoints = new Map<number, Endpoint>()
	roles = new Map<number, Role>()
	connections = new Map<number, Connection>()
	connectionLive = new Map<number, ConnectionLiveStatus>()
	ports = new Map<number, Port>()
	gpis = new Map<number, Gpio>()
	gpos = new Map<number, Gpio>()
	device: DeviceLiveStatus | null = null
	lastCall: IncomingCall | null = null
	/** False until the first full snapshot after a (re)connect has arrived. */
	ready = false

	#endpointJson = new Map<number, string>()
	#callChannels = new Map<number, { label: string; until: number }>()

	/** Remember which channel a Companion channel call was sent on, so the packs it rings report that channel. */
	noteCallChannel(endpointIds: number[], label: string): void {
		const until = Date.now() + CALL_CHANNEL_MS
		for (const id of endpointIds) this.#callChannels.set(id, { label, until })
	}

	/**
	 * A pack's call signal (liveStatus.callState) went active: record it as the last call. This is the only call
	 * signal the base reports for calls sent from Companion or the web UI; connection events.call stays false.
	 * The pack here is the one being rung, so a call Companion sent is credited to Companion, not to that pack.
	 */
	#trackCall(e: Endpoint, wasCalling: boolean): void {
		if (wasCalling || !isCalling(e)) return
		const origin = this.#callChannels.get(e.id)
		const fromCompanion = !!origin && origin.until > Date.now()
		this.lastCall = {
			label: fromCompanion ? 'Companion' : packName(this, e),
			channel: fromCompanion ? origin.label : '',
			time: new Date(),
		}
	}

	/** Full endpoint snapshot (EndpointInit or REST). Redundant broadcasts from other clients are no-ops. */
	setEndpoints(list: Endpoint[]): StateChange {
		let live = false
		let structure = list.length !== this.endpoints.size
		const seen = new Set<number>()
		for (const e of list) {
			seen.add(e.id)
			const json = JSON.stringify(e)
			if (this.#endpointJson.get(e.id) === json) continue
			const prev = this.endpoints.get(e.id)
			if (!prev || endpointStructureKey(prev) !== endpointStructureKey(e)) structure = true
			this.endpoints.set(e.id, e)
			this.#endpointJson.set(e.id, json)
			// packs already calling in the first snapshot are not a new call
			this.#trackCall(e, !prev || isCalling(prev))
			live = true
		}
		for (const id of [...this.endpoints.keys()]) {
			if (!seen.has(id)) {
				this.endpoints.delete(id)
				this.#endpointJson.delete(id)
				live = structure = true
			}
		}
		return { live, structure }
	}

	applyEndpointUpdate(evt: EndpointUpdatedEvent): StateChange {
		const e = this.endpoints.get(evt?.endpointId)
		if (!e || typeof evt.path !== 'string' || !evt.path) return NONE
		const before = endpointStructureKey(e)
		const wasCalling = isCalling(e)
		setByPath(e, evt.path, evt.value)
		this.#endpointJson.set(e.id, JSON.stringify(e))
		this.#trackCall(e, wasCalling)
		return { live: true, structure: endpointStructureKey(e) !== before }
	}

	addEndpoint(e: Endpoint): StateChange {
		if (!e || typeof e.id !== 'number') return NONE
		this.endpoints.set(e.id, e)
		this.#endpointJson.set(e.id, JSON.stringify(e))
		return { live: true, structure: true }
	}

	removeEndpoint(id: number): StateChange {
		if (!this.endpoints.delete(id)) return NONE
		this.#endpointJson.delete(id)
		return { live: true, structure: true }
	}

	setRoles(list: Role[]): StateChange {
		return this.#replaceMap(this.roles, list, (r) => `${r.id}|${r.label}|${r.type}`)
	}

	setConnections(list: Connection[]): StateChange {
		return this.#replaceMap(this.connections, list, (c) => `${c.id}|${c.label}|${c.type}`)
	}

	setPorts(list: Port[]): StateChange {
		const change = this.#replaceMap(
			this.ports,
			list,
			(p) => `${p.port_id}|${p.port_label}`,
			(p) => p.port_id,
			false,
		)
		return { live: true, structure: change.structure }
	}

	/** Connection live status carries per-participant talk/call flags; also detects new incoming calls. */
	setConnectionLive(
		list: ConnectionLiveStatus[],
		labelFor: (p: ConnectionLiveStatus['participants'][0]) => string,
	): StateChange {
		for (const conn of list) {
			const prev = this.connectionLive.get(conn.id)
			for (const p of conn.participants ?? []) {
				if (!p.events?.call) continue
				const wasCalling = prev?.participants?.some((q) => q.id === p.id && q.events?.call)
				if (!wasCalling) this.lastCall = { label: labelFor(p), channel: conn.label, time: new Date() }
			}
		}
		this.connectionLive = new Map(list.map((c) => [c.id, c]))
		return { live: true, structure: false }
	}

	/** GpiInit / GpoInit snapshot for one kind. */
	setGpio(kind: 'gpi' | 'gpo', list: Gpio[]): StateChange {
		const map = kind === 'gpi' ? this.gpis : this.gpos
		const change = this.#replaceMap(
			map,
			list,
			(g) => `${g.id}|${g.label}`,
			(g) => g.id,
			false,
		)
		return { live: true, structure: change.structure }
	}

	/** Gpi/GpoUpdated events: merge whatever fields arrive into the matching entry. */
	updateGpio(kind: 'gpi' | 'gpo', data: Partial<Gpio> & { id: number }): StateChange {
		const map = kind === 'gpi' ? this.gpis : this.gpos
		const cur = map.get(data?.id)
		if (!cur) return NONE
		map.set(data.id, { ...cur, ...data, liveStatus: { ...cur.liveStatus, ...data.liveStatus } })
		return { live: true, structure: false }
	}

	/** Returns true when the base appears to have rebooted (uptime went backwards). */
	setDevice(status: DeviceLiveStatus): { change: StateChange; rebooted: boolean } {
		const rebooted = !!this.device && status.uptime < this.device.uptime
		const changed = JSON.stringify(this.device) !== JSON.stringify(status)
		this.device = status
		return { change: { live: changed, structure: false }, rebooted }
	}

	#replaceMap<T, K>(
		map: Map<K, T>,
		list: T[],
		key: (item: T) => string,
		id: (item: T) => K = (item) => (item as { id: K }).id,
		live = true,
	): StateChange {
		const before = [...map.values()].map(key).join('\n')
		map.clear()
		for (const item of list ?? []) map.set(id(item), item)
		const after = [...map.values()].map(key).join('\n')
		return { live, structure: before !== after }
	}
}

export function mergeChanges(...changes: StateChange[]): StateChange {
	return { live: changes.some((c) => c.live), structure: changes.some((c) => c.structure) }
}
