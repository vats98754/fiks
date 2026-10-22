# fiks-tools image (PLAN P1, round 6/7): the fiks repo at one commit, from `git archive` (so no .env,
# .fiks or .work), with its Linux node_modules (Linux esbuild/tsx binaries). Per-attempt and grading
# containers mount its /opt/fiks read-only and run the CLI through execFiks().
FROM node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9

ARG PNPM_VERSION=9.12.3
RUN npm install -g "pnpm@${PNPM_VERSION}" && npm cache clean --force \
  && rm -rf /root/.npm /root/.cache
RUN printf 'store-dir=/var/cache/fiks-pnpm-store\nupdate-notifier=false\n' > /usr/local/etc/npmrc

# fiks.tar = `git archive --prefix=fiks/ <commit>` (ADD extracts it).
ADD fiks.tar /opt/

WORKDIR /opt/fiks
# 0: the merged commit's own lockfile, frozen. 1 (test-only images): apply deps-fragments first.
ARG APPLY_FRAGMENTS=0
RUN if [ "$APPLY_FRAGMENTS" = 1 ]; then \
      node scripts/apply-dep-fragments.mjs && pnpm install --no-frozen-lockfile --reporter=append-only; \
    else \
      pnpm install --frozen-lockfile --reporter=append-only; \
    fi \
  && rm -rf /var/cache/fiks-pnpm-store /root/.cache /root/.local /tmp/* \
  && test ! -e /opt/fiks/.env && test ! -e /opt/fiks/.fiks && test ! -e /opt/fiks/.work

ARG FIKS_COMMIT=unknown
ARG TEST_ONLY=false
LABEL org.opencontainers.image.title="fiks-tools" \
      fiks.sandbox.kind="tools" \
      fiks.tools.commit="${FIKS_COMMIT}" \
      fiks.tools.testOnly="${TEST_ONLY}"
