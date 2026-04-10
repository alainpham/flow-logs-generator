FROM node:24-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 8123

CMD ["node", "src/index.js", "config/default.json"]
