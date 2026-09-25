import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type { ModuleSchema } from './main.js'
import type ModuleInstance from './main.js'
import { COLORS } from './feedbacks.js'
import { packRoles } from './resolve.js'

export function UpdatePresets(self: ModuleInstance): void {
	const state = self.state
	const v = (name: string) => `$(${self.label}:${name})`
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const rolePresets: string[] = []
	const channelPresets: string[] = []
	const portPresets: string[] = []

	for (const role of packRoles(state)) {
		const id = `role_${role.id}`
		rolePresets.push(id)
		presets[id] = {
			type: 'simple',
			name: `${role.label}: call + status`,
			keywords: ['role', 'call', 'status', role.label],
			style: { text: role.label, size: 'auto', color: COLORS.white, bgcolor: COLORS.black },
			steps: [
				{
					down: [
						{
							actionId: 'call_role',
							options: { targets: [`r:${role.id}`], names: '', mode: 'on', pulseMs: 2000, text: '' },
						},
					],
					up: [
						{
							actionId: 'call_role',
							options: { targets: [`r:${role.id}`], names: '', mode: 'off', pulseMs: 2000, text: '' },
						},
					],
				},
			],
			feedbacks: [{ feedbackId: 'role_status', options: { targets: [`r:${role.id}`], names: '', showText: true } }],
		}
	}

	for (const c of [...state.connections.values()].sort((a, b) => a.id - b.id)) {
		const id = `channel_${c.id}`
		channelPresets.push(id)
		presets[id] = {
			type: 'simple',
			name: `${c.label}: tally + call channel`,
			keywords: ['channel', 'partyline', 'tally', c.label],
			style: {
				text: `${c.label}\n${v(`ch${c.id}_talkers`)}`,
				size: '14',
				color: COLORS.white,
				bgcolor: COLORS.black,
			},
			steps: [
				{
					down: [{ actionId: 'call_channel', options: { connection: c.id, mode: 'on', pulseMs: 2000, text: '' } }],
					up: [{ actionId: 'call_channel', options: { connection: c.id, mode: 'off', pulseMs: 2000, text: '' } }],
				},
			],
			feedbacks: [
				{
					feedbackId: 'channel_talking',
					options: { connection: c.id },
					style: { bgcolor: COLORS.red, color: COLORS.white },
				},
				{
					feedbackId: 'channel_calling',
					options: { connection: c.id },
					style: { bgcolor: COLORS.amber, color: COLORS.black },
				},
			],
		}
	}

	for (const p of [...state.ports.values()].sort((a, b) => a.port_id - b.port_id)) {
		const id = `port_call_${p.port_id}`
		portPresets.push(id)
		presets[id] = {
			type: 'simple',
			name: `${p.port_label}: call signal`,
			keywords: ['port', 'call', p.port_label],
			style: { text: `CALL\n${p.port_label}`, size: '14', color: COLORS.white, bgcolor: COLORS.black },
			steps: [
				{
					down: [{ actionId: 'port_call', options: { port: p.port_id, mode: 'on', pulseMs: 2000 } }],
					up: [{ actionId: 'port_call', options: { port: p.port_id, mode: 'off', pulseMs: 2000 } }],
				},
			],
			feedbacks: [],
		}
	}

	presets.alert_battery = {
		type: 'simple',
		name: 'Low battery alert',
		keywords: ['battery', 'alert'],
		style: { text: `LOW BATT\n${v('low_battery_list')}`, size: '7', color: COLORS.white, bgcolor: COLORS.black },
		steps: [],
		feedbacks: [
			{
				feedbackId: 'any_battery_below',
				options: { threshold: self.config.lowBattery },
				style: { bgcolor: COLORS.orange, color: COLORS.white },
			},
		],
	}
	presets.alert_caller = {
		type: 'simple',
		name: 'Last incoming call',
		keywords: ['call', 'caller'],
		style: {
			text: `CALL\n${v('last_caller')}\n${v('last_call_channel')}`,
			size: '14',
			color: COLORS.white,
			bgcolor: COLORS.black,
		},
		steps: [],
		feedbacks: [],
	}
	presets.base_status = {
		type: 'simple',
		name: 'Base status',
		keywords: ['base', 'status', 'connected'],
		style: {
			text: `FSII\n${v('packs_online')}/${v('packs_total')} packs`,
			size: '14',
			color: COLORS.white,
			bgcolor: COLORS.red,
		},
		steps: [],
		feedbacks: [{ feedbackId: 'base_connected', options: {}, style: { bgcolor: COLORS.green, color: COLORS.white } }],
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{
			id: 'crew',
			name: 'Crew (roles)',
			description:
				'Press to call the pack holding the role. Red = talking, amber = calling, orange = low battery, grey = offline.',
			definitions: [{ id: 'roles', type: 'simple', name: 'Roles', presets: rolePresets }],
		},
		{
			id: 'channels',
			name: 'Channels',
			description: 'Talk tally per partyline. Press to call everyone on it.',
			definitions: [{ id: 'channels', type: 'simple', name: 'Channels', presets: channelPresets }],
		},
		{
			id: 'status',
			name: 'Status & alerts',
			definitions: [
				{ id: 'status', type: 'simple', name: 'Status', presets: ['base_status', 'alert_battery', 'alert_caller'] },
			],
		},
		{
			id: 'ports',
			name: 'Base ports',
			definitions: [{ id: 'ports', type: 'simple', name: 'Port call signal', presets: portPresets }],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
