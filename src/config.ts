import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export type ModuleConfig = {
	host: string
	deviceId: number
	heartbeatMs: number
	lowBattery: number
	rmkAllEnabled: boolean
}

export const DEFAULT_CONFIG: ModuleConfig = {
	host: '',
	deviceId: 1,
	heartbeatMs: 10000,
	lowBattery: 20,
	rmkAllEnabled: false,
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'Information',
			width: 12,
			value:
				'Connects to the FreeSpeak II base CCM (HTTP + socket.io on port 80). No login is needed for control. ' +
				'The base API is unauthenticated, so keep it on an isolated production network.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Base IP address or hostname',
			width: 8,
			regex: Regex.HOSTNAME,
			default: DEFAULT_CONFIG.host,
		},
		{
			type: 'number',
			id: 'deviceId',
			label: 'Device ID',
			tooltip: 'Leave at 1 unless the base is part of a linked system',
			width: 4,
			min: 0,
			max: 255,
			default: DEFAULT_CONFIG.deviceId,
		},
		{
			type: 'number',
			id: 'heartbeatMs',
			label: 'Heartbeat interval (ms)',
			width: 4,
			min: 2000,
			max: 60000,
			default: DEFAULT_CONFIG.heartbeatMs,
		},
		{
			type: 'number',
			id: 'lowBattery',
			label: 'Low battery threshold (%) for lists and status colours',
			width: 4,
			min: 1,
			max: 99,
			default: DEFAULT_CONFIG.lowBattery,
		},
		{
			type: 'checkbox',
			id: 'rmkAllEnabled',
			label: 'Enable "Remote mic kill: all packs" action',
			tooltip: 'Off by default so a stray button press cannot mute the whole crew',
			width: 4,
			default: DEFAULT_CONFIG.rmkAllEnabled,
		},
	]
}
