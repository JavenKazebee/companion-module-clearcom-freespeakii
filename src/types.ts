// Shapes returned by the FreeSpeak II base CCM API. Only the fields the module uses are typed;
// everything else is passed through untouched. See PROTOCOL.md in the research repo.

export interface KeyState {
	keysetIndex: number
	currentState: string // 'off' | 'listen' | 'talk+listen' | ...
	volume: number
}

export interface EndpointLiveStatus {
	status?: 'online' | 'offline' | string
	role?: number // live role id, 65535 while offline
	antennaIndex?: number
	antennaSlot?: number
	keyState?: KeyState[]
	batteryType?: string
	batteryLevel?: number
	longevity?: { hours: number; minutes: number }
	RSSI?: number
	linkQuality?: number
	frameErrorRate?: number
	callState?: number | boolean
	[key: string]: unknown
}

export interface Endpoint {
	id: number
	device_id: number
	label: string
	type: 'FSII-BP' | 'FSII-Antenna' | string
	liveStatus?: EndpointLiveStatus
	role?: { id: number; label: string; isDefault?: boolean }
	settings?: { default_role?: number; [key: string]: unknown }
	versionSW?: string
	[key: string]: unknown
}

export interface RoleKeyset {
	keysetIndex: number
	connections?: { res: string }[] // e.g. '/api/1/connections/3'
	isReplyKey?: boolean
}

export interface Role {
	id: number
	type: string
	label: string
	isDefault?: boolean
	settings?: { keysets?: RoleKeyset[]; [key: string]: unknown }
	[key: string]: unknown
}

export interface Connection {
	id: number
	label: string
	type: 'partyline' | 'group' | string
}

export interface Participant {
	id: number
	device_id: number
	label: string
	type: string // 'FSII-BP' | 'SA' | 'PGM' | '2W' | '4W'
	joinState?: string // live for packs ('Talk' | 'Talk-Listen' while keyed); fixed config for ports
	state?: string
	res?: string
	events?: { call?: boolean; talk?: boolean; control?: boolean } // FSII never sets talk
}

export interface ConnectionLiveStatus {
	id: number
	label: string
	participants: Participant[]
}

export interface Port {
	port_id: number // global id: deviceId<<16 | hwIndex<<8 | portIndex
	port_hwIndex: number
	port_label: string
	port_desc?: string
	port_config_type?: string
	audioInterfaceType_shortName?: string
	port_connections?: Record<string, { connectionState: number }>
	liveStatus?: { online?: boolean; vox?: { status?: boolean } }
}

export interface Gpio {
	id: number
	device_id: number
	label: string
	type: number // 0 = GPI, 1 = GPO
	liveStatus?: { id?: number; status?: boolean; forced?: boolean }
}

export interface DeviceLiveStatus {
	uptime: number
	version: string
	label: string
	state: string
}

export interface EndpointUpdatedEvent {
	endpointId: number
	path: string
	value: unknown
}

export const NO_ROLE = 65535
export const INTERFACE_HW_INDEXES = [0, 1, 2, 3, 4]

export function decodePortId(portId: number): { deviceId: number; hwIndex: number; portIndex: number } {
	return { deviceId: portId >> 16, hwIndex: (portId >> 8) & 0xff, portIndex: portId & 0xff }
}
