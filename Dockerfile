# Stage 1: Build the Angular app
FROM node:20 AS build
WORKDIR /app
# Install dependencies
COPY Frontend/package*.json ./
RUN npm install
# Copy source and build
COPY Frontend/ .
RUN npm run build

# Stage 2: Run app with NGINX
FROM nginx:alpine
COPY --from=build /app/dist/frontend /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
