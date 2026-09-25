/* eslint-disable n/no-unpublished-import */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { FsiiState, setByPath } from '../src/state.js'
import {
	channelTalkers,
	isCalling,
	isTalking,
	missingRoles,
	packsForRole,
	portInChannel,
	resolveTargets,
	talkingKeys,
} from '../src/resolve.js'
import { computeVariableValues } from '../src/variables.js'
import type { ConnectionLiveStatus, Endpoint, EndpointUpdatedEvent } from '../src/types.js'

const fixture = <T>(name: string): T =>
	JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as T

function loadedState(): FsiiState {
	const s = new FsiiState()
	s.setRoles(fixture('roles'))
	s.setConnections(fixture('connections'))
	s.setConnectionLive(fixture('connections_liveStatus'), (p) => p.label)
	s.setPorts(fixture('ports'))
	s.setEndpoints(fixture('endpoints'))
	s.ready = true
	return s
}

const ids = (list: Endpoint[]) => list.map((e) => e.id).sort()

describe('FsiiState', () => {
	let s: FsiiState
	beforeEach(() => {
		s = loadedState()
	})

	it('ignores redundant EndpointInit broadcasts', () => {
		const again = s.setEndpoints(fixture('endpoints'))
		expect(again).toEqual({ live: false, structure: false })
	})

	it('flags structure changes only for identity changes', () => {
		expect(s.applyEndpointUpdate({ endpointId: 63184, path: 'liveStatus.RSSI', value: 12 })).toEqual({
			live: true,
			structure: false,
		})
		expect(s.applyEndpointUpdate({ endpointId: 63184, path: 'liveStatus.status', value: 'offline' })).toEqual({
			live: true,
			structure: true,
		})
	})

	it('ignores updates for unknown endpoints or malformed events', () => {
		expect(s.applyEndpointUpdate({ endpointId: 1, path: 'liveStatus.RSSI', value: 1 }).live).toBe(false)
		expect(s.applyEndpointUpdate({ endpointId: 63184, path: '', value: 1 }).live).toBe(false)
		expect(s.applyEndpointUpdate(undefined as unknown as EndpointUpdatedEvent).live).toBe(false)
	})

	it('replays a 10 minute live capture without errors', () => {
		const events = fixture<{ event: string; data: unknown }[]>('events')
		for (const { event, data } of events) {
			if (event === 'EndpointInit') s.setEndpoints((data as { result: Endpoint[] }).result)
			else s.applyEndpointUpdate(data as EndpointUpdatedEvent)
		}
		expect(s.endpoints.size).toBe(30)
	})

	it('tracks call state from the captured call test', () => {
		const [on, off] = fixture<{ data: EndpointUpdatedEvent }[]>('call_events')
		const pack = s.endpoints.get(63184)!
		expect(isCalling(pack)).toBe(false)
		s.applyEndpointUpdate(on.data)
		expect(isCalling(pack)).toBe(true)
		s.applyEndpointUpdate(off.data)
		expect(isCalling(pack)).toBe(false)
	})

	it('detects a base reboot from uptime going backwards', () => {
		s.setDevice({ uptime: 1000, version: '1.6.15.0', label: 'x', state: 'Online' })
		expect(s.setDevice({ uptime: 1010, version: '1.6.15.0', label: 'x', state: 'Online' }).rebooted).toBe(false)
		expect(s.setDevice({ uptime: 5, version: '1.6.15.0', label: 'x', state: 'Online' }).rebooted).toBe(true)
	})

	it('records a new incoming call once, not on every refresh', () => {
		const live = fixture<ConnectionLiveStatus[]>('connections_liveStatus')
		const calling = structuredClone(live)
		calling[0].participants[0].events = { call: true, talk: false, control: false }
		s.setConnectionLive(calling, (p) => `who:${p.id}`)
		const first = s.lastCall
		expect(first?.label).toBe(`who:${calling[0].participants[0].id}`)
		expect(first?.channel).toBe('Channel 1')
		s.setConnectionLive(structuredClone(calling), () => 'someone else')
		expect(s.lastCall).toBe(first)
	})

	it('setByPath creates intermediate objects', () => {
		const o: Record<string, unknown> = {}
		setByPath(o, 'a.b.c', 1)
		expect(o).toEqual({ a: { b: { c: 1 } } })
	})
})

describe('resolve', () => {
	let s: FsiiState
	beforeEach(() => {
		s = loadedState()
	})

	it('resolves a role to the pack holding it', () => {
		expect(ids(packsForRole(s, 35))).toEqual([63184])
		expect(ids(resolveTargets(s, ['r:35']))).toEqual([63184])
	})

	it('falls back to the assigned role for offline packs', () => {
		expect(ids(packsForRole(s, 11))).toEqual([37044])
	})

	it('resolves free text by role label, pack label or id', () => {
		expect(ids(resolveTargets(s, [], 'role 35'))).toEqual([63184])
		expect(ids(resolveTargets(s, [], 'FSII-BP-37139, 37175'))).toEqual([37139, 37175])
		expect(resolveTargets(s, [], 'nobody')).toEqual([])
		expect(ids(resolveTargets(s, ['p:63184', 'r:35'], 'Role 35'))).toEqual([63184])
	})

	it('only reports talking for online packs', () => {
		// 48106 is offline but still reports a stale talk+listen key
		expect(isTalking(s.endpoints.get(48106)!)).toBe(false)
		const live = s.endpoints.get(63206)!
		expect(isTalking(live)).toBe(true)
		expect(isTalking(live, 1)).toBe(true)
		expect(isTalking(live, 0)).toBe(false)
		expect(talkingKeys(live)).toBe('2')
	})

	it('reads port routing and channel tallies', () => {
		expect(portInChannel(s, 65536, 12)).toBe(true)
		expect(portInChannel(s, 65536, 1)).toBe(false)
		expect(channelTalkers(s, 1)).toEqual([])
	})

	it('lists expected roles with no pack online', () => {
		expect(missingRoles(s, [35, 11]).map((r) => r.id)).toEqual([11])
	})
})

describe('variables', () => {
	it('computes pack, role and channel values', () => {
		const v = computeVariableValues(loadedState(), true, 95)
		expect(v.packs_online).toBe(11)
		expect(v.packs_total).toBe(20)
		expect(v.r35_label).toBe('Role 35')
		expect(v.r35_pack).toBe('FSII-BP-63184')
		expect(v.r35_online).toBe(true)
		expect(v.r11_online).toBe(false)
		expect(v.r11_battery).toBe('')
		expect(v.ch1_members).toBe(14)
		expect(v.low_battery_list as string).toContain('Role 7 (71%)')
		expect(v.base_state).toBe('Connected')
	})

	it('reports disconnected state', () => {
		expect(computeVariableValues(new FsiiState(), false, 20).base_state).toBe('Disconnected')
	})
})
