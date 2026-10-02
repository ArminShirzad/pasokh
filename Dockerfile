# Pasokh — one image, four roles (see docker-compose.yml):
#   web     `npm run start`      next start
#   worker  `npm run worker`     tsx worker/dm-worker.ts (raw TypeScript: needs the
#                                source tree, tsconfig.json for the @/ alias and
#                                the generated Prisma client)
#   cron    `sh scripts/cron.sh` calls /api/cron on a schedule (needs wget)
#   migrate `npx prisma migrate deploy`
#
# next.config.ts has no `output: "standalone"`, so `next start` needs the full
# node_modules anyway; the runner keeps it rather than trying to slim it, which
# is what breaks the worker (MODULE_NOT_FOUND on @/lib imports).
#
# Node 24: Node 20 reached end of life in April 2026.

FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma detects the OpenSSL version to pick its schema engine; without it, it
# guesses openssl-1.1.x, which this Debian release does not ship.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# `npm run build` = `prisma generate && next build`.
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# wget: cron.sh and the quick-tunnel lookup in the entrypoint. tzdata: dates in
# the owner's timezone (TZ, e.g. Asia/Tehran) instead of UTC. openssl: the
# Prisma schema engine that `migrate deploy` runs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget ca-certificates tzdata openssl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/app/generated ./app/generated
COPY --from=build /app/public ./public
COPY --from=build /app/lib ./lib
COPY --from=build /app/worker ./worker
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/package.json ./package.json

RUN chmod +x scripts/docker-entrypoint.sh scripts/cron.sh

EXPOSE 3000
# Resolves the public URL (quick tunnel) before starting the role's command.
ENTRYPOINT ["scripts/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
