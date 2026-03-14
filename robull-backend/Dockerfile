FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
# Schema must be available at dist/db/schema.sql for the migrate script
COPY src/db/schema.sql ./dist/db/schema.sql
EXPOSE 3001
CMD ["node", "dist/index.js"]
