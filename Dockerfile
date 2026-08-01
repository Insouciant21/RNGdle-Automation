FROM mcr.microsoft.com/playwright:v1.62.0-noble

ENV NODE_ENV=production \
    CONFIG_PATH=/app/config/config.yaml

WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY src ./src
COPY config/config.example.yaml ./config/config.example.yaml

EXPOSE 3000

CMD ["node", "src/index.js", "rngdle"]
