import type {
	CompanionInputFieldMultiDropdown,
	CompanionInputFieldTextInput,
	DropdownChoice,
} from '@companion-module/base'
import { packRoles, packs } from './resolve.js'
import type { FsiiState } from './state.js'
import { decodePortId } from './types.js'

export const KEY_CHOICES: DropdownChoice[] = [
	{ id: 'any', label: 'Any key' },
	{ id: 0, label: 'Key A' },
	{ id: 1, label: 'Key B' },
	{ id: 2, label: 'Key C' },
	{ id: 3, label: 'Key D' },
	{ id: 4, label: 'Reply key' },
]

// Choice labels only use ids and configured labels, never live status, so packs going in and out of range do not
// force a rebuild of every definition. Live status is shown through variables and feedbacks instead.

/** Roles first (target whoever holds the role), then physical packs as a fallback. */
export function targetChoices(state: FsiiState): DropdownChoice<string>[] {
	const roles = packRoles(state).map((r) => ({ id: `r:${r.id}`, label: r.label }))
	const packList = packs(state)
		.sort((a, b) => a.label.localeCompare(b.label))
		.map((e) => ({ id: `p:${e.id}`, label: `Pack ${e.label}` }))
	return [...roles, ...packList]
}

export function roleChoices(state: FsiiState): DropdownChoice<number>[] {
	return packRoles(state).map((r) => ({ id: r.id, label: r.label }))
}

export function packChoices(state: FsiiState): DropdownChoice<number>[] {
	return packs(state)
		.sort((a, b) => a.label.localeCompare(b.label))
		.map((e) => ({ id: e.id, label: e.label }))
}

export function connectionChoices(state: FsiiState): DropdownChoice<number>[] {
	return [...state.connections.values()]
		.sort((a, b) => a.id - b.id)
		.map((c) => ({ id: c.id, label: `${c.label} (${c.type})` }))
}

export function portChoices(state: FsiiState): DropdownChoice<number>[] {
	return [...state.ports.values()]
		.sort((a, b) => a.port_id - b.port_id)
		.map((p) => {
			const { hwIndex, portIndex } = decodePortId(p.port_id)
			const kind = p.audioInterfaceType_shortName ?? ''
			return {
				id: p.port_id,
				label: `${p.port_label} (${kind} ${hwIndex}.${portIndex + 1}, ${p.port_config_type ?? ''})`,
			}
		})
}

export function gpioChoices(list: Iterable<{ id: number; label: string }>): DropdownChoice<number>[] {
	return [...list].map((g) => ({ id: g.id, label: g.label }))
}

export const firstId = <T extends string | number>(choices: DropdownChoice<T>[], fallback: T): T =>
	choices[0]?.id ?? fallback

/** The "Roles / packs" multi-select plus free-text name field shared by actions and feedbacks. */
export function targetFields(
	choices: DropdownChoice<string>[],
): [CompanionInputFieldMultiDropdown<'targets'>, CompanionInputFieldTextInput<'names'>] {
	return [
		{ id: 'targets', type: 'multidropdown', label: 'Roles / packs', choices, default: [], minChoicesForSearch: 8 },
		{
			id: 'names',
			type: 'textinput',
			label: 'Or by name (comma separated role labels, pack labels or ids)',
			default: '',
			useVariables: true,
		},
	]
}
