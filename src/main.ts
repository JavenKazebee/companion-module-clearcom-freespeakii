import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { DEFAULT_CONFIG, GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, computeVariableValues, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { FsiiApi } from './api.js'
import { FsiiSocket } from './socket.js'
import { FsiiState, mergeChanges, type StateChange } from './state.js'
import { isOnline, packs, participantName } from './resolve.js'
import { INTERFACE_HW_INDEXES, type Endpoint, type EndpointUpdatedEvent, type Gpio } from './types.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

/** Firmware versions this module has been verified against. */
const TESTED_VERSIONS = ['1.6.15.0']
const REDRAW_MS = 50
const DEFINITIONS_MS = 500
const REFETCH_MS = 250

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config: ModuleConfig = { ...DEFAULT_CONFIG }
	state = new FsiiState()
	api: FsiiApi | null = null

	#socket: FsiiSocket | null = null
	#timers = new Set<NodeJS.Timeout>()
	#debounces = new Map<string, NodeJS.Timeout>()
	#heartbeat: NodeJS.Timeout | null = null
	#lastValues: VariablesSchema = {}
	#lastStatus = ''
	#warnedVersion = false
	#unknownEvents = new Set<string>()

	constructor(internal: unknown) {
		super(internal)
	}

	get socketConnected(): boolean {
		return this.#socket?.connected ?? false
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.#defineAll()
		this.#start()
	}

	async destroy(): Promise<void> {
		this.#stop()
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.#stop()
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.state = new FsiiState()
		this.#lastValues = {}
		this.#defineAll()
		this.#start()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	/** setTimeout that is cancelled when the module stops (used for pulse actions). */
	schedule(ms: number, fn: () => void): void {
		const t = setTimeout(() => {
			this.#timers.delete(t)
			fn()
		}, ms)
		this.#timers.add(t)
	}

	// --- lifecycle ---------------------------------------------------------------------------------

	#start(): void {
		const host = this.config.host?.trim()
		if (!host) {
			this.#setStatus(InstanceStatus.BadConfig, 'Set the base IP address or hostname')
			return
		}
		this.api = new FsiiApi(host, this.config.deviceId)
		this.#setStatus(InstanceStatus.Connecting, `Connecting to ${host}`)

		const socket = new FsiiSocket(host)
		this.#socket = socket
		socket.on('connect', () => void this.#onConnect())
		socket.on('disconnect', (reason) => this.#onDisconnect(reason))
		socket.on('event', (name, data) => this.#onEvent(name, data))
		socket.start()

		this.#heartbeat = setInterval(() => void this.#pollDevice(), this.config.heartbeatMs)
	}

	#stop(): void {
		this.#socket?.stop()
		this.#socket = null
		this.api = null
		if (this.#heartbeat) clearInterval(this.#heartbeat)
		this.#heartbeat = null
		for (const t of this.#timers) clearTimeout(t)
		this.#timers.clear()
		for (const t of this.#debounces.values()) clearTimeout(t)
		this.#debounces.clear()
	}

	async #onConnect(): Promise<void> {
		this.log('info', `Connected to ${this.config.host}`)
		this.state.ready = false
		await this.#fullRefresh()
	}

	#onDisconnect(reason: string): void {
		this.log('warn', `Lost connection to ${this.config.host}: ${reason}`)
		this.state.ready = false
		this.#setStatus(InstanceStatus.ConnectionFailure, `Lost connection to ${this.config.host}`)
		this.#apply({ live: true, structure: false })
	}

	/** Fetch every REST snapshot. Called on (re)connect and after a base reboot. */
	async #fullRefresh(): Promise<void> {
		const api = this.api
		if (!api) return
		try {
			const [device, roles, connections, live, gpio, endpoints, ...ports] = await Promise.all([
				api.deviceLiveStatus(),
				api.roles(),
				api.connections(),
				api.connectionsLiveStatus(),
				api.gpio(),
				api.endpoints(),
				...INTERFACE_HW_INDEXES.map(async (hw) => api.ports(hw).catch(() => [])),
			])
			if (api !== this.api) return // config changed while loading
			const s = this.state
			const change = mergeChanges(
				s.setDevice(device).change,
				s.setRoles(roles),
				s.setConnections(connections),
				s.setConnectionLive(live, (p) => participantName(s, p)),
				s.setGpio(
					'gpi',
					gpio.filter((g) => g.type === 0),
				),
				s.setGpio(
					'gpo',
					gpio.filter((g) => g.type === 1),
				),
				s.setEndpoints(endpoints),
				s.setPorts(ports.flat()),
			)
			s.ready = true
			this.#checkVersion(device.version)
			this.#apply({ ...change, structure: true })
		} catch (err) {
			this.log('error', `Loading state from the base failed: ${(err as Error).message}`)
			this.#setStatus(InstanceStatus.ConnectionFailure, `Cannot load state from ${this.config.host}`)
			this.schedule(5000, () => void (this.socketConnected && !this.state.ready && this.#fullRefresh()))
		}
	}

	async #pollDevice(): Promise<void> {
		if (!this.api) return
		try {
			const { change, rebooted } = this.state.setDevice(await this.api.deviceLiveStatus())
			if (rebooted) {
				this.log('warn', 'Base rebooted (uptime went backwards), reloading state')
				this.state.ready = false
				void this.#fullRefresh()
			}
			this.#apply(change)
		} catch (err) {
			if (!this.socketConnected)
				this.#setStatus(InstanceStatus.ConnectionFailure, `No response from ${this.config.host}`)
			this.log('debug', `Heartbeat failed: ${(err as Error).message}`)
		}
	}

	#checkVersion(version: string): void {
		if (this.#warnedVersion || TESTED_VERSIONS.some((v) => version.startsWith(v))) return
		this.#warnedVersion = true
		this.log(
			'warn',
			`Base firmware ${version} has not been tested with this module (tested: ${TESTED_VERSIONS.join(', ')})`,
		)
	}

	// --- socket events -----------------------------------------------------------------------------

	#onEvent(name: string, data: unknown): void {
		const s = this.state
		const d = data as Record<string, unknown> | undefined
		switch (name) {
			case 'EndpointInit':
				if (Array.isArray(d?.result)) this.#apply(s.setEndpoints(d.result as Endpoint[]))
				return
			case 'EndpointUpdated':
				this.#apply(s.applyEndpointUpdate(data as EndpointUpdatedEvent))
				return
			case 'EndpointAdded':
				this.#apply(s.addEndpoint(((d?.result ?? d?.endpoint ?? d) as Endpoint) ?? null))
				return
			case 'EndpointRemoved':
				this.#apply(s.removeEndpoint(Number(d?.endpointId ?? d?.id)))
				return
			case 'GpiInit':
			case 'GpoInit':
				if (Array.isArray(d?.result)) this.#apply(s.setGpio(name === 'GpiInit' ? 'gpi' : 'gpo', d.result as Gpio[]))
				return
			case 'GpiUpdated':
			case 'GpoUpdated': {
				const g = (d?.result ?? d) as (Partial<Gpio> & { id: number }) | undefined
				if (g && typeof g.id === 'number') this.#apply(s.updateGpio(name === 'GpiUpdated' ? 'gpi' : 'gpo', g))
				return
			}
			case 'live:connections':
			case 'live:calls':
				return this.#debounced('connLive', REFETCH_MS, async (api) => {
					const list = await api.connectionsLiveStatus()
					this.#apply(s.setConnectionLive(list, (p) => participantName(s, p)))
				})
			case 'live:roles':
				return this.#debounced('roles', REFETCH_MS, async (api) => this.#apply(s.setRoles(await api.roles())))
			case 'live:vpl':
				return this.#debounced('connections', REFETCH_MS, async (api) =>
					this.#apply(s.setConnections(await api.connections())),
				)
			case 'live:ports':
			case 'live:interfaces':
				return this.refreshPorts()
			case 'live:endpoints':
				return this.#debounced('endpoints', REFETCH_MS, async (api) =>
					this.#apply(s.setEndpoints(await api.endpoints())),
				)
			case 'live:devices':
				return this.#debounced('device', REFETCH_MS, async () => this.#pollDevice())
			case 'init':
			case 'User:connected':
			case 'User:disconnected':
			case 'live:alerts':
			case 'live:statistics':
			case 'GpiEventAdded':
			case 'GpiEventUpdated':
			case 'GpiEventRemoved':
			case 'GpoEventAdded':
			case 'GpoEventUpdated':
			case 'GpoEventRemoved':
				return
			default:
				if (!this.#unknownEvents.has(name)) {
					this.#unknownEvents.add(name)
					this.log('debug', `Unhandled event from base: ${name} ${JSON.stringify(data)?.slice(0, 300)}`)
				}
		}
	}

	refreshPorts(): void {
		this.#debounced('ports', REFETCH_MS, async (api) => {
			const ports = await Promise.all(INTERFACE_HW_INDEXES.map(async (hw) => api.ports(hw).catch(() => [])))
			this.#apply(this.state.setPorts(ports.flat()))
		})
	}

	#debounced(key: string, ms: number, fn: (api: FsiiApi) => Promise<void>): void {
		clearTimeout(this.#debounces.get(key))
		this.#debounces.set(
			key,
			setTimeout(() => {
				this.#debounces.delete(key)
				const api = this.api
				if (!api) return
				fn(api).catch((err) => this.log('debug', `Refresh ${key} failed: ${(err as Error).message}`))
			}, ms),
		)
	}

	// --- output to Companion -----------------------------------------------------------------------

	#apply(change: StateChange): void {
		if (change.structure) this.#debounced('definitions', DEFINITIONS_MS, async () => this.#defineAll())
		if (change.live) this.#debounced('redraw', REDRAW_MS, async () => this.#redraw())
	}

	#defineAll(): void {
		UpdateActions(this)
		UpdateFeedbacks(this)
		UpdateVariableDefinitions(this)
		this.#lastValues = {}
		this.#redraw()
	}

	#redraw(): void {
		const values = computeVariableValues(this.state, this.socketConnected, this.config.lowBattery)
		const changed: VariablesSchema = {}
		for (const [k, val] of Object.entries(values)) {
			if (this.#lastValues[k] !== val) changed[k] = val
		}
		this.#lastValues = values
		if (Object.keys(changed).length) this.setVariableValues(changed)
		this.checkAllFeedbacks()

		if (this.socketConnected && this.state.ready) {
			const all = packs(this.state)
			this.#setStatus(InstanceStatus.Ok, `Connected — ${all.filter(isOnline).length}/${all.length} packs online`)
		}
	}

	#setStatus(status: InstanceStatus, message: string): void {
		const key = `${status}|${message}`
		if (key === this.#lastStatus) return
		this.#lastStatus = key
		this.updateStatus(status, message)
	}
}
