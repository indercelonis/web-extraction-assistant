# Serve the static Webpage Extraction Assistant behind Cloud Run + IAP.
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

# App assets only (not node_modules / deploy tooling).
COPY index.html /usr/share/nginx/html/
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
COPY vendor/ /usr/share/nginx/html/vendor/
COPY fixtures/ /usr/share/nginx/html/fixtures/

# Drop Node-only test helpers from the image.
RUN rm -f /usr/share/nginx/html/js/check-folder-node.js \
          /usr/share/nginx/html/js/check-xpath-node.js

EXPOSE 8080
