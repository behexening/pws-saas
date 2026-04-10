FROM node:20-slim

RUN apt-get update && apt-get install -y python3 python3-pip python3-full

WORKDIR /app

COPY . .

RUN npm install

RUN pip3 install --break-system-packages pdfplumber pyshp shapely anthropic

EXPOSE 3000
CMD ["node", "backend_v2.js"]
