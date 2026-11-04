# Onyx Order – front (site client + /cuisine + /admin dans un seul conteneur Next.js)
FROM node:22-alpine AS build
WORKDIR /app
# adresses intégrées au moment de la construction
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_RESTAURANT=fastcamion
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL VITE_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_RESTAURANT=$NEXT_PUBLIC_RESTAURANT
COPY package*.json ./
COPY web/package.json web/
COPY cuisine/package.json cuisine/
COPY admin/package.json admin/
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
COPY --from=build /app/web/public ./web/public
USER node
EXPOSE 3000
CMD ["node", "web/server.js"]
