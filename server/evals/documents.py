"""
Document-pipeline helpers for the eval suite.

Mirrors the chunk-web upload flow (src/lib/api/documents.ts) as a black-box
client of production cerebral:

  upload:  Storage users/{uid}/documents/{id}/{name}
           -> Firestore document_metadata/{uid}/files_metadata/{id}
           -> POST {target}/upload (multipart, Bearer)  [backend indexes into Qdrant]
  wait:    poll Firestore tasks/{documentId}.status until completed/error
  delete:  POST {target}/api/deleteDocument (removes Qdrant vectors)
           + best-effort Storage/Firestore cleanup

Used by both the one-time seeder (seed.py) and the per-run
document_upload_search case.
"""

import logging
import random
import string
import time
from datetime import timedelta

import httpx

from evals import config
from evals.auth import EvalIdentity


def _db():
    from firebase_setup import db

    return db


def _bucket():
    from firebase_admin import storage

    name = config.firebase_storage_bucket()
    if not name:
        raise RuntimeError("FIREBASE_STORAGE_BUCKET not configured")
    return storage.bucket(name)


def generate_document_id() -> str:
    # Same shape the web client generates: doc_{ms}_{random9}
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=9))
    return f"doc_{int(time.time() * 1000)}_{suffix}"


def upload_document(
    identity: EvalIdentity,
    file_name: str,
    content: str,
    tag: str = "evals",
    timeout_s: float = 30.0,
) -> dict:
    """Upload a text document exactly the way the web client does.

    Returns {"document_id", "storage_path"} on success; raises on failure.
    """
    uid = identity.uid
    document_id = generate_document_id()
    storage_path = f"users/{uid}/documents/{document_id}/{file_name}"
    data = content.encode("utf-8")

    bucket = _bucket()
    blob = bucket.blob(storage_path)
    blob.upload_from_string(data, content_type="text/plain")
    document_url = blob.generate_signed_url(
        version="v4", expiration=timedelta(hours=24), method="GET"
    )

    # Firestore metadata — field set mirrors the web client's saveFileMetadata.
    timestamp = int(time.time())
    _db().collection("document_metadata").document(uid).collection(
        "files_metadata"
    ).document(document_id).set(
        {
            "userUID": uid,
            "document_id": document_id,
            "timestamp": timestamp,
            "fileExtension": file_name.rsplit(".", 1)[-1] if "." in file_name else "",
            "originalFileName": file_name,
            "storagePath": storage_path,
            "selectedSize": 400,
            "fileSize": len(data),
            "tag": tag,
            "totalPages": max(1, len(content) // 2500),
        }
    )

    # Client-side extracted.txt (the web does this for text formats so the
    # content is immediately available; the backend still runs indexing).
    extracted_path = f"users/{uid}/documents/{document_id}/extracted.txt"
    bucket.blob(extracted_path).upload_from_string(data, content_type="text/plain")
    _db().collection("document_metadata").document(uid).collection(
        "files_metadata"
    ).document(document_id).update(
        {"extractedTextPath": extracted_path, "extractedTextLength": len(content)}
    )

    # Notify the backend — multipart form, no file blob (already in Storage).
    form_fields = {
        "user_uid": uid,
        "document_url": document_url,
        "document_id": document_id,
        "file_name": file_name,
        "time_stamp": str(int(time.time() * 1000)),
        "selected_size": "400",
        "tag": tag,
        "isUpdating": "false",
        "isTempDoc": "false",
    }
    response = httpx.post(
        f"{config.target_url()}/upload",
        files={key: (None, value) for key, value in form_fields.items()},
        headers={"Authorization": f"Bearer {identity.token()}"},
        timeout=timeout_s,
    )
    if response.status_code != 200:
        raise RuntimeError(
            f"/upload failed ({response.status_code}): {response.text[:300]}"
        )
    payload = response.json()
    if payload.get("status") != "success":
        raise RuntimeError(f"/upload rejected: {str(payload)[:300]}")

    logging.info(f"[EVALS] uploaded document {document_id} ({file_name})")
    return {"document_id": document_id, "storage_path": storage_path}


def wait_for_indexing(document_id: str, timeout_s: int = 240, interval_s: float = 5.0) -> dict:
    """Poll Firestore tasks/{documentId} until status completed/error.

    Returns {"status": "completed"|"error"|"timeout", "waited_s": ...}.
    """
    deadline = time.monotonic() + timeout_s
    started = time.monotonic()
    last_status = "missing"
    while time.monotonic() < deadline:
        snapshot = _db().collection("tasks").document(document_id).get()
        if snapshot.exists:
            last_status = str((snapshot.to_dict() or {}).get("status", "unknown"))
            if last_status in ("completed", "error"):
                return {
                    "status": last_status,
                    "waited_s": round(time.monotonic() - started, 1),
                }
        time.sleep(interval_s)
    return {
        "status": "timeout",
        "last": last_status,
        "waited_s": round(time.monotonic() - started, 1),
    }


def delete_document(identity: EvalIdentity, document_id: str, storage_path: str = "") -> dict:
    """Delete a document the way the web client does. Returns per-step results."""
    uid = identity.uid
    outcome = {"qdrant": False, "storage": False, "firestore": False}

    # 1. Backend delete (Qdrant vectors) — the critical step.
    try:
        response = httpx.post(
            f"{config.target_url()}/api/deleteDocument",
            json={"user_uid": uid, "document_id": document_id},
            headers={"Authorization": f"Bearer {identity.token()}"},
            timeout=30.0,
        )
        outcome["qdrant"] = response.status_code == 200
        if not outcome["qdrant"]:
            outcome["qdrant_error"] = f"{response.status_code}: {response.text[:200]}"
    except httpx.HTTPError as exc:
        outcome["qdrant_error"] = str(exc)

    # 2. Best-effort Storage cleanup (file + extracted.txt).
    try:
        bucket = _bucket()
        for path in filter(None, [storage_path, f"users/{uid}/documents/{document_id}/extracted.txt"]):
            blob = bucket.blob(path)
            if blob.exists():
                blob.delete()
        outcome["storage"] = True
    except Exception as exc:
        outcome["storage_error"] = str(exc)

    # 3. Best-effort Firestore cleanup (metadata, task doc + files, summary).
    try:
        db = _db()
        db.collection("document_metadata").document(uid).collection(
            "files_metadata"
        ).document(document_id).delete()
        task_ref = db.collection("tasks").document(document_id)
        for file_doc in task_ref.collection("files").stream():
            file_doc.reference.delete()
        task_ref.delete()
        db.collection("document_summaries").document(uid).collection(
            "summaries"
        ).document(document_id).delete()
        outcome["firestore"] = True
    except Exception as exc:
        outcome["firestore_error"] = str(exc)

    logging.info(f"[EVALS] deleted document {document_id}: {outcome}")
    return outcome
