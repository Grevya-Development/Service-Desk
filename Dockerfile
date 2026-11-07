# Grevya Service Desk — production image (Next.js standalone server)
#
# Build:  docker build -t service-desk .
# Run:    docker run -p 3000:3000 \
#           -e SUPABASE_URL=https://<ref>.supabase.co \
#           -e SUPABASE_ANON_KEY=<anon key> \
#           -e SUPABASE_SERVICE_ROLE_KEY=<service-role key> \
#           -e PEOPLE_SUCCESS_URL=https://peoplesuccess.vercel.app \
#           -e CRON_SECRET=<random string> \
#           ghcr.io/grevya-development/service-desk:latest
#
# All settings are read at runtime (nothing is baked into the image), so one image
# works for every environment. Health check: GET /api/health.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
