# Note: Not used in v1; replaced by the JSONL log and snapshot export.
FROM oven/bun:1.1.38-alpine
ARG SERVICE
WORKDIR /app
COPY ${SERVICE}/package.json ${SERVICE}/bun.lock* ./
RUN bun install
COPY ${SERVICE}/ ./
CMD ["bun", "run", "start"]
