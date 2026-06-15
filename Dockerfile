# Round is a fully static Next.js export (output: 'export') — build the
# bundle with Node, then serve out/ with nginx. No runtime server needed;
# OCR calls go from the browser straight to LMStudio on the LAN.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html
EXPOSE 80
