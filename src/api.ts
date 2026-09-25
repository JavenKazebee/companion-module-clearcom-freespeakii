import type { Connection, ConnectionLiveStatus, DeviceLiveStatus, Endpoint, Gpio, Port, Role } from './types.js'

const TIMEOUT_MS = 5000
const WRITE_SPACING_MS = 50

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message)
	}
}

/**
 * REST client for the FSII base. Reads run in parallel; writes go through a single serialized queue so a
 * mashed button or an "RMK all" loop cannot flood the embedded server.
 * NOTE: never call GET /api/1/events without an entity id - the base never answers it.
 */
export class FsiiApi {
	#writeChain: Promise<unknown> = Promise.resolve()

	constructor(
		private readonly host: string,
		private readonly deviceId: number,
	) {}

	async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await fetch(`http://${this.host}${path}`, {
			method,
			headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
		const text = await res.text()
		let parsed: unknown = text
		try {
			parsed = text ? JSON.parse(text) : undefined
		} catch {
			// some write routes answer with a bare string
		}
		if (!res.ok) {
			const message = (parsed as { message?: string } | undefined)?.message ?? text
			throw new ApiError(`${method} ${path} -> ${res.status}: ${message}`, res.status)
		}
		return parsed as T
	}

	async get<T>(path: string): Promise<T> {
		return this.#request<T>('GET', path)
	}

	/** Queue a write. Resolves/rejects with that write's own result. */
	async write<T = unknown>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T> {
		const run = async () => {
			try {
				return await this.#request<T>(method, path, body)
			} finally {
				await new Promise((r) => setTimeout(r, WRITE_SPACING_MS))
			}
		}
		const result = this.#writeChain.then(run, run)
		this.#writeChain = result.catch(() => undefined)
		return result
	}

	// --- reads ---
	async deviceLiveStatus(): Promise<DeviceLiveStatus> {
		return this.get(`/api/1/devices/${this.deviceId}/liveStatus`)
	}
	async endpoints(): Promise<Endpoint[]> {
		return this.get(`/api/1/devices/${this.deviceId}/endpoints`)
	}
	async roles(): Promise<Role[]> {
		return this.get('/api/1/roles')
	}
	async connections(): Promise<Connection[]> {
		return this.get('/api/1/connections')
	}
	async connectionsLiveStatus(): Promise<ConnectionLiveStatus[]> {
		return this.get('/api/1/connections/liveStatus')
	}
	async gpio(): Promise<Gpio[]> {
		return this.get(`/api/1/devices/${this.deviceId}/gpio`)
	}
	async ports(hwIndex: number): Promise<Port[]> {
		return this.get(`/api/1/devices/${this.deviceId}/interfaces/${hwIndex}/ports`)
	}

	// --- writes ---
	#endpoint(id: number, action: string): string {
		return `/api/1/devices/${this.deviceId}/endpoints/${id}/${action}`
	}
	#port(hwIndex: number, portId: number, action: string): string {
		return `/api/1/devices/${this.deviceId}/interfaces/${hwIndex}/ports/${portId}/${action}`
	}

	async callEndpoint(id: number, active: boolean, text = ''): Promise<unknown> {
		return this.write('POST', this.#endpoint(id, 'call'), { active, text })
	}
	async rmkEndpoint(id: number): Promise<unknown> {
		return this.write('POST', this.#endpoint(id, 'rmk'), {})
	}
	async changeRole(id: number, roleId: number): Promise<unknown> {
		return this.write('POST', this.#endpoint(id, 'changerole'), { id: roleId })
	}
	async portJoin(hwIndex: number, portId: number, connectionId: number, join: boolean): Promise<unknown> {
		return this.write('POST', this.#port(hwIndex, portId, join ? 'join' : 'leave'), {
			target: `/api/1/connections/${connectionId}`,
		})
	}
	async portCall(hwIndex: number, portId: number, enabled: boolean): Promise<unknown> {
		return this.write('POST', this.#port(hwIndex, portId, 'gpo'), { enabled, timeout: 4000 })
	}
	async setGpo(id: number, enabled: boolean | null): Promise<unknown> {
		return this.write('POST', `/api/1/devices/${this.deviceId}/setGPO`, { id, enabled })
	}
}
