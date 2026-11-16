# Statute: the website, the demo shop, and live Kane CLI audits in one container.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends wget gnupg ca-certificates fonts-liberation fonts-noto-color-emoji \
 && wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /usr/share/keyrings/google.gpg \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g @testmuai/kane-cli

# Hugging Face Spaces runs containers as user 1000 on port 7860.
RUN useradd -m -u 1000 app || true
WORKDIR /app
COPY --chown=1000:1000 . .
RUN rm -rf census/private data && mkdir -p data && chown -R 1000:1000 /app
USER 1000
ENV HOME=/home/app PORT=7860 LOW_MEMORY=1 MAX_STEPS=12 KANE_CLI_CHROME_PATH=/usr/bin/google-chrome-stable NODE_ENV=production
EXPOSE 7860
CMD ["node", "server/index.js"]
