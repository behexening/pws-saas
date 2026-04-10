FROM node:20-slim

# Install Python
RUN apt-get update && apt-get install -y python3 python3-pip python3-full

# Set working directory
WORKDIR /app

# Copy files
COPY . .

# Install Node deps
RUN npm install

# Install Python deps
RUN pip3 install --break-system-packages pdfplumber shapefile shapely anthropic

EXPOSE 3000
CMD ["node", "backend_v2.js"]
