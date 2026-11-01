# Scribe — static build served by nginx. All processing happens in the browser;
# this container never receives a video file.
FROM nginx:1.27-alpine

COPY dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
