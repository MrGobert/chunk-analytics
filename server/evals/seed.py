"""
One-time (idempotent) seeding for the eval account.

Creates the persistent fixture data the steady-state search cases depend on:
  - the "Meridian-7" fixture document, uploaded through the real web flow so
    it is embedded into Qdrant under the eval uid (documents_only / all_mode)
  - a fixture note matching the web createNote field shape ([GROUNDED] surfacing)

Safe to re-run: existing fixtures are detected and left alone.

CLI:  python -m evals.seed          (also exposed as the seed_eval_account Celery task)
"""

import argparse
import json
import logging
import sys

from firebase_admin import firestore

from evals import documents
from evals.auth import sign_in
from evals.cases import SEED_DOC_CONTENT, SEED_DOC_NAME

SEED_NOTE_TITLE = "Meridian-7 mission notes (eval fixture)"
SEED_NOTE_CONTENT = (
    "# Meridian-7 mission notes (eval fixture)\n\n"
    "Fixture note for the automated eval suite.\n\n"
    "- The Meridian-7 launch window opens on March 3, 2027.\n"
    "- Mission director: Dr. Imara Chen.\n"
    "- Launch site: Pad 39-C.\n"
)


def _db():
    from firebase_setup import db

    return db


def seed(force: bool = False) -> dict:
    identity = sign_in()
    uid = identity.uid
    outcome = {"uid": uid}

    # --- fixture document ---
    existing = list(
        _db()
        .collection("document_metadata")
        .document(uid)
        .collection("files_metadata")
        .where("originalFileName", "==", SEED_DOC_NAME)
        .limit(1)
        .stream()
    )
    if existing and not force:
        outcome["document"] = f"already seeded ({existing[0].id})"
    else:
        if existing and force:
            for doc in existing:
                data = doc.to_dict() or {}
                documents.delete_document(identity, doc.id, data.get("storagePath", ""))
        upload = documents.upload_document(identity, SEED_DOC_NAME, SEED_DOC_CONTENT)
        indexing = documents.wait_for_indexing(upload["document_id"], timeout_s=240)
        outcome["document"] = {"uploaded": upload, "indexing": indexing}
        if indexing.get("status") != "completed":
            outcome["warning"] = (
                "fixture document indexing did not complete — documents_only will be "
                "skipped until it does"
            )

    # --- fixture note ---
    notes = (
        _db().collection("users").document(uid).collection("notes")
        .where("title", "==", SEED_NOTE_TITLE)
        .limit(1)
        .stream()
    )
    if list(notes) and not force:
        outcome["note"] = "already seeded"
    else:
        now = firestore.SERVER_TIMESTAMP
        _db().collection("users").document(uid).collection("notes").add(
            {
                "title": SEED_NOTE_TITLE,
                "content": SEED_NOTE_CONTENT,
                "contentPlainText": SEED_NOTE_CONTENT.replace("# ", "").replace("- ", ""),
                "tag": "evals",
                "folderId": None,
                "createdAt": now,
                "updatedAt": now,
                "isPublic": False,
                "publicDocumentId": None,
                "documentId": None,
                "storagePath": None,
                "schemaVersion": 1,
                "migratedFromSwiftData": False,
                "originalSwiftDataId": None,
            }
        )
        outcome["note"] = "created"

    logging.info(f"[EVALS] seed outcome: {outcome}")
    return outcome


def main():
    parser = argparse.ArgumentParser(description="Seed the eval account fixtures")
    parser.add_argument("--force", action="store_true", help="recreate fixtures even if present")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        print(json.dumps(seed(force=args.force), indent=2, default=str))
    except Exception as exc:
        print(f"seeding failed: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
