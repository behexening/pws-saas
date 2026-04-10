FROM node:20-slim
RUN apt-get update && apt-get install -y python3 python3-pip
WORKDIR /app
COPY . .
RUN npm install
RUN pip3 install pdfplumber shapefile shapely anthropic
EXPOSE 3000
CMD ["node", "backend_v2.js"]
