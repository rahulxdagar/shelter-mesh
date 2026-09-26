# Cloud Run / Render / Railway. Node runs the TypeScript sources directly (type stripping).
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 8080
CMD ["node", "src/index.ts"]
