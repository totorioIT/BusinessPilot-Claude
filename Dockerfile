# BusinessPilot app: API + dashboard in one container. The website (apps/website) is a
# static Astro build and is deployed separately.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/website/package.json apps/website/
RUN npm ci --workspace @bp/api --workspace @bp/dashboard --include-workspace-root
COPY apps/api apps/api
COPY apps/dashboard apps/dashboard
RUN npm run build -w @bp/api && npm run build -w @bp/dashboard

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DASHBOARD_DIST=/app/dashboard
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/website/package.json apps/website/
RUN npm ci --workspace @bp/api --omit=dev && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/dashboard/dist dashboard
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]
