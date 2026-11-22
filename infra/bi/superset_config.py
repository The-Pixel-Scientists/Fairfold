# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Superset's settings for one tenant's BI instance (ADR 0039). Every value
# comes from the environment, and every secret from a file it names; a
# missing one stops the process. Sign-in is through the tenant's OIDC
# provider only, with roles from its groups. Nothing here sends data out,
# runs unattended or lets anyone add or change a database connection.

import os
import re
import time
from datetime import timedelta

from flask import abort, request, session
from flask_appbuilder.security.manager import AUTH_OAUTH
from flask_login import current_user, logout_user
from superset.security import SupersetSecurityManager

from bi_settings import VIEWER_ROLE, database_uri, secret, setting


SQLALCHEMY_DATABASE_URI = database_uri("metadata", "superset", secret("TPS_BI_METADATA_PASSWORD_FILE"))
SECRET_KEY = secret("TPS_BI_SECRET_KEY_FILE")

# Off: alerts and reports, embedding and guest tokens, Jinja in SQL, and
# uploads into databases. The public role has no permissions, so every page
# but /health needs sign-in.
FEATURE_FLAGS = {
    "ALERT_REPORTS": False,
    "EMBEDDED_SUPERSET": False,
    "ENABLE_TEMPLATE_PROCESSING": False,
}
PUBLIC_ROLE_LIKE = None
AUTH_ROLE_PUBLIC = "Public"
ALLOWED_EXTENSIONS: set[str] = set()
PREVENT_UNSAFE_DB_CONNECTIONS = True

# Behind the operator's reverse proxy, on the tool's own host name.
ENABLE_PROXY_FIX = True
PREFERRED_URL_SCHEME = "https"
WTF_CSRF_ENABLED = True

# Superset's telemetry pixel is off here and in the image's environment, and
# the content security policy lets the page load images and make requests
# from this host only, so a browser sends nothing to an analytics or map
# service even if a release ignores the switch.
SCARF_ANALYTICS = False
TALISMAN_ENABLED = True
TALISMAN_CONFIG = {
    "content_security_policy": {
        "base-uri": ["'self'"],
        "default-src": ["'self'"],
        "img-src": ["'self'", "data:", "blob:"],
        "connect-src": ["'self'"],
        "worker-src": ["'self'", "blob:"],
        "object-src": "'none'",
        "style-src": ["'self'", "'unsafe-inline'"],
        "script-src": ["'self'", "'strict-dynamic'"],
    },
    "content_security_policy_nonce_in": ["script-src"],
    # The reverse proxy serves HTTPS and redirects plain HTTP.
    "force_https": False,
    "session_cookie_secure": True,
}

# Host-only cookies of its own, never the platform's, ending 12 hours after
# sign-in (ADR 0010's absolute limit for staff).
SESSION_HOURS = 12
SESSION_COOKIE_NAME = "tps_bi_session"
SESSION_COOKIE_DOMAIN = None
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_REFRESH_EACH_REQUEST = False
PERMANENT_SESSION_LIFETIME = timedelta(hours=SESSION_HOURS)
REMEMBER_COOKIE_SECURE = True
REMEMBER_COOKIE_HTTPONLY = True
REMEMBER_COOKIE_DURATION = timedelta(hours=SESSION_HOURS)

AUTH_TYPE = AUTH_OAUTH
AUTH_USER_REGISTRATION = True
# A user in neither group gets Public, which has no permissions.
AUTH_USER_REGISTRATION_ROLE = "Public"
AUTH_ROLES_SYNC_AT_LOGIN = True
AUTH_ROLES_MAPPING = {
    setting("TPS_BI_ADMIN_GROUP"): ["Admin"],
    setting("TPS_BI_VIEWER_GROUP"): ["Gamma", VIEWER_ROLE],
}
OAUTH_PROVIDERS = [
    {
        "name": "oidc",
        "icon": "fa-key",
        "token_key": "access_token",
        "remote_app": {
            "client_id": setting("TPS_BI_OIDC_CLIENT_ID"),
            "client_secret": secret("TPS_BI_OIDC_CLIENT_SECRET_FILE"),
            "server_metadata_url": setting("TPS_BI_OIDC_ISSUER").rstrip("/")
            + "/.well-known/openid-configuration",
            "client_kwargs": {"scope": "openid email profile"},
        },
    }
]
GROUPS_CLAIM = os.environ.get("TPS_BI_OIDC_GROUPS_CLAIM") or "groups"


class SecurityManager(SupersetSecurityManager):
    def oauth_user_info(self, provider, response=None):
        # The ID token's claims, checked by Authlib, or else the userinfo endpoint's.
        claims = (response or {}).get("userinfo") or self.oauth_remotes[provider].userinfo()
        groups = claims.get(GROUPS_CLAIM) or []
        return {
            "username": claims["sub"],
            "email": claims.get("email", ""),
            "first_name": claims.get("given_name", ""),
            "last_name": claims.get("family_name", ""),
            "role_keys": groups if isinstance(groups, list) else [],
        }


CUSTOM_SECURITY_MANAGER = SecurityManager

# Database connections, and bundles that could carry one, change only
# through the operator's import, never through the API, whatever the role.
REFUSED = re.compile(r"^/api/v1/(database(/|$)|[a-z_]+/import/?$)")


def FLASK_APP_MUTATOR(app):
    @app.before_request
    def guard():
        if request.method not in ("GET", "HEAD", "OPTIONS") and REFUSED.match(request.path):
            abort(403)
        if current_user.is_authenticated:
            session.permanent = True
            started = session.setdefault("tps_signed_in_at", time.time())
            if time.time() - started > SESSION_HOURS * 3600:
                logout_user()
                session.clear()
