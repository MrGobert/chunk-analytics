"""
Flask app entrypoint for the analytics server.
"""

from flask import Flask, jsonify
from flask_cors import CORS

from analytics_api import analytics_api_bp


def create_app():
    app = Flask(__name__)
    CORS(app)
    app.register_blueprint(analytics_api_bp, url_prefix="/api/analytics")

    @app.route("/")
    def health():
        return jsonify({"status": "ok", "service": "cerebral-analytics"}), 200

    return app


app = create_app()
