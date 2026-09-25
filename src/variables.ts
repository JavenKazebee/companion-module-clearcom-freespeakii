import type { CompanionVariableDefinitions, CompanionVariableValue } from '@companion-module/base'
import type ModuleInstance from './main.js'
import {
	batteryLevel,
	channelParticipants,
	channelTalkers,
	isOnline,
	lowBatteryPacks,
	packName,
	packRoles,
	packs,
	packsForRole,
	participantName,
	talkingKeys,
	timeLeft,
} from './resolve.js'
import type { FsiiState } from './state.js'

// Variable ids are built from stable numeric ids (role id, connection id), so renaming a role in CCM
// does not break buttons that reference them.
export type VariablesSchema = Record<string, CompanionVariableValue>

const ROLE_FIELDS: Record<string, string> = {
	label: 'label',
	pack: 'pack label(s) using the role',
	online: 'online (true/false)',
	battery: 'battery %',
	time_left: 'battery time left (h:mm)',
	rssi: 'RSSI',
	link: 'link quality',
	talking: 'keys talking (e.g. "1,R")',
	antenna: 'antenna / slot',
}

const CHANNEL_FIELDS: Record<string, string> = {
	label: 'label',
	talkers: 'who is talking',
	talk_count: 'number of talkers',
	members: 'number of members',
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const state = self.state
	const defs: CompanionVariableDefinitions<VariablesSchema> = {
		base_state: { name: 'Base: state' },
		base_uptime: { name: 'Base: uptime (h:mm)' },
		base_version: { name: 'Base: firmware version' },
		base_label: { name: 'Base: label' },
		packs_online: { name: 'Beltpacks online' },
		packs_total: { name: 'Beltpacks registered' },
		low_battery_list: { name: 'Online packs below the low battery threshold' },
		offline_list: { name: 'Offline packs holding a non-default role' },
		last_caller: { name: 'Last incoming call: who' },
		last_call_channel: { name: 'Last incoming call: channel' },
		last_call_time: { name: 'Last incoming call: time (HH:MM:SS)' },
	}
	for (const role of packRoles(state)) {
		for (const [field, desc] of Object.entries(ROLE_FIELDS)) {
			defs[`r${role.id}_${field}`] = { name: `Role ${role.label}: ${desc}` }
		}
	}
	for (const c of state.connections.values()) {
		for (const [field, desc] of Object.entries(CHANNEL_FIELDS)) {
			defs[`ch${c.id}_${field}`] = { name: `Channel ${c.label}: ${desc}` }
		}
	}
	for (const g of state.gpis.values()) defs[`gpi${g.id}`] = { name: `GPI ${g.label}` }
	for (const g of state.gpos.values()) defs[`gpo${g.id}`] = { name: `GPO ${g.label}` }
	self.setVariableDefinitions(defs)
}

function formatUptime(seconds: number): string {
	const h = Math.floor(seconds / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	return `${h}:${String(m).padStart(2, '0')}`
}

/** Compute every variable value from the current state. The caller diffs and only sends changes. */
export function computeVariableValues(state: FsiiState, connected: boolean, lowBattery: number): VariablesSchema {
	const v: VariablesSchema = {}
	const all = packs(state)
	const online = all.filter(isOnline)

	v.base_state = connected ? (state.device?.state ?? 'Connected') : 'Disconnected'
	v.base_uptime = state.device ? formatUptime(state.device.uptime) : ''
	v.base_version = state.device?.version ?? ''
	v.base_label = state.device?.label ?? ''
	v.packs_online = online.length
	v.packs_total = all.length
	v.low_battery_list = lowBatteryPacks(state, lowBattery)
		.map((e) => `${packName(state, e)} (${batteryLevel(e)}%)`)
		.join(', ')
	v.offline_list = all
		.filter((e) => !isOnline(e) && e.role && !e.role.isDefault)
		.map((e) => packName(state, e))
		.join(', ')
	v.last_caller = state.lastCall?.label ?? ''
	v.last_call_channel = state.lastCall?.channel ?? ''
	v.last_call_time = state.lastCall ? state.lastCall.time.toTimeString().slice(0, 8) : ''

	for (const role of packRoles(state)) {
		const holders = packsForRole(state, role.id)
		const live = holders.filter(isOnline)
		const e = live[0] ?? holders[0]
		const p = `r${role.id}_`
		v[`${p}label`] = role.label
		v[`${p}pack`] = holders.map((h) => h.label).join(', ')
		v[`${p}online`] = live.length > 0
		v[`${p}battery`] = e ? (batteryLevel(e) ?? '') : ''
		v[`${p}time_left`] = e ? timeLeft(e) : ''
		v[`${p}rssi`] = e && isOnline(e) ? (e.liveStatus?.RSSI ?? '') : ''
		v[`${p}link`] = e && isOnline(e) ? (e.liveStatus?.linkQuality ?? '') : ''
		v[`${p}talking`] = live.map(talkingKeys).filter(Boolean).join(' ')
		v[`${p}antenna`] =
			e && isOnline(e) && e.liveStatus?.antennaIndex !== undefined
				? `${e.liveStatus.antennaIndex + 1}/${(e.liveStatus.antennaSlot ?? 0) + 1}`
				: ''
	}

	for (const c of state.connections.values()) {
		const talkers = channelTalkers(state, c.id)
		const p = `ch${c.id}_`
		v[`${p}label`] = c.label
		v[`${p}talkers`] = talkers.map((t) => participantName(state, t)).join(', ')
		v[`${p}talk_count`] = talkers.length
		v[`${p}members`] = channelParticipants(state, c.id).length
	}

	for (const g of state.gpis.values()) v[`gpi${g.id}`] = !!g.liveStatus?.status
	for (const g of state.gpos.values()) v[`gpo${g.id}`] = !!g.liveStatus?.status
	return v
}
