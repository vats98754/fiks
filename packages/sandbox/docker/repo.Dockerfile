# Per-repo sandbox image (paper/PLAN.md P1): Linux node_modules installed from the target repo's
# lockfile, plus an offline pnpm store, so that F, P, suite, IV and local CI run with --network none.
# The build context holds only the lockfile inputs (manifest/), the git shim and this file, so the
# same lockfile gives the same layers and the same image digest.
# Base pinned by digest (multi-arch index of node:22.23.3-bookworm-slim).
FROM node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9

# curl: so egress probes fail on the network, not on a missing binary. git: the shim's real git.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl git \
  && rm -rf /var/lib/apt/lists/*

ARG PNPM_VERSION=9.12.3
RUN npm install -g "pnpm@${PNPM_VERSION}" && npm cache clean --force \
  && rm -rf /root/.npm /root/.cache

# Global pnpm config (read whatever HOME is): the store lives in the image and is used offline.
RUN printf 'store-dir=/opt/pnpm-store\nupdate-notifier=false\n' > /usr/local/etc/npmrc

COPY git-shim.sh /opt/fiks-shim/git
RUN sed -i -e 's#@@FIKS_SHIM_LOG@@#/tmp/.fiks-git-push.log#' -e 's#@@FIKS_REAL_GIT@@#/usr/bin/git#' \
    /opt/fiks-shim/git \
  && chmod 0555 /opt/fiks-shim/git

WORKDIR /work
COPY manifest/ ./
RUN pnpm fetch --frozen-lockfile --reporter=append-only \
  && pnpm install --frozen-lockfile --offline --reporter=append-only \
  && rm -rf /root/.cache /root/.local /tmp/*

LABEL org.opencontainers.image.title="fiks-sbx repo image" \
      fiks.sandbox.kind="repo"
