import type { FsiiState } from './state.js'
import { NO_ROLE, type Endpoint, type Participant, type Role } from './types.js'

export const BELTPACK = 'FSII-BP'
export const REPLY_KEY = 4

export const isPack = (e: Endpoint): boolean => e.type === BELTPACK
export const isOnline = (e: Endpoint): boolean => e.liveStatus?.status === 'online'

/** The role a pack is using now (live role while online, assigned role while offline). */
export function packRoleId(e: Endpoint): number | undefined {
	const live = e.liveStatus?.role
	if (isOnline(e) && typeof live === 'number' && live !== NO_ROLE) return live
	return e.role?.id ?? e.settings?.default_role
}

export function packs(state: FsiiState): Endpoint[] {
	return [...state.endpoints.values()].filter(isPack)
}

/** Beltpack roles (the roles list also holds defaults for other device types). */
export function packRoles(state: FsiiState): Role[] {
	return [...state.roles.values()].filter((r) => r.type === BELTPACK).sort((a, b) => a.id - b.id)
}

/** All packs using a role. Online packs first. */
export function packsForRole(state: FsiiState, roleId: number): Endpoint[] {
	return packs(state)
		.filter((e) => packRoleId(e) === roleId)
		.sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)))
}

/** Display name for a pack: its role label, falling back to the pack label. */
export function packName(state: FsiiState, e: Endpoint): string {
	const roleId = packRoleId(e)
	return (roleId !== undefined && state.roles.get(roleId)?.label) || e.role?.label || e.label
}

/** Label for any connection participant (packs show their role, ports their label). */
export function participantName(state: FsiiState, p: Participant): string {
	const e = state.endpoints.get(p.id)
	return e ? packName(state, e) : p.label
}

// --- target selection -------------------------------------------------------------------------

/** Dropdown ids: `r:<roleId>` targets whichever pack holds a role, `p:<packId>` a physical pack. */
export type TargetId = `r:${number}` | `p:${number}`

/**
 * Resolve dropdown targets plus an optional free-text list ("Camera 1, Stage Left, 12345") to pack endpoints.
 * Free text matches role labels, pack labels or pack ids, case-insensitively.
 */
export function resolveTargets(state: FsiiState, targets: unknown, names?: unknown): Endpoint[] {
	const out = new Map<number, Endpoint>()
	const add = (list: Endpoint[]) => list.forEach((e) => out.set(e.id, e))

	for (const t of Array.isArray(targets) ? targets : []) {
		const m = /^([rp]):(\d+)$/.exec(String(t))
		if (!m) continue
		const id = Number(m[2])
		if (m[1] === 'r') add(packsForRole(state, id))
		else {
			const e = state.endpoints.get(id)
			if (e) add([e])
		}
	}

	for (const raw of (typeof names === 'string' ? names : '').split(',')) {
		const name = raw.trim().toLowerCase()
		if (!name) continue
		const role = packRoles(state).find((r) => r.label.toLowerCase() === name)
		if (role) {
			add(packsForRole(state, role.id))
			continue
		}
		add(packs(state).filter((e) => e.label.toLowerCase() === name || String(e.id) === name))
	}
	return [...out.values()]
}

// --- live status helpers ----------------------------------------------------------------------

/** Key selector: 'any', 0-3 for keys A-D, 4 for reply. */
export function isTalking(e: Endpoint, key: 'any' | number = 'any'): boolean {
	if (!isOnline(e)) return false
	return (e.liveStatus?.keyState ?? []).some(
		(k) =>
			(key === 'any' || k.keysetIndex === key) && typeof k.currentState === 'string' && k.currentState.includes('talk'),
	)
}

export function talkingKeys(e: Endpoint): string {
	if (!isOnline(e)) return ''
	return (e.liveStatus?.keyState ?? [])
		.filter((k) => typeof k.currentState === 'string' && k.currentState.includes('talk'))
		.map((k) => (k.keysetIndex === REPLY_KEY ? 'R' : String(k.keysetIndex + 1)))
		.join(',')
}

export const isCalling = (e: Endpoint): boolean => isOnline(e) && !!e.liveStatus?.callState

export function batteryLevel(e: Endpoint): number | undefined {
	const b = e.liveStatus?.batteryLevel
	return isOnline(e) && typeof b === 'number' ? b : undefined
}

export function timeLeft(e: Endpoint): string {
	const l = e.liveStatus?.longevity
	if (!isOnline(e) || !l) return ''
	return `${l.hours}:${String(l.minutes).padStart(2, '0')}`
}

export function channelParticipants(state: FsiiState, connectionId: number): Participant[] {
	return state.connectionLive.get(connectionId)?.participants ?? []
}

/**
 * Whether a pack is talking on a channel. FSII leaves `events.talk` false, so use the pack's own key state
 * (pushed instantly via EndpointUpdated) mapped through its role's keysets. The reply key has no fixed
 * channel, and roles may lack keysets, so fall back to the participant `joinState` (refetched, can lag ~1 s).
 */
function packTalksOn(state: FsiiState, e: Endpoint, p: Participant, connectionId: number): boolean {
	if (!isTalking(e)) return false
	const roleId = packRoleId(e)
	const keysets = roleId === undefined ? undefined : state.roles.get(roleId)?.settings?.keysets
	const res = `/api/1/connections/${connectionId}`
	for (const k of e.liveStatus?.keyState ?? []) {
		if (!k.currentState?.includes('talk')) continue
		const ks = keysets?.find((s) => s.keysetIndex === k.keysetIndex)
		if (ks?.connections?.length && !ks.isReplyKey) {
			if (ks.connections.some((c) => c.res === res)) return true
		} else if (p.joinState?.startsWith('Talk')) return true
	}
	return false
}

export const channelTalkers = (state: FsiiState, connectionId: number): Participant[] =>
	channelParticipants(state, connectionId).filter((p) => {
		const e = state.endpoints.get(p.id)
		return e && isPack(e) ? packTalksOn(state, e, p, connectionId) : !!p.events?.talk
	})

/** Members with a call signal: the connection's own call flag, or a member pack whose callState is active. */
export function channelCallers(state: FsiiState, connectionId: number): Participant[] {
	return channelParticipants(state, connectionId).filter((p) => {
		const e = state.endpoints.get(p.id)
		return p.events?.call || (e !== undefined && isCalling(e))
	})
}

export function portInChannel(state: FsiiState, portId: number, connectionId: number): boolean {
	return String(connectionId) in (state.ports.get(portId)?.port_connections ?? {})
}

export function lowBatteryPacks(state: FsiiState, threshold: number): Endpoint[] {
	return packs(state).filter((e) => {
		const b = batteryLevel(e)
		return b !== undefined && b < threshold
	})
}

/** Offline packs, optionally only those holding one of the watched roles. */
export function offlinePacks(state: FsiiState, watchedRoles?: number[]): Endpoint[] {
	const watched = watchedRoles?.length ? new Set(watchedRoles) : null
	return packs(state).filter((e) => {
		if (isOnline(e)) return false
		if (!watched) return true
		const r = packRoleId(e)
		return r !== undefined && watched.has(r)
	})
}

/** Roles that should be online but have no online pack. */
export function missingRoles(state: FsiiState, watchedRoles: number[]): Role[] {
	return watchedRoles
		.map((id) => state.roles.get(id))
		.filter((r): r is Role => !!r && !packsForRole(state, r.id).some(isOnline))
}
