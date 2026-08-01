FROM mcr.microsoft.com/playwright:v1.62.0-noble

ENV NODE_ENV=production \
    CONFIG_PATH=/app/config/default.yaml

WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY src ./src
COPY config/default.yaml ./config/default.yaml

EXPOSE 3000

CMD ["node", "src/index.js", "rngdle"]
