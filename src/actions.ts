import type { CompanionActionDefinitions } from '@companion-module/base'
import type ModuleInstance from './main.js'
import {
	connectionChoices,
	firstId,
	targetFields,
	gpioChoices,
	packChoices,
	portChoices,
	roleChoices,
	targetChoices,
} from './choices.js'
import {
	channelParticipants,
	isCalling,
	isOnline,
	packName,
	packRoleId,
	packs,
	portInChannel,
	resolveTargets,
} from './resolve.js'
import { decodePortId } from './types.js'

type Targets = { targets: string[]; names: string }
type CallMode = 'on' | 'off' | 'toggle' | 'pulse'

export type ActionsSchema = {
	call_role: { options: Targets & { mode: CallMode; pulseMs: number; text: string } }
	rmk_role: { options: Targets }
	rmk_all: { options: Record<string, never> }
	change_role: { options: { pack: number; role: number } }
	call_channel: { options: { connection: number; mode: 'on' | 'off' | 'pulse'; pulseMs: number; text: string } }
	port_route: { options: { port: number; connection: number; mode: 'join' | 'leave' | 'toggle' } }
	port_call: { options: { port: number; mode: 'on' | 'off' | 'pulse'; pulseMs: number } }
	gpo_set: { options: { gpo: number; mode: 'on' | 'off' | 'toggle' | 'release' } }
}

const PULSE_OPTION = {
	id: 'pulseMs',
	type: 'number',
	label: 'Pulse length (ms)',
	default: 2000,
	min: 100,
	max: 30000,
	isVisibleExpression: `$(options:mode) == 'pulse'`,
} as const

const TEXT_OPTION = {
	id: 'text',
	type: 'textinput',
	label: 'Call text (optional)',
	default: '',
	useVariables: true,
} as const

