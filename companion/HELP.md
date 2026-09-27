## Clear-Com FreeSpeak II

Controls and monitors a Clear-Com **FreeSpeak II base station** (FSII-BASE-II) through the same interface the
CCM web page uses. You get live beltpack tallies, battery/signal status, call signals, remote mic kill, role
changes, base port routing and GPOs.

### Setup

1. Enter the **base IP address or hostname**. No username or password is needed (see _Security_ below).
2. Leave **Device ID** at `1` unless your base is part of a linked system.

### Targeting beltpacks by role

Actions and feedbacks target **roles** (e.g. "Camera 5"), not physical packs. A button follows whoever is using
the role, even when crew swap packs. Each dropdown also lists physical packs (`Pack FSII-BP-63184`) for spares
with no meaningful role.

You can select several roles at once. You can also type names into **Or by name** (comma separated role labels,
pack labels or pack ids). This field accepts variables and expressions.

### Actions

| Action                       | Notes                                                          |
| ---------------------------- | -------------------------------------------------------------- |
| Call signal: role / pack     | Pulse, on, off or toggle. Optional call text                   |
| Call signal: whole channel   | Calls every pack and 2W/4W port on a partyline                 |
| Remote mic kill: role / pack | Turns off the talk keys on the selected packs                  |
| Remote mic kill: all packs   | Must be enabled in the connection settings                     |
| Change pack role             | _Learn_ fills in the pack's current role                       |
| Route base port to channel   | Join, leave or toggle a partyline for a 2W, 4W or station port |
| Call signal: base port       | Call signal out of a 2W/4W port                                |
| Set base GPO                 | Force on/off, toggle, or release back to automatic             |

Reboot, reset, firmware and configuration editing are deliberately not included.

### Feedbacks

- Role / pack is talking (any key or a specific key), is online, has a call active, battery or link quality below
  a threshold. Each one takes any mix of roles and packs, and is true if any of them match. Stack them on a button
  (e.g. grey = offline via inverted "is online", orange = low battery, amber = calling, red = talking).
- Channel: someone is talking / calling. Base port is routed to a channel.
- Any online pack below a battery threshold. Any expected role has no pack online.
- GPI / GPO state, connected to the base.

### Variables

Variables use numeric ids, so renaming a role in CCM does not break your buttons.

- Per role (`r<roleId>_...`): `label`, `pack`, `online`, `battery`, `time_left`, `rssi`, `link`, `talking`
  (e.g. `1,R` = key A and reply), `antenna`
- Per channel (`ch<connectionId>_...`): `label`, `talkers`, `talk_count`, `members`
- System: `base_state`, `base_uptime`, `base_version`, `packs_online`, `packs_total`, `low_battery_list`,
  `offline_list`, `last_caller`, `last_call_channel`, `last_call_time`, `gpi<n>`, `gpo<n>`
