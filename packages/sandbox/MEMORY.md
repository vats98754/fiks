# Sandbox memory and limits

## Docker Desktop

- **Plan setting (PLAN 8.0-1): 6 GB** for the Docker Desktop VM. The user sets this.
- **Observed on 2026-10-21:** `docker info` reported `MemTotal 8218316800` (about 7.65 GiB), 8 CPUs, linux/aarch64.
  That is more than the plan's 6 GB. The budget below still assumes 6 GB, so it holds at either size.

## Per-container limits (`DEFAULT_LIMITS` in `src/backend.ts`)

| Limit | Value | Flag |
|---|---|---|
| Memory | 2 GiB, no swap | `--memory 2g --memory-swap 2g` |
| CPU | 2 | `--cpus 2` |
| Processes | 1024 | `--pids-limit 1024` |
| `/tmp` (tmpfs, = `HOME`) | 1 GiB | `--tmpfs /tmp:rw,exec,nosuid,nodev,size=1g` |
| Root filesystem | read-only | `--read-only` |
| Capabilities | none; `no-new-privileges` | `--cap-drop ALL --security-opt no-new-privileges` |
| Network | none (loopback only) | `--network none` |

Callers can override any of these with `DockerExecBackendOptions.limits`.

## Budget at 6 GB

- **At most 2 sandbox containers at once at the default limit.** 2 × 2 GiB = 4 GiB. That leaves about 2 GiB for the
  Docker VM, BuildKit and volume copies.
- **Builds hold the machine-wide `docker` lock.** This covers image builds and fiks-tools volume copies
  (`src/lock.ts`, the same lock as `with-lock docker`), so a build never runs next to another build.
- **Measured on shop-mcp 7bf2e66:** a full `ciLocal` run in one container peaked at
  259 MiB (`/sys/fs/cgroup/memory.peak` = 271118336) and 37 processes. The four steps were install 3.6 s,
  typecheck 6.4 s, lint 1.7 s and test 6.4 s. Container start, including the node_modules volume copy, took 7.6 s.
  So 2 GiB leaves headroom of about 8×.
- **Image sizes.** The shop-mcp repo image is 598 MB. The fiks-tools image is 1.04 GB. Its volume copy is made
  once per tools digest and shared read-only by every container.

## Disk

- **Per container:** one `node_modules` volume (`<container>-nm`). It is removed by `cleanup()`.
- **Shared:** fiks-tools volumes (`fiks-tools-<digest>`) are kept. Remove the ones you no longer need with
  `docker volume ls --filter label=fiks.sandbox=1`.
- **Leftovers:** clean up anything a crashed run left behind with
  `docker rm -f $(docker ps -aq --filter label=fiks.sandbox=1)`.
