# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The reverse proxy (ADR 0030): the official nginx image, Alpine variant,
# pinned by digest, with this folder's configuration copied in, so nothing
# is mounted from the host. compose.stack.yaml runs it as the nginx user.

FROM nginx:1.31.6-alpine@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2

# COPY --chmod would give the folders it makes the files' mode, with no
# search bit, so the nginx user could open nothing in them.
RUN install -d -m 0755 /etc/nginx/proxy/templates
COPY --chmod=0444 nginx.conf limits.conf forward.conf app.conf web.conf /etc/nginx/proxy/
COPY --chmod=0444 templates/sites.conf.template /etc/nginx/proxy/templates/
USER 101:101
CMD ["nginx", "-c", "/etc/nginx/proxy/nginx.conf", "-g", "daemon off;"]
