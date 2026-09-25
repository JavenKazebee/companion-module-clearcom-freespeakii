# companion-module-clearcom-freespeakii

Bitfocus Companion module for the Clear-Com FreeSpeak II base station (FSII-BASE-II).

See [HELP.md](./companion/HELP.md) for user documentation and [LICENSE](./LICENSE).

## How it talks to the base

The base has no published control API. This module uses the same interface as the base's CCM web UI:

- **REST** (`/api/1/...`, JSON, port 80) for snapshots and commands
- **socket.io 2.x** (Engine.IO v3) for live events: `EndpointInit` / `EndpointUpdated {endpointId, path, value}`
  for beltpacks, and `live:<topic> {updated:true}` dirty flags that trigger a REST refetch

`socket.io-client` is pinned to 2.x on purpose: newer clients cannot connect to an Engine.IO v3 server.

## Layout

| File                                  | Purpose                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `src/api.ts`                          | REST client, with a serialized write queue                                  |
| `src/socket.ts`                       | socket.io 2 client that re-subscribes on every reconnect                    |
| `src/state.ts`                        | State store that diffs updates, so redundant broadcasts are no-ops          |
| `src/resolve.ts`                      | Role → pack resolution, talk/battery/tally helpers                          |
| `src/main.ts`                         | Lifecycle, event routing, debounced redraws, heartbeat and reboot detection |
| `src/actions.ts`, `feedbacks.ts`, ... | Companion definitions, rebuilt when roles, channels or ports change         |

## Development

```bash
yarn            # install
yarn build      # compile to dist/
yarn dev        # watch mode
yarn test       # unit tests (vitest), using anonymized fixtures captured from a real base
yarn lint
yarn package    # build the distributable package
```

To try it in Companion, add the parent folder of this repo as the **Developer modules path** in the
Companion launcher settings.
