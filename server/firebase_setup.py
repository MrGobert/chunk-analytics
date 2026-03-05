import json
import logging
import os

import firebase_admin
from firebase_admin import credentials, firestore
from google.oauth2 import service_account


# This function initializes Firebase only once
def initialize_firebase():
    if not firebase_admin._apps:
        gcp_credentials_json = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        logging.warning(
            f"Initialize Firebase : {bool(gcp_credentials_json)}"
        )  # Modified log to show if credentials are present
        if gcp_credentials_json:
            try:
                credentials_dict = json.loads(gcp_credentials_json)
                cred = credentials.Certificate(credentials_dict)
                firebase_admin.initialize_app(cred)
                logging.info(
                    "Firebase app initialized using GOOGLE_APPLICATION_CREDENTIALS"
                )
            except json.JSONDecodeError as e:
                logging.error(
                    f"Error decoding GOOGLE_APPLICATION_CREDENTIALS JSON: {e}"
                )

                raise ValueError(
                    "Invalid JSON for GOOGLE_APPLICATION_CREDENTIALS"
                ) from e
        else:
            logging.warning(
                "GOOGLE_APPLICATION_CREDENTIALS not found. Initializing Firebase with default credentials."
            )
            firebase_admin.initialize_app()
    return firestore.client()


def get_credentials():
    gcp_credentials_json = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    logging.warning(f"Firebase get credentials json: {bool(gcp_credentials_json)}")
    if gcp_credentials_json:
        try:
            credentials_dict = json.loads(gcp_credentials_json)
            return service_account.Credentials.from_service_account_info(
                credentials_dict
            )
        except json.JSONDecodeError as e:
            logging.error(
                f"Error decoding GOOGLE_APPLICATION_CREDENTIALS JSON in get_credentials: {e}"
            )

            raise ValueError("Invalid JSON for GOOGLE_APPLICATION_CREDENTIALS") from e

    logging.warning(
        "GOOGLE_APPLICATION_CREDENTIALS not found for get_credentials. Using default service account."
    )
    return None


# Initialize Firestore client
db = initialize_firebase()
# Get credentials
credentials = get_credentials()
