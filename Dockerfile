FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 8123

CMD ["node", "src/index.js", "config/order-processing.json"]
