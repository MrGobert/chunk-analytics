"""
Flask app entrypoint for the analytics server.
"""

import os

import sentry_sdk

sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN", ""),
    traces_sample_rate=0.1,
    release=os.environ.get("HEROKU_SLUG_COMMIT"),
    environment=os.environ.get("SENTRY_ENVIRONMENT", "production"),
    send_default_pii=True,
    include_local_variables=True,
)

from flask import Flask, jsonify
from flask_cors import CORS

from analytics_api import analytics_api_bp


def create_app():
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    CORS(app)
    app.register_blueprint(analytics_api_bp, url_prefix="/api/analytics")

    @app.route("/")
    def health():
        return jsonify({"status": "ok", "service": "cerebral-analytics"}), 200

    return app


app = create_app()
