# Runs the slide converter as its own small service so the app server stays tiny.
# The same image works locally (docker compose up converter) and in production.
FROM alpine:3.20

RUN apk add --no-cache libreoffice nodejs su-exec \
 && adduser -D -u 10001 converter

WORKDIR /srv
COPY converter-server.mjs /srv/converter-server.mjs

ENV SOFFICE_PATH=/usr/bin/soffice \
    PORT=8000 \
    MAX_UPLOAD_MB=100

EXPOSE 8000
USER converter
CMD ["node", "/srv/converter-server.mjs"]
