FROM mcr.microsoft.com/playwright:v1.53.0-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV PORT=4310
ENV SESSION_DIR_NAME=chatgpt-session

EXPOSE 4310

CMD ["npm", "start"]
