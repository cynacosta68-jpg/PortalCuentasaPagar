FROM node:20-alpine

RUN apk add --no-cache dumb-init

WORKDIR /app

COPY package.json package-lock.json* ./
# Usa npm ci si hay lockfile (build reproducible); si no, npm install.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY . .

# Usuario sin root
RUN addgroup -S portal && adduser -S portal -G portal && \
    chown -R portal:portal /app
USER portal

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
