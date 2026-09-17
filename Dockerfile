FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev --ignore-scripts

# Copy application source & assets
COPY src/ ./src/
COPY web/ ./web/
COPY altcha.min.js* ./

# Create data directory
RUN mkdir -p database

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]