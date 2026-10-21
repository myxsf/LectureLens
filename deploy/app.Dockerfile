# The app container: static build + Go server, no LibreOffice inside.
FROM node:22-alpine AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM golang:1.24-alpine AS api
WORKDIR /src
COPY go.mod server.go ./
RUN CGO_ENABLED=0 go build -o /out/lecturelens .

FROM alpine:3.20
RUN adduser -D -u 10001 app
WORKDIR /app
COPY --from=api /out/lecturelens /app/lecturelens
COPY --from=web /src/dist /app/dist
COPY assets /app/assets
ENV DIST_DIR=/app/dist \
    ASSETS_DIR=/app/assets \
    ADDR=0.0.0.0:3001
USER app
EXPOSE 3001
CMD ["/app/lecturelens"]