export function UpdateActions(self: ModuleInstance): void {
	const state = self.state
	const targets = targetChoices(state)
	const roles = roleChoices(state)
	const packList = packChoices(state)
	const connections = connectionChoices(state)
	const ports = portChoices(state)
	const gpos = gpioChoices(state.gpos.values())

	const targetOptions = targetFields(targets)

	/** Run fn for each resolved pack; log when nothing matched. */
	const forPacks = async (opts: Targets, what: string, onlineOnly: boolean, fn: (id: number) => Promise<unknown>) => {
		const api = self.api
		if (!api || !self.socketConnected) return self.log('warn', `${what}: not connected to the base`)
		const list = resolveTargets(state, opts.targets, opts.names).filter((e) => !onlineOnly || isOnline(e))
		if (!list.length) return self.log('info', `${what}: no ${onlineOnly ? 'online ' : ''}pack matches the selection`)
		await Promise.all(
			list.map(async (e) =>
				fn(e.id).catch((err) => self.log('warn', `${what} ${packName(state, e)} failed: ${(err as Error).message}`)),
			),
		)
	}

	const pulse = (ms: number, off: () => void) => self.schedule(ms, off)

	const actions: CompanionActionDefinitions<ActionsSchema> = {
		call_role: {
			name: 'Call signal: role / pack',
			description: 'Flash a call on every pack holding the selected roles',
			options: [
				...targetOptions,
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'pulse',
					choices: [
						{ id: 'pulse', label: 'Pulse' },
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
				PULSE_OPTION,
				TEXT_OPTION,
			],
			callback: async ({ options }) => {
				const list = resolveTargets(state, options.targets, options.names)
				const active =
					options.mode === 'toggle' ? !list.some(isCalling) : options.mode === 'on' || options.mode === 'pulse'
				await forPacks(options, 'Call', true, async (id) => self.api!.callEndpoint(id, active, options.text))
				if (options.mode === 'pulse')
					pulse(
						options.pulseMs,
						() => void forPacks(options, 'Call off', true, async (id) => self.api!.callEndpoint(id, false)),
					)
			},
		},

		rmk_role: {
			name: 'Remote mic kill: role / pack',
			description: 'Turn off the talk keys on the selected packs',
			options: [...targetOptions],
			callback: async ({ options }) => forPacks(options, 'RMK', true, async (id) => self.api!.rmkEndpoint(id)),
		},

		rmk_all: {
			name: 'Remote mic kill: all packs',
			description: 'Must be enabled in the connection settings',
			options: [],
			callback: async () => {
				if (!self.config.rmkAllEnabled) return self.log('warn', 'RMK all is disabled in the connection settings')
				const all = packs(state)
					.filter(isOnline)
					.map((e) => `p:${e.id}`)
				await forPacks({ targets: all, names: '' }, 'RMK all', true, async (id) => self.api!.rmkEndpoint(id))
			},
		},

		change_role: {
			name: 'Change pack role',
			options: [
				{ id: 'pack', type: 'dropdown', label: 'Pack', choices: packList, default: firstId(packList, 0) },
				{ id: 'role', type: 'dropdown', label: 'New role', choices: roles, default: firstId(roles, 0) },
			],
			callback: async ({ options }) => {
				const e = state.endpoints.get(options.pack)
				if (!e) return self.log('warn', `Change role: pack ${options.pack} not found`)
				if (!self.api || !self.socketConnected) return self.log('warn', 'Change role: not connected to the base')
				await self.api
					.changeRole(options.pack, options.role)
					.catch((err) => self.log('warn', `Change role of ${e.label} failed: ${(err as Error).message}`))
			},
			learn: ({ options }) => {
				const e = state.endpoints.get(options.pack)
				const role = e && packRoleId(e)
				return role === undefined ? undefined : { role }
			},
		},

		call_channel: {
			name: 'Call signal: whole channel',
			description: 'Call every pack and 2W/4W port that is a member of the channel',
			options: [
				{
					id: 'connection',
					type: 'dropdown',
					label: 'Channel',
					choices: connections,
					default: firstId(connections, 1),
				},
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'pulse',
					choices: [
						{ id: 'pulse', label: 'Pulse' },
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
					],
				},
				PULSE_OPTION,
				TEXT_OPTION,
			],
			callback: async ({ options }) => {
				const members = channelParticipants(state, options.connection)
				const packTargets = members.filter((p) => state.endpoints.has(p.id)).map((p) => `p:${p.id}`)
				const portIds = members
					.map((p) => Number(/\/ports\/(\d+)$/.exec(p.res ?? '')?.[1]))
					.filter((id) => state.ports.has(id))
				const send = async (active: boolean) => {
					await forPacks({ targets: packTargets, names: '' }, 'Channel call', true, async (id) =>
						self.api!.callEndpoint(id, active, active ? options.text : ''),
					)
					for (const portId of portIds) {
						await self
							.api!.portCall(decodePortId(portId).hwIndex, portId, active)
							.catch((err) => self.log('warn', `Port call ${portId} failed: ${(err as Error).message}`))
					}
				}
				await send(options.mode !== 'off')
				if (options.mode === 'pulse') pulse(options.pulseMs, () => void send(false))
			},
		},

		port_route: {
			name: 'Route base port to channel',
			description: 'Join or leave a partyline for a 2-wire, 4-wire or program/station port',
			options: [
				{ id: 'port', type: 'dropdown', label: 'Port', choices: ports, default: firstId(ports, 0) },
				{
					id: 'connection',
					type: 'dropdown',
					label: 'Channel',
					choices: connections,
					default: firstId(connections, 1),
				},
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'toggle',
					choices: [
						{ id: 'join', label: 'Join' },
						{ id: 'leave', label: 'Leave' },
						{ id: 'toggle', label: 'Toggle' },
					],
				},
			],
			callback: async ({ options }) => {
				if (!self.api || !self.socketConnected) return self.log('warn', 'Port route: not connected to the base')
				if (!state.ports.has(options.port)) return self.log('warn', `Port route: port ${options.port} not found`)
				const join =
					options.mode === 'toggle' ? !portInChannel(state, options.port, options.connection) : options.mode === 'join'
				await self.api
					.portJoin(decodePortId(options.port).hwIndex, options.port, options.connection, join)
					.then(() => self.refreshPorts())
					.catch((err) => self.log('warn', `Port route failed: ${(err as Error).message}`))
			},
			learn: ({ options }) => {
				const current = Object.keys(state.ports.get(options.port)?.port_connections ?? {})
				return current.length ? { connection: Number(current[0]) } : undefined
			},
		},

		port_call: {
			name: 'Call signal: base port',
			options: [
				{ id: 'port', type: 'dropdown', label: 'Port', choices: ports, default: firstId(ports, 0) },
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'pulse',
					choices: [
						{ id: 'pulse', label: 'Pulse' },
						{ id: 'on', label: 'On' },
						{ id: 'off', label: 'Off' },
					],
				},
				PULSE_OPTION,
			],
			callback: async ({ options }) => {
				if (!self.api || !self.socketConnected) return self.log('warn', 'Port call: not connected to the base')
				const hw = decodePortId(options.port).hwIndex
				const send = async (on: boolean) =>
					self
						.api!.portCall(hw, options.port, on)
						.catch((err) => self.log('warn', `Port call failed: ${(err as Error).message}`))
				await send(options.mode !== 'off')
				if (options.mode === 'pulse') pulse(options.pulseMs, () => void send(false))
			},
		},

		gpo_set: {
			name: 'Set base GPO',
			options: [
				{ id: 'gpo', type: 'dropdown', label: 'GPO', choices: gpos, default: firstId(gpos, 0) },
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'toggle',
					choices: [
						{ id: 'on', label: 'Force on' },
						{ id: 'off', label: 'Force off' },
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'release', label: 'Release (back to automatic)' },
					],
				},
			],
			callback: async ({ options }) => {
				if (!self.api || !self.socketConnected) return self.log('warn', 'GPO: not connected to the base')
				const current = !!state.gpos.get(options.gpo)?.liveStatus?.status
				const enabled = options.mode === 'release' ? null : options.mode === 'toggle' ? !current : options.mode === 'on'
				await self.api
					.setGpo(options.gpo, enabled)
					.catch((err) => self.log('warn', `GPO failed: ${(err as Error).message}`))
			},
		},
	}

	self.setActionDefinitions(actions)
}
