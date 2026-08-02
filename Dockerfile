# --- Valet Ticket System ---
FROM node:22-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# App source
COPY src ./src
COPY public ./public

# Persisted SQLite database lives here (mount a volume to keep data).
ENV DB_PATH=/data/valet.db
VOLUME ["/data"]

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
