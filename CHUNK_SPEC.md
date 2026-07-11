# Chunk AI — Comprehensive Spec Sheet

> **Last Updated:** March 27, 2026  
> **Author:** James Gobert  
> **Company:** Curious Minds Software, LLC

---

## 1. Business Overview

| Field | Detail |
|-------|--------|
| **App Name** | Chunk AI (marketed as "Chunk") |
| **Company** | Curious Minds Software, LLC |
| **Developer** | James Gobert |
| **Platforms** | iOS, iPadOS, macOS, visionOS |
| **Category** | AI Search & Research / Productivity |
| **Target Audience** | Knowledge workers, researchers, students, power users who need multi-model AI chat, document management, and deep research |
| **Monetization** | Freemium subscription via RevenueCat (App Store + Stripe for web) |
| **Backend URL** | `https://cerebral-12658c15cdb1.herokuapp.com` |
| **Notes URL** | `https://notes.chunkapp.com/notes/{docId}` |
| **Website** | `https://www.chunkapp.com` |

---

## 2. App Architecture

### Frontend — SwiftUI (MVVM)

- **Pattern:** MVVM with `@EnvironmentObject` service injection
- **Entry Point:** `ChunkApp.swift` — single entry for all platforms
- **Platform Adaptation:** `#if os(iOS/macOS/visionOS)` conditional compilation
- **Local Storage:** SwiftData (`@Model`) for notes; UserDefaults for caches
- **Networking:** `URLSession` streaming (SSE) for chat; Socket.IO client for real-time callbacks

### Backend — Python/Flask on Heroku

- **Pattern:** Service-oriented with dependency injection container (`core/container.py`)
- **WSGI:** Gunicorn with eventlet worker (async)
- **Background Tasks:** Celery with Redis broker (research reports, URL extraction, memory processing)
- **Real-time:** Flask-SocketIO (eventlet) — namespace `/callbacks`
- **Security:** Firebase Auth token verification (`@require_auth` decorator), Flask-Talisman, CORS whitelist

### Data Layer

| Service | Purpose |
|---------|---------|
| Firebase Auth | User authentication (email/password + Sign in with Apple) |
| Firestore | Conversations, collections, memories, user profiles, research history |
| Firebase Storage | Documents, generated images, research PDFs |
| Firebase Remote Config | Feature flags, dynamic configuration |
| Firebase Functions | Server-side triggers (notes sharing, etc.) |
| Qdrant Cloud | Vector embeddings for semantic search (`chunk-collection` alias) |
| Redis | Celery broker, WebSocket bridge for research progress |

---

## 3. Core Features

### 3.1 Intelligent Chat System

The chat system uses an **AI Decision Agent** (GPT-5-nano via OpenAI Responses API) that analyzes every user message and returns a structured JSON decision:

- **Search Mode Selection:** `ASSISTANT` | `WEB SEARCH` | `DOCUMENTS ONLY` | `ALL` | `YOUTUBE` | `RESEARCH`
- **Model Routing:** Picks the best model based on task complexity
- **Image Generation Detection:** Decides when to generate images vs. analyze uploaded images
- **Reasoning Effort:** Sets thinking depth for reasoning models (`low` / `medium` / `high`)
- **Clarification Requests:** Asks user for more details when intent is ambiguous

**Flow:** User message → Decision Agent → Route to search/model → Stream response back

### 3.2 Multi-Model AI Support

| Provider | Models | Key Capabilities |
|----------|--------|-------------------|
| **OpenAI** | **GPT-5.2** (latest), GPT-5.1, GPT-5-mini, GPT-5-nano, GPT-4o, O1/O3/O4-mini | Vision, streaming, reasoning effort levels |
| **Anthropic** | **Claude Opus 4.6** (latest), Claude 4.5 Sonnet | Vision, streaming, extended thinking (16K token budget) |
| **Google** | **Gemini 3 Pro** (latest), Gemini 3.0, Gemini 2.5 | Vision, thinking modes, native image generation |

**Image Generation Models:**
| Provider | Model | Routing |
|----------|-------|---------|
| **OpenAI** | GPT-Image | Used when user's selected AI model is OpenAI-based |
| **Google** | Gemini 3 Nano Banana Pro | Used when user's selected AI model is Google-based |

The Decision Agent determines which image generation model to use based on the user's currently selected AI model when the message is sent.

- **Default Model (free):** `gpt-5-mini-2025-08-07`
- **Premium Models (subscription required):** GPT-5.2, Claude Sonnet 4/Opus 4, Gemini 3 (prefix-matched)
- **Vision:** All providers support image analysis via uploaded images or URLs

### 3.3 Search Capabilities

**Vector Search (Qdrant)**
- Embedding: `text-embedding-3-small` (1536 dimensions)
- Collection: `chunk-collection` (alias for zero-downtime migrations)
- User-isolated with tag-based filtering (AND/OR/NOT logic)
- Score threshold: 0.4 minimum relevance
- Search limit: 40 results

**Web Search (Tavily)**
- Advanced depth search with image inclusion
- AI-powered query rephrasing for optimal results
- Max 6 results, 3000 tokens per search

**Search Modes:**
| Mode | Behavior |
|------|----------|
| `ASSISTANT` | Smart context with optional vector search |
| `WEB SEARCH` | Web results only (Tavily) |
| `DOCUMENTS ONLY` | Vector search only (Qdrant) |
| `ALL` | Combined web + vector search |
| `YOUTUBE` | YouTube-specific search via Tavily |
| `RESEARCH` | Deep research reports (GPT-Researcher) |

### 3.4 Deep Research Mode

Generates comprehensive multi-source research reports:

- **Engine:** GPT-Researcher library
- **Processing:** Celery background tasks (5-minute timeout)
- **Real-time Updates:** WebSocket progress callbacks per-device via Socket.IO SID
- **Deep Research:** Multi-depth, multi-breadth iterative research with progress tracking
- **Output:** Markdown report, research images, source URLs, cost breakdown
- **History:** Auto-saved to Firestore on first fetch
- **Export:** PDF and Markdown export to Firebase Storage
- **Task Polling:** Frontend polls `/api/task_status/<task_id>` as WebSocket fallback

### 3.5 Image Generation

**OpenAI (gpt-image-1.5 via Responses API)**
- Text-to-image generation
- Reference image editing with generation IDs for multi-turn editing
- Streaming partial images (0-3 partials)

**Gemini 3.0 Pro**
- Native image generation (`gemini-3-pro-image-preview`)
- Multi-turn editing (up to 14 reference images)
- Resolution: 1K, 2K (default), 4K
- Multiple aspect ratios supported
- Optional Google Search grounding

**Limits:** Free: 3/day | Pro: 20/day

### 3.6 Collections

Collections allow organizing and researching topics by grouping related content:

- **Contents:** Conversations, notes, URLs, documents
- **Limits:** Max 10 documents, 50MB, 20 URLs per collection
- **Collection Chat:** Context-aware chat using all selected items
- **URL Extraction:** Tavily Extract API for automatic content extraction → stored in Firestore
- **Summarization:** AI summarization (Claude Haiku) for token reduction
- **Token Tracking:** Model-specific context limits — Claude: 200K, GPT: 400K, Gemini: 1M

### 3.7 Notes System

Full-featured note-taking with rich text editing and a knowledge graph:

- **Editor:** WYSIWYG rich text (iOS/macOS native text views)
- **Formatting:** Bold, italic, underline, colors, fonts
- **Writing Tools:** Grammar check, tone adjustment, translation, summarization (AI-powered)
- **Wiki Links:** `[[double-bracket]]` syntax to link notes — auto-detected and rendered as tappable links
- **Backlinks:** Each note shows incoming links ("What links here"), turning notes into a connected knowledge graph
- **Storage:** SwiftData locally + Firestore sync + CloudKit sync
- **Share via URL:** Public notes at `https://notes.chunkapp.com/notes/{docId}` with backlink navigation between published notes
- **Vector Upload:** Add notes to Qdrant for semantic search
- **History:** Note version history via `NoteHistoryService`
- **Tags:** Filter/organize notes with tags
- **Folders:** Organize notes into folders (all platforms)

#### Notes Folder System

Folders let users organize notes into named groups with drag-and-drop. Implemented on all platforms.

**Firestore Schema:**
```
users/{uid}/
├── notes/{noteId}
│   └── folderId: string | null    # Folder assignment (null = unfiled/root)
└── noteFolders/{folderId}
    ├── name: string               # Folder display name
    ├── sortOrder: number           # Manual ordering (ascending)
    ├── createdAt: Timestamp
    └── updatedAt: Timestamp
```

**Key Behaviors:**
- Notes with `folderId: null` appear in the root "All Notes" view
- Notes inside a folder are hidden from root view (filtered by `folderId == null`)
- Search ignores folder boundaries — searches across all notes regardless of folder
- Creating a note while viewing a folder auto-assigns `folderId` to that folder
- Deleting a folder unfiles all its notes (`folderId → null`) via batched writes (499/batch)
- Folder delete does NOT delete the notes themselves

**Cross-Platform Sync:**
- Native `FirestoreNoteService.uploadNote()` uses `setData(merge: true)` → preserves `folderId`
- Native `updateFirestoreNote()` uses `updateData()` with explicit fields including `folderId`
- `folderId` synced via CloudKit + Firestore across all platforms

**Web Files:**
| File | Purpose |
|------|---------|
| `src/types/folder.ts` | `NoteFolder` interface |
| `src/types/note.ts` | `Note` interface (includes `folderId: string \| null`) |
| `src/lib/api/folders.ts` | Firestore CRUD for folders + `updateNoteFolder()` |
| `src/stores/notesStore.ts` | Zustand store with folder state, actions, filtering |
| `src/components/notes/FolderItem.tsx` | Folder row with rename, delete, drag target |
| `src/components/notes/FolderCreateInput.tsx` | Inline folder creation input |
| `src/components/notes/MoveToFolderMenu.tsx` | Context menu for moving notes between folders |
| `src/components/notes/NotesList.tsx` | Notes list with folder sidebar + drag-and-drop |

#### Knowledge Graph & Backlinks

Wiki-style `[[links]]` turn Chunk's notes from a flat document store into a **knowledge graph**. The most-linked notes naturally surface as hub concepts, and users discover connections they didn't explicitly make. All features below are implemented on all platforms (iOS, macOS, visionOS, Web).

**Core Features:**

| Feature | Description |
|---------|-------------|
| **Wiki Links (`[[…]]`)** | Type `[[` to search and link to any note. Auto-suggests existing note titles. Rendered as tappable inline links. |
| **Backlinks Panel** | Each note displays incoming links — "What links here" — for bidirectional navigation. |
| **Graph View** | Visual, interactive map of how notes connect. Zoomable, filterable. Nodes represent notes; edges represent wiki links. |
| **AI-Powered Related Notes** | Combines backlink graph with Qdrant vector embeddings to suggest related notes while writing. "This seems related to [Note X] — want to link it?" |
| **Backlink-Aware AI Chat** | When a user asks about a topic in chat, the system follows the backlink graph to pull in connected notes as context — not just the matched note, but its neighbourhood. Richer answers with less effort. |
| **Auto-Linking** | Detects mentions of existing note titles and auto-suggests or auto-creates backlinks. Reduces friction for building the graph. |
| **Map of Content (MOC) Generation** | AI generates a summary note for a cluster of heavily interconnected notes — auto-curated topic pages. |
| **Backlink-Enhanced Collections** | When adding a note to a collection, auto-suggests its backlinked notes too. "You added 'ML Basics' — also include these 4 linked notes?" |
| **Knowledge Graph Search** | Traverse the graph: "Show me everything connected to [Topic] within N hops." Follows explicit user-created relationships, distinct from vector search. |
| **Orphan Note Detection** | Surfaces notes with zero links in or out. "These 12 notes aren't connected to anything — want to review them?" |
| **Spaced Repetition / Review** | Uses the graph to identify important but rarely-revisited notes. Backlink count helps prioritise what's worth revisiting. |
| **Published Backlink Navigation** | On `notes.chunkapp.com`, viewers can follow backlinks between published notes — creating a public wiki-like experience. |

### 3.8 Documents

- **Upload:** PDF, DOCX, EPUB, RTF, TXT, Markdown, XLSX
- **Storage:** Firebase Storage with signed URLs
- **Processing:** Text extraction → chunking → vector embeddings in Qdrant
- **Viewers:** Universal document viewers (PDF, DOCX, EPUB, Markdown, RTF, plain text)
- **Page Counting:** EPUB parser, container XML parser for accurate page counts
- **Summarization:** AI document summarization via `DocumentSummarizationViewModel`

### 3.9 AI Memory System (Memory 2.0)

Two-layer memory system for personalized AI responses. Opt-in, privacy-first.

**Layer 1 — Atomic Facts (per-message)**
- Extracted from individual messages during chat
- Categories (10): personalInfo, preferences, workCareer, hobbies, health, location, relationships, goals, education, other
- Confidence scoring and relevance tracking
- On-device pre-filtering (`MemoryFilteringService`, threshold 0.5) before backend extraction
- Stored in Firestore at `users/{uid}/memories/`
- Embedding-based deduplication via `MemorySimilarityService`

**Layer 2 — Journal Insights (per-conversation)**
- Extracted at conversation end — sees full conversation arc
- Narrative-level insights: preference evolution, project context, interaction patterns, decisions and reasoning
- Max 2000 chars per entry, freeform tags, markdown support
- Up to 200 entries per user
- Stored in Firestore at `users/{uid}/memory_journal/`
- Detects contradictions with existing memories

**Smart Tiered Injection:**

| Tier | When | What's Injected |
|------|------|-----------------|
| **A** | Every conversation | User profile summary (~100 tokens) — auto-generated from all memories |
| **B** | New conversations | Profile + recent journal entries + relevant facts |
| **C** | Complex queries | Profile + semantic vector search across all memories and journal |

Tier selection based on query complexity analysis (word count, semantic patterns like "what do you know about", "remind me").

**Memory Lifecycle (Weekly Celery Beat):**
- Fan-out dispatcher → per-user tasks (Redis distributed lock)
- Consolidation: merge duplicate/overlapping memories (embedding similarity > 0.85)
- Contradiction detection across meaningful categories
- Stale memory expiry (6+ months untouched)
- Journal entry evolution
- User profile summary regeneration

**Privacy & Encryption:**
- Sensitivity tiers: Standard, Sensitive (health, relationships, location), Restricted (user-marked)
- Per-user encryption via `EncryptionService`
- `memoryEncrypted` flag on user doc — frontend falls back to backend API when true
- GDPR-ready: export and delete capabilities

**Frontend UX:**
- Single on/off toggle (no detail-level settings — "just works")
- Profile Summary card
- Contradictions banner
- Facts list with search/filter/edit
- "View Full Memory" button for Layer 2 journal entries

### 3.10 Artifacts (Transform)

Artifacts transforms content from multiple sources into structured learning materials. Pro-only feature.

**Input Sources:**

| Source | How |
|--------|-----|
| YouTube videos | URL → transcript via Supadata API (subtitles) or Whisper (audio fallback) |
| Web articles | URL → content extraction via Tavily |
| Podcasts | URL → RSS parsing → audio download → Whisper transcription |
| Audio files | Direct upload (mp3, m4a, wav, ogg, webm, mp4, flac, aac — max 200MB) |
| Documents | Direct upload (PDF, TXT, Markdown — max 50MB for PDF, 5MB for text) |

**Output Types (5):**

| Output | Description |
|--------|-------------|
| **Notes** | Full formatted transcript — no summarization, preserves all content with headings and timestamps |
| **Summary** | Hierarchical markdown notes capturing key information |
| **Flashcards** | Front/back study cards generated from content |
| **Quiz** | Multiple choice + short answer questions with explanations |
| **Concept Map** | Node/edge graph showing relationships between concepts |

Users select one or more outputs per transform. All generated via GPT-5.4 mini.

**Processing Pipeline:**
1. Frontend uploads audio/document to Firebase Storage (if file-based)
2. `POST /api/transform/start` sends URL/paths + desired outputs
3. Celery `transform_content` task runs on dedicated `transform` queue
4. Content extraction → AI generation for each output → save to Firestore
5. Real-time progress via Socket.IO (`transform_progress` events)
6. Frontend polls `/api/task_status/<task_id>` as WebSocket fallback

**Firestore Schema:**
```
users/{uid}/transforms/{docId}
├── source_url: string
├── source_type: 'youtube' | 'web' | 'podcast' | 'audio' | 'document'
├── title: string
├── notes: string (markdown)
├── summary: string (markdown)
├── flashcards: string (JSON array of {front, back})
├── quiz: string (JSON array of {question, type, options, answer, explanation})
├── concept_map: string (JSON of {nodes: [{id, label}], edges: [{source, target, label}]})
├── video_id: string (optional, YouTube)
├── task_id: string
├── uid: string
├── status: string
├── created_at: string (ISO 8601)
├── isPublic: boolean (optional)
└── publicDocumentId: string | null (optional)
```

**Public Sharing:**
- Artifacts can be published to `public_artifacts` collection (like notes sharing)
- Public URL pattern uses the `publicDocumentId`
- Share/unshare toggle in UI with copy-link

**Typography:** SpaceGrotesk (hero text), SpaceMono (labels), DM Serif Display (display text) — custom fonts bundled in native apps.

### 3.11 Share Extension

- **Location:** `/iOS_Share/` — iOS Share Extension target
- **Purpose:** Share content (URLs, text, documents) from other apps into Chunk collections

---

## 4. Platform Differences

| Feature | iOS/iPadOS | macOS | visionOS |
|---------|-----------|-------|----------|
| **Tabs** | Home, Workstation, Artifacts, Notes, Settings | Home, Workstation, Artifacts, Notes, Settings | Home, Workstation, Artifacts, Notes, Settings |
| **Workstation View** | `HistoryTabView` (tabbed dashboard) | `HistoryTabViewMac` (tabbed dashboard) | `HistoryTabViewMac` (tabbed dashboard) |
| **Share Extension** | ✅ | ❌ | ❌ |
| **ReefReferral** | ✅ | ❌ | ❌ |
| **Keyboard Shortcuts** | ✅ (`KeyboardShortcutsCoordinator`) | ❌ (native menu) | ✅ |
| **Table Views** | `TableViewiOS` | `TableViewMac` | Uses iOS variant |
| **Code Blocks** | `CodeBlockView` | `CodeBlockViewMac` | Uses iOS variant |
| **Blockquotes** | `BlockquoteView` | `BlockquoteViewMac` | Uses iOS variant |
| **Document Viewers** | QuickLookPreview | QuickLookPreviewMac | QuickLookPreview |
| **Subscription UI** | `CustomPayWall` / RevenueCatUI | `ManageSubscriptionMac` | RevenueCatUI |
| **Spatial Layout** | — | — | Spatial computing, ornaments |

---

## 5. AI Models & Routing

### Decision Agent Flow

```
User Message
    ↓
Decision Agent (GPT-5-nano, Responses API)
    ↓ Returns JSON:
    {
      search_mode: "ASSISTANT" | "WEB SEARCH" | "DOCUMENTS ONLY" | "ALL" | "YOUTUBE" | "RESEARCH",
      model: "recommended-model-name",
      generate_image: true/false,
      image_edit: true/false,
      reasoning_effort: "low" | "medium" | "high",
      ask_for_clarification: true/false,
      message: "clarification question if needed"
    }
    ↓
Route to appropriate service:
  - ChatService._handle_assistant_mode()
  - ChatService._handle_research_mode()
  - ChatService._handle_other_modes()
    ↓
ModelFactory.handle_apis() → OpenAI/Claude/Gemini service
    ↓
Streaming response back to client (SSE)
```

### Premium Model Enforcement

Server-side check via `ModelConfig.is_premium_model()` with prefix matching. Free users attempting premium models are downgraded to `gpt-5-mini`.

---

## 6. Backend API

### Chat & Responses
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/chat` | POST | ❌¹ | Main chat endpoint — routes through decision agent |
| `/api/task_status/<task_id>` | GET | ❌ | Poll async task status (research, images) |
| `/api/cancel_task/<task_id>` | POST | ✅ | Cancel a running Celery task |
| `/api/research_result/<task_id>` | GET | ❌ | Get research report (supports JSON + streaming) |
| `/api/research_result_extended/<task_id>` | GET | ❌ | Extended research result with full metadata |

¹ Uses UID from payload, not auth token (legacy)

### Research History
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/research/history` | GET | ✅ | List user's research reports (paginated) |
| `/api/research/history/<task_id>` | GET | ✅ | Get specific report with full content |
| `/api/research/history/<task_id>` | DELETE | ✅ | Delete report + storage files |
| `/api/research/<task_id>/export` | POST | ✅ | Export to PDF or Markdown |

### Content Processing
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/extract-url` | POST | ❌ | Extract URL content via Tavily (async Celery) |
| `/api/summarize` | POST | ❌ | AI summarization (Claude Haiku) |
| `/upload` | POST | ❌ | Upload document |
| `/construct_index` | POST | ❌ | Create vector embeddings (via blueprint) |

### Memory Management
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/memory/list` | GET | ✅ | List memories (paginated, optional stats) |
| `/api/memory/stats` | GET | ✅ | Memory statistics |
| `/api/memory/search` | GET | ✅ | Search memories by content |
| `/api/memory/update` | PUT | ✅ | Update a specific memory |
| `/api/memory/delete` | DELETE | ✅ | Delete a specific memory |
| `/api/memory/clear` | DELETE | ✅ | Clear all memories |
| `/api/memory/toggle` | POST | ✅ | Enable/disable memory (deprecated — client should use Firestore directly) |
| `/api/memory/status` | GET | ✅ | Check if memory is enabled |
| `/api/memory/migrate` | POST | ✅² | Process legacy memory through extraction pipeline |

² Uses custom auth verification (not `@require_auth` decorator)

### Transform / Artifacts
| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/transform/upload-audio` | POST | ✅ | Upload audio/video file to Firebase Storage |
| `/api/transform/upload-document` | POST | ✅ | Upload PDF/TXT/MD document |
| `/api/transform/start` | POST | ✅ | Start transform job (URL or uploaded file) |
| `/api/task_status/<task_id>` | GET | ❌ | Poll transform task status |

### Blueprints (registered in `create_app()`)
| Blueprint | Prefix | Description |
|-----------|--------|-------------|
| `index_blueprint` | `/` | `construct_index` — vector embedding creation |
| `vector_point_count_bp` | `/api` | Get vector point count |
| `delete_document_bp` | `/api` | Delete document + vectors |
| `text_extractor_blueprint` | `/` | Extract text from documents |
| `xlsx_converter_blueprint` | `/` | Convert XLSX files |
| `qdrant_note_query_bp` | `/api` | Query notes in Qdrant |
| `get_query_context_blueprint` | `/api` | Get query context |
| `get_assistant_response_blueprint` | `/api` | Get assistant response (legacy) |
| `realtime_blueprint` | `/` | Realtime API endpoints |
| `revenuecat_webhook_bp` | `/webhooks/revenuecat` | RevenueCat webhook handler + email campaign stats (`/email-stats`) |
| `push_bp` | `/api/push` | Push notification endpoints |
| `transform_bp` | `/api` | Transform/Artifacts — upload, start, status |

### System
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (Socket.IO, Redis, connections) |
| `/api/websocket_status` | GET | WebSocket monitoring (aggregate metrics only) |

---

## 7. Data Storage

### Firebase Auth
- Email/password + Sign in with Apple
- `AuthenticationManager.shared` singleton on client
- Server verifies tokens via `firebase_admin.auth.verify_id_token()`

### Firestore Schema
```
users/{uid}/
├── conversations/{conversationId}     # Chat conversations
├── collections/{collectionId}         # Collections with embedded URLs array
│   └── urls: [{id, url, title, extractedText, extractionStatus, ...}]
├── memories/{memoryId}                # AI memory items
│   └── {content, category, confidence, embedding, created_at, ...}
├── research_history/{taskId}          # Research reports
│   └── {query, content, report_type, sources, images, costs, ...}
├── notes/ (via FirestoreNoteService)  # Synced notes
├── transforms/{docId}                 # Artifact/transform results
│   └── {source_url, source_type, title, notes, summary, flashcards, quiz, concept_map, ...}
├── memory_journal/{docId}             # Layer 2 journal insights
│   └── {content, entry_type, tags, keywords, embedding, created_at, ...}
└── profile/                           # User settings, preferences

public_artifacts/{docId}               # Published artifacts (top-level collection)
```

### Firebase Storage
```
users/{uid}/
├── documents/         # Uploaded documents
├── generated_images/  # AI-generated images
├── research_exports/  # PDF/Markdown exports
└── (none — transform uploads use top-level path)

transform_uploads/{uid}/   # Uploaded audio/documents for Artifacts
```

### Qdrant Vector Database
- **Collection:** `chunk-collection` (alias for zero-downtime migrations)
- **Embedding Model:** `text-embedding-3-small` (1536 dimensions)
- **Payload Fields:** `uid`, `tags`, `document_id`, `chunk_text`, `metadata`
- **Filtering:** User-isolated (uid filter) + tag-based (AND/OR/NOT)
- **Score Threshold:** 0.4

### SwiftData (On-Device)
- `Note` model — local note storage with CloudKit sync
- `@Model` macro for automatic persistence

---

## 8. Third-Party Services

| Service | Purpose | Integration Point |
|---------|---------|-------------------|
| **Firebase** | Auth, Firestore, Storage, Functions, Remote Config | Both client (SDK) and server (`firebase-admin`) |
| **RevenueCat** | Subscription management, entitlements | Client SDK + server-side V2 API verification |
| **Mixpanel** | Analytics & event tracking | Client (`AnalyticsService.swift`) |
| **Socket.IO** | Real-time bidirectional communication | Client (`SocketViewModel`) ↔ Server (`Flask-SocketIO`) |
| **Qdrant Cloud** | Vector database for semantic search | Server (`qdrant-client`) |
| **Tavily** | Web search + URL content extraction | Server (`tavily` Python client) |
| **GPT-Researcher** | Deep research report generation | Server (Celery tasks) |
| **OpenAI** | GPT models, embeddings, image generation | Server (`openai` Python client) |
| **Anthropic** | Claude models | Server (`anthropic` Python client) |
| **Google Generative AI** | Gemini models, native image generation | Server (`google-genai` Python client) |
| **Redis** | Celery broker, WebSocket bridge | Server (`redis_setup.py`, `redis_websocket_bridge.py`) |
| **Celery** | Background task processing | Server (`tasks.py`, `celery_config.py`) |
| **ReefReferral** | Referral system | iOS only (client SDK) |
| **OneSignal** | Push notifications | Client (`OneSignalService.swift`) + Server (`push_notifications.py`) |
| **CloudKit** | Note sync across devices | Client (`CloudKitSyncManager.swift`) |
| **Heroku** | Backend hosting (5 process types: web, worker, pdf_worker, transform_worker, beat) | Production deployment |
| **Vercel** | Web app hosting (Next.js) | `www.chunkapp.com` deployment |
| **Resend** | Email marketing contact collection | Web app (`/api/contacts` on signup) |
| **TipTap** | Rich text editor (web) | Web app notes editor with extensions |
| **Google Cloud Storage** | Firebase Storage backend | Server (signed URLs) |
| **Supadata** | YouTube transcript extraction | Server (`services/transform/transform_service.py`) |
| **OpenAI Whisper** | Audio transcription (podcast/audio fallback) | Server (`services/transform/audio_service.py`) |

---

## 9. Navigation & UI Structure

### Tab Structure (5 tabs)

| Tab | Icon | View | Description |
|-----|------|------|-------------|
| **Home** | `magnifyingglass` | `ChatView` | AI chat/search interface |
| **Workstation** | `square.grid.2x2` | `HistoryTabView` / `HistoryTabViewMac` | Tabbed dashboard: Chats, Research, Artifacts, Images, Collections, Documents |
| **Artifacts** | `wand.and.stars` | `ArtifactsView` / `ArtifactsViewMac` | Transform content into learning materials |
| **Notes** | `square.and.pencil` | `NotesMainView` | Note-taking with rich text |
| **Settings** | `gear` | `SettingsView` | Preferences, subscription, memory, profile |

#### Workstation Tabbed Dashboard

The Workstation tab uses a **tabbed mini-workspace** design with 6 inner tabs (iOS) / 5 inner tabs (macOS, no Documents):

| Inner Tab | Icon | Accent Color |
|-----------|------|-------------|
| Chats | `bubble.left.and.bubble.right.fill` | `#9B7EBD` (purple) |
| Research | `doc.text.magnifyingglass` | `#C4A74E` (gold) |
| Artifacts | `sparkles` | `#E84D2B` (orange/red) |
| Images | `photo.fill` | `#7ABAE1` (blue) |
| Collections | `folder.fill` | `#34D399` (green) |
| Documents | `doc.text.fill` | `#5CA3A6` (teal) |

Shared components: `WorkspaceTabConfig.swift`, `WorkspaceTabBar.swift` (horizontal tab bar with sliding colored underline), `WorkspaceTabPanel.swift` (generic container), `WorkspaceItemCard.swift` (unified card replacing per-type cards).

### Key View Hierarchy

```
ChunkApp
└── MainTabView
    ├── ChatView
    │   ├── ChatHeaderView (model selector, search mode)
    │   ├── MessageView (individual messages)
    │   │   ├── TextResponseView (custom markdown renderer)
    │   │   ├── StreamingImageView
    │   │   ├── ChatImageCarousel
    │   │   └── SourcesSheet / TavilySourceCard
    │   ├── MessageInputView
    │   ├── ResearchProgressView
    │   ├── ChatModelModalView (model picker)
    │   └── ChatSidePanelView (macOS — related docs, summaries)
    ├── HistoryTabView ("Workstation")
    │   ├── WorkspaceTabBar (Chats | Research | Artifacts | Images | Collections | Documents)
    │   ├── WorkspaceTabPanel (generic container per tab)
    │   ├── WorkspaceItemCard (unified card component)
    │   ├── CollectionsListView → CollectionDetailView → CollectionChatPanel
    │   ├── ConversationsListView
    │   ├── ImagesListView
    │   ├── ResearchHistoryView
    │   ├── RecentArtifactsNativeSection
    │   └── DocumentsView (embedded, isEmbedded: true)
    ├── ArtifactsView / ArtifactsViewMac
    │   ├── ArtifactInputView (source input + output type selection)
    │   ├── ArtifactProgressView (progress ring + stage dots + elapsed timer)
    │   ├── ArtifactResultView (scrollable results with tab pills)
    │   ├── ArtifactDetailView (full artifact detail)
    │   └── ArtifactHistoryListView (history, embedded in Workstation)
    ├── NotesMainView
    │   ├── NoteView (WYSIWYG editor)
    │   ├── WritingToolsPopoverView
    │   └── AssistantView
    └── SettingsView
        ├── EditProfileView
        ├── PreferencesView
        ├── MemoryManagementView (simplified: on/off toggle, profile summary, contradictions, facts, journal)
        ├── NotificationSettingsView
        └── CustomPayWall / ManageSubscriptionMac
```

### Design Patterns

- **Custom Markdown Renderer:** Full custom streaming markdown parser with platform-specific views for code blocks, tables, blockquotes, maps
- **Dynamic Charts:** `DynamicChartView` renders charts from markdown with `MarkdownChartParser`
- **Maps:** `MarkdownMap` renders location data from markdown responses
- **Debouncing:** Performance optimization throughout (text input, search, Firestore writes)
- **TipKit:** `AppTips.swift` for contextual onboarding tips
- **Onboarding:** `ChunkOnboardingView` with scrolling feature showcase + `AuthenticationView`
- **Modal Management:** `ModalPresentationManager` for centralized sheet/alert coordination
- **Coordinator:** `ViewModelCoordinator` for cross-ViewModel communication

---

## 10. Subscription Tiers

| Feature | Free | Pro (Subscriber) |
|---------|------|-------------------|
| **AI Models** | GPT-5-mini, GPT-5-nano | All models (GPT-5.2, Claude 4.5/Opus 4, Gemini 3) |
| **Daily Searches** | 6 | 200 |
| **Daily Image Generations** | 3 | 20 |
| **Deep Research** | Limited | Full access |
| **Document Upload** | ✅ | ✅ |
| **Notes** | ✅ | ✅ |
| **Collections** | ✅ | ✅ |
| **AI Memory** | ✅ | ✅ |
| **Vector Search** | ✅ | ✅ |
| **Artifacts** | ❌ | ✅ Full access |

**Subscription Management:**
- RevenueCat handles billing across App Store (iOS/macOS) and Stripe (web)
- Entitlement: `Subscribed-User`
- Server-side verification via RevenueCat V2 API with 5-minute cache
- RevenueCat webhooks at `/webhooks/revenuecat` for real-time status updates
- Free users attempting premium models are silently downgraded

---

## 11. Key Files Quick Reference

### Chat System
| File | Purpose |
|------|---------|
| `Chunk/ViewModels/ChatViewModel.swift` | Main chat orchestration, message management |
| `Chunk/ViewModels/ChatViewModelExtensions.swift` | Chat VM extensions |
| `Chunk/ViewModels/ChatStreamDelegate.swift` | SSE streaming response handling |
| `Chunk/Services/ChatAPIService.swift` | Backend API communication |
| `Chunk/Views/ChatTab/ChatView.swift` | Main chat UI |
| `Chunk/Views/ChatTab/MessageView.swift` | Individual message rendering |
| `Chunk/Views/ChatTab/MessageInputView.swift` | Text input with attachments |
| `cerebral/services/chat/chat_service.py` | Backend request processing & routing |
| `cerebral/services/agents/decision_agent.py` | AI decision agent (GPT-5-nano) |
| `cerebral/services/ai_models/model_factory.py` | Multi-model routing factory |
| `cerebral/services/ai_models/openai_service.py` | OpenAI integration |
| `cerebral/services/ai_models/claude_service.py` | Anthropic Claude integration |
| `cerebral/services/ai_models/gemini_service.py` | Google Gemini integration |

### Search
| File | Purpose |
|------|---------|
| `Chunk/Services/VectorSearchService.swift` | Client-side vector search |
| `cerebral/services/search/vector_search_service.py` | Qdrant vector search |
| `cerebral/services/search/web_search_service.py` | Tavily web search |
| `cerebral/services/search/context_service.py` | Context building & augmentation |

### Collections
| File | Purpose |
|------|---------|
| `Chunk/Views/HistoryTab/CollectionDetailView.swift` | Collection detail UI |
| `Chunk/Views/HistoryTab/CollectionChatPanel.swift` | Collection chat interface |
| `Chunk/Views/HistoryTab/CollectionsViewModel.swift` | Collection management |
| `Chunk/Models/CollectionModels.swift` | Data models |
| `Chunk/Services/CollectionDocumentService.swift` | Collection document operations |

### Notes
| File | Purpose |
|------|---------|
| `Chunk/Views/NotesTab/Note.swift` | SwiftData `@Model` |
| `Chunk/Views/NotesTab/NotesMainView.swift` | Notes list |
| `Chunk/ViewModels/NoteViewModel.swift` | Note operations |
| `Chunk/Services/NoteService.swift` | Note CRUD |
| `Chunk/Services/FirestoreNoteService.swift` | Firestore note sync |
| `Chunk/Services/NoteHistoryService.swift` | Version history |
| `Chunk/Services/CloudKitSyncManager.swift` | CloudKit sync |

### Documents
| File | Purpose |
|------|---------|
| `Chunk/Views/DocumentsTab/DocumentsView.swift` | Document management UI |
| `Chunk/Services/DocumentProcessingService.swift` | Upload & text extraction |
| `Chunk/ViewModels/DocumentViewModel.swift` | Document operations |
| `Chunk/Models/Document.swift` | Document model |
| `cerebral/text_extractor.py` | Server-side text extraction |
| `cerebral/index_constructor.py` | Vector embedding creation |

### Image Generation
| File | Purpose |
|------|---------|
| `Chunk/Services/ImageGenerationService.swift` | Client-side image gen |
| `Chunk/ViewModels/ImagesViewModelV2.swift` | Image gallery management |
| `cerebral/services/image/responses_image_service.py` | OpenAI Responses API images |
| `cerebral/services/image/gemini_image_service.py` | Gemini native images |
| `cerebral/services/image/image_generation_service.py` | Image gen orchestration |

### Artifacts / Transform
| File | Purpose |
|------|---------|
| `Chunk/Models/ArtifactModels.swift` | Data models |
| `Chunk/ViewModels/ArtifactViewModel.swift` | Transform orchestration |
| `Chunk/Services/ArtifactService.swift` | Backend API communication |
| `Chunk/Views/ArtifactsTab/ArtifactsView.swift` | iOS artifacts tab |
| `Chunk/Views/ArtifactsTab/ArtifactsViewMac.swift` | macOS artifacts tab (HStack sidebar + detail) |
| `Chunk/Views/ArtifactsTab/ArtifactInputView.swift` | Source input + output selection |
| `Chunk/Views/ArtifactsTab/ArtifactProgressView.swift` | Progress ring + stage dots |
| `Chunk/Views/ArtifactsTab/ArtifactResultView.swift` | Scrollable results with tab pills |
| `Chunk/Views/ArtifactsTab/ArtifactDetailView.swift` | Full artifact detail |
| `Chunk/Views/ArtifactsTab/ArtifactHistoryListView.swift` | History list (embedded in Workstation) |
| `Chunk/Views/ArtifactsTab/Components/ArtifactSourceBadge.swift` | Source type badge |
| `Chunk/Views/ArtifactsTab/Components/ArtifactTabPills.swift` | Output type tab pills |
| `Chunk/Views/HistoryTab/RecentArtifactsNativeSection.swift` | Recent artifacts in Workstation |
| `cerebral/transform_api.py` | Flask blueprint — upload, start, status |
| `cerebral/services/transform/transform_service.py` | URL detection, content extraction, AI generation |
| `cerebral/services/transform/audio_service.py` | Podcast RSS, audio download, Whisper transcription |
| `cerebral/services/transform/prompts.py` | System/user prompts for each output type |

### AI Memory (Memory 2.0)
| File | Purpose |
|------|---------|
| `Chunk/Services/MemoryService.swift` | Client-side memory management (both layers) |
| `Chunk/Services/MemoryFilteringService.swift` | On-device privacy filtering (threshold 0.5) |
| `Chunk/Services/MemorySimilarityService.swift` | Embedding-based dedup |
| `Chunk/Models/MemoryModels.swift` | JournalEntryType, MemoryJournalEntry, MemoryContradiction |
| `Chunk/Views/SettingsTab/MemoryManagementView.swift` | Memory settings UI (on/off, profile, contradictions, facts, journal) |
| `cerebral/services/memory/memory_manager.py` | Orchestration, tiered context injection (`get_combined_context`) |
| `cerebral/services/memory/memory_service.py` | Layer 1 CRUD operations |
| `cerebral/services/memory/journal_service.py` | Layer 2 journal extraction, storage, retrieval |
| `cerebral/services/memory/retrieval_orchestrator.py` | Multi-tier retrieval (Simple/Complex query routing) |
| `cerebral/services/memory/memory_lifecycle.py` | Weekly lifecycle: consolidation, contradictions, expiry, profile regen |
| `cerebral/services/memory/memory_consolidator.py` | Embedding-based deduplication & merging |
| `cerebral/services/memory/encryption_service.py` | Per-user encryption |
| `cerebral/services/memory/embedding_utils.py` | Embedding generation utilities |
| `cerebral/services/memory/memory_models.py` | Data models, categories, sensitivity tiers, retention config |
| `cerebral/services/memory/firestore_rest_adapter.py` | Eventlet-safe Firestore REST adapter |
| `cerebral/services/memory/firestore_rest_client.py` | REST client for Firestore operations |
| `cerebral/services/memory/hybrid_validator.py` | Validation utilities |
| `cerebral/services/memory/localization.py` | Localization support |

### Research
| File | Purpose |
|------|---------|
| `Chunk/Models/ResearchModels.swift` | Research data models |
| `Chunk/Services/ResearchHistoryService.swift` | Research history management |
| `Chunk/Views/ChatTab/ResearchProgressView.swift` | Progress UI |
| `Chunk/Views/HistoryTab/ResearchHistoryView.swift` | Research history list |
| `cerebral/tasks.py` | Celery tasks (research, URL extraction, memory, transforms) |
| `cerebral/services/research/pdf_export_service.py` | PDF/Markdown export + storage |

### Markdown & Rendering
| File | Purpose |
|------|---------|
| `Chunk/Custom Markdown Parser/CustomMarkdownParser.swift` | Core markdown parser |
| `Chunk/Custom Markdown Parser/StreamingMarkdownParser.swift` | Streaming-aware parser |
| `Chunk/Custom Markdown Parser/VirtualizedMarkdownRenderer.swift` | Performance renderer |
| `Chunk/Charts/DynamicChartView.swift` | Chart rendering from markdown |
| `Chunk/Views/ChatTab/ResponseViews/MarkdownMap.swift` | Map rendering |

### Backend Core
| File | Purpose |
|------|---------|
| `cerebral/main.py` | Flask app, routes, WebSocket handlers |
| `cerebral/core/container.py` | Dependency injection container |
| `cerebral/core/session_context.py` | Per-request SID context |
| `cerebral/core/callback_handler.py` | WebSocket callback abstraction |
| `cerebral/config_new/settings.py` | Centralized configuration |
| `cerebral/prompts.py` | System prompts for AI agent & LLM |
| `cerebral/extensions.py` | Flask extensions (SocketIO instance) |
| `cerebral/firebase_setup.py` | Firebase Admin SDK initialization |
| `cerebral/services/subscription/subscription_service.py` | RevenueCat verification |
| `cerebral/services/subscription/rate_limiter.py` | Usage rate limiting |
| `cerebral/webhooks_revenuecat.py` | RevenueCat webhook handler |

### Authentication & Networking
| File | Purpose |
|------|---------|
| `Chunk/Views/OnboardingViews/AuthenticationManager.swift` | Auth singleton (Firebase + Apple) |
| `Chunk/Networking/StorageManager.swift` | Firebase Storage operations |
| `Chunk/Networking/RemoteConfigManager.swift` | Firebase Remote Config |
| `Chunk/ViewModels/SocketViewModel.swift` | Socket.IO client management |

### Workstation Dashboard
| File | Purpose |
|------|---------|
| `Chunk/Views/HistoryTab/WorkspaceTabConfig.swift` | Tab enum, colors, icons, labels (single source of truth) |
| `Chunk/Views/HistoryTab/WorkspaceTabBar.swift` | Horizontal tab bar with sliding colored underline |
| `Chunk/Views/HistoryTab/WorkspaceTabPanel.swift` | Generic container per tab |
| `Chunk/Views/HistoryTab/WorkspaceItemCard.swift` | Unified card replacing per-type cards |
| `Chunk/Views/HistoryTab/WorkstationSharedComponents.swift` | SectionHeader + EmptyStateView |

### App Management
| File | Purpose |
|------|---------|
| `Chunk/ChunkApp.swift` | App entry point (all platforms) |
| `Chunk/Views/MainTabView.swift` | Tab navigation |
| `Chunk/Managers/AppStateManager.swift` | App lifecycle |
| `Chunk/Managers/ModalPresentationManager.swift` | Sheet/alert coordination |
| `Chunk/Managers/ViewModelCoordinator.swift` | Cross-VM communication |
| `Chunk/Managers/WidgetDataSyncer.swift` | Widget data sync |
| `Chunk/Services/AnalyticsService.swift` | Mixpanel analytics |
| `Chunk/Services/UsageTrackingService.swift` | Usage tracking |
| `Chunk/Services/TokenEstimationService.swift` | Token counting |

---

## 12. Web App (www.chunkapp.com)

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 16 (App Router), React 19, TypeScript (strict) |
| **Styling** | Tailwind CSS v4 + shadcn/ui (New York style) + Framer Motion |
| **State** | Zustand with persist middleware (14 stores) |
| **Auth** | Firebase Auth (Apple Sign-In + Email/Password) |
| **Database** | Direct Firestore access (memory, history) + Backend API (chat) |
| **Real-time** | Socket.IO client for async callbacks (image gen, research progress) |
| **Rich Text** | TipTap editor with extensions (code blocks, tables, task lists, images, links) |
| **Markdown** | `react-markdown` + `remark-gfm` + `prism-react-renderer` |
| **Subscriptions** | RevenueCat Purchases JS SDK (`@revenuecat/purchases-js`) |
| **Analytics** | Mixpanel (`mixpanel-browser`) |
| **Email Collection** | Resend API (contact collection on signup) |
| **Theming** | `next-themes` (Dark / Light / System) |
| **Notifications** | Sonner toast library |

### Route Structure

```
src/app/
├── page.tsx                    # Landing/marketing page (unauthenticated root)
├── (auth)/                     # Auth routes (no sidebar)
│   ├── login/page.tsx          # Email/password + Apple Sign-In
│   └── signup/page.tsx         # Account creation
├── (app)/                      # Main app (sidebar + AuthGuard)
│   ├── chat/page.tsx           # AI chat interface
│   ├── history/page.tsx        # Workstation (tabbed dashboard)
│   ├── notes/page.tsx          # TipTap rich text notes
│   ├── artifacts/page.tsx      # Artifacts with sidebar (two-pane on desktop)
│   ├── transform/page.tsx      # Transform flow (input → progress → results)
│   ├── documents/page.tsx      # Document management
│   └── settings/page.tsx       # Settings, memory management, subscription
├── artifacts-feature/          # Artifacts marketing page
└── (marketing)/                # Static pages (forced light theme)
    ├── privacy/page.tsx        # Privacy policy
    └── tos/page.tsx            # Terms of service
```

### Marketing / Landing Page

The root `page.tsx` renders a full marketing site for unauthenticated visitors:

- **Navbar** — navigation + CTA
- **Hero** — headline with call-to-action
- **AI Models** — model showcase (GPT-5.2, Claude, Gemini)
- **Research Feature** — deep research highlight
- **Image Generation Feature** — AI image generation showcase
- **Features Grid** — overview of all capabilities
- **Testimonials** — social proof
- **Memory Feature** — AI memory highlight
- **Collections Feature** — collections showcase
- **Notes Feature** — notes editor highlight
- **Pricing Section** — plan comparison (Monthly $9.99 / Yearly $69.99)
- **Privacy & Trust** — data privacy assurances
- **CTA Section** — final call-to-action
- **Footer** — links, legal

### Auth Flow

1. User visits `www.chunkapp.com` → sees marketing landing page
2. Clicks sign-up → `/signup` route with Apple Sign-In or Email/Password
3. On signup, contact is silently added to Resend for email marketing
4. `AuthGuard` component wraps all `(app)/` routes — redirects unauthenticated users to login
5. Firebase Auth state managed via `authStore` (Zustand with persistence)
6. Auth tokens sent as `Authorization: Bearer <token>` to backend API

### Data Access Patterns

| Feature | Access Method |
|---------|---------------|
| Chat streaming | Backend API (`POST /api/chat` via EventSource SSE) |
| Memory CRUD | Direct Firestore (`users/{uid}/memories/`) — bypasses backend for speed |
| Memory status | Direct Firestore (`users/{uid}`) |
| Conversations | Direct Firestore (`users/{uid}/conversations/`) |
| Document upload | Backend API (`POST /upload`) |
| Vector indexing | Backend API (`POST /construct_index`) |
| Image generation | Backend API + Socket.IO callbacks |
| Research | Backend API + Socket.IO progress + Firestore history |
| Collections | Direct Firestore + Backend API for URL extraction |
| Notes | Direct Firestore with TipTap editor |
| Artifacts | Backend API (`POST /api/transform/start`) + Socket.IO progress + Direct Firestore history |
| Subscription | RevenueCat JS SDK (Stripe-backed for web) |

### Zustand Stores

| Store | Purpose | Persistence |
|-------|---------|-------------|
| `authStore` | Auth state, subscription info, profile | ✅ Persisted |
| `chatStore` | Messages, model selection, streaming state | ❌ In-memory |
| `historyStore` | Conversations loaded from Firestore | ❌ On-demand |
| `documentStore` | Document list and metadata | ❌ On-demand |
| `notesStore` | Notes list and state | ❌ On-demand |
| `memoryStore` | AI memories | ❌ On-demand |
| `collectionsStore` | Collections | ❌ On-demand |
| `imagesStore` | Generated images | ❌ On-demand |
| `researchHistoryStore` | Research reports | ❌ On-demand |
| `subscriptionStore` | Subscription details | ✅ Persisted |
| `usageStore` | Usage tracking (daily limits) | ❌ In-memory |
| `guestStore` | Guest mode state | ❌ In-memory |
| `artifactsStore` | Past artifacts, detail loading, public sharing | ❌ On-demand |
| `transformStore` | Active transform flow, progress, results | ❌ In-memory |

### Web Sidebar Navigation

```
Home         → /chat
Workstation  → /history
Notes        → /notes
Artifacts    → /artifacts
Documents    → /documents
Settings     → /settings
```

### Web Artifact Files

| File | Purpose |
|------|---------|
| `src/app/(app)/artifacts/page.tsx` | Artifacts page with two-pane sidebar (desktop) |
| `src/app/(app)/transform/page.tsx` | Transform flow page |
| `src/stores/artifactsStore.ts` | Artifacts state (Zustand) |
| `src/stores/transformStore.ts` | Transform flow state (Zustand) |
| `src/types/transform.ts` | TypeScript types for all artifact data |
| `src/lib/api/artifacts.ts` | Public sharing API (publish/unpublish to `public_artifacts`) |
| `src/components/history/ArtifactsTab.tsx` | Artifacts tab in Workstation |
| `src/components/history/ArtifactDetailViewer.tsx` | Detail viewer |
| `src/components/history/ArtifactShareDialog.tsx` | Share dialog |
| `src/components/history/ArtifactRow.tsx` | Artifact list row |
| `src/components/transform/` | Transform flow components |
| `src/components/marketing/artifacts-page/` | Marketing page components |

### Web vs Native Feature Differences

| Capability | Web | Native (iOS/macOS) |
|-----------|-----|---------------------|
| **Notes Editor** | TipTap (rich text + markdown source toggle) | Native text views (WYSIWYG) |
| **Notes Sync** | Firestore only | SwiftData + Firestore + CloudKit |
| **Subscription Billing** | Stripe (via RevenueCat JS) | App Store (via RevenueCat) |
| **Share Extension** | ❌ | ✅ (iOS only) |
| **ReefReferral** | ❌ | ✅ (iOS only) |
| **Push Notifications** | ❌ | ✅ (OneSignal) |
| **Keyboard Shortcuts** | Standard browser shortcuts | Custom `KeyboardShortcutsCoordinator` |
| **Document Viewers** | Browser-based | QuickLook / native viewers |
| **Spatial Computing** | ❌ | ✅ (visionOS ornaments) |
| **Offline Support** | ❌ | SwiftData local storage |
| **Guest Mode** | ✅ (limited access without signup) | ❌ |
| **Image Limits** | 5 free / 20 Pro daily | 3 free / 20 Pro daily |
| **Search Limits** | 300 Pro daily | 200 Pro daily |

### Design System

```
Primary:          #E84D2B (orange/red accent)
Background Light: #EAEAEA
Background Dark:  #161616
ContrastUI:       #D9D9D9 (light) / #2A2A2A (dark)
Blue Accent:      #7ABAE1
```

### Deployment

- **Hosting:** Vercel (Next.js)
- **Domain:** `www.chunkapp.com`
- **Backend:** Same Heroku `cerebral` backend as native apps
- **Environment Variables:** `NEXT_PUBLIC_API_BASE_URL` (Heroku), Firebase config, RevenueCat public key, Mixpanel token

---

## 13. Analytics Dashboard (chunk-analytics)

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 16 (App Router), React 19, TypeScript |
| **Styling** | Tailwind CSS v4 |
| **Charting** | Recharts 3.7 |
| **Date Handling** | date-fns |
| **Data Source** | Mixpanel Export API (primary) + Cerebral backend API (email stats) |
| **Caching** | Next.js `unstable_cache` + `Cache-Control` headers (5-minute revalidation) |

### Architecture

Internal admin dashboard — no authentication layer (intended for developer use only). All data flows through Next.js API routes that proxy to Mixpanel or the Cerebral backend.

**Data Pipeline:**
```
Mixpanel Export API ──→ Next.js API Routes ──→ React Pages (Recharts)
                          ↕ (5-min cache)
Cerebral Backend ────→ /api/metrics/emails
```

### Dashboard Pages

| Page | Route | Metrics Tracked |
|------|-------|-----------------|
| **Overview** | `/` | Total users, sessions, searches, conversion rate, DAU/sessions/searches over time, user breakdown (visitors/authenticated/subscribers) |
| **Insights** | `/insights` | DAU/MAU ratio, avg session duration, searches per user, retention (Day 1/7/30), user breakdown (paid/free/guest), traffic sources, UTM sources, feature adoption rates |
| **Users** | `/users` | DAU, WAU, MAU, session duration distribution, sessions per user, geographic distribution |
| **Searches** | `/searches` | Search volume over time, search mode distribution, model usage, context usage, hourly search patterns |
| **Subscriptions** | `/subscriptions` | Paywall views → purchase funnel, revenue by plan, trial conversion rate, failed purchases, paywall source attribution |
| **Push Notifications** | `/push` | Permission request/grant/deny rates, notification opens, opt-in rate, daily push data, destinations, sources, hourly distribution |
| **Email Campaigns** | `/emails` | Emails sent by campaign type, conversion rates, attribution (30-day window), avg days to convert. Campaign types: 7-Day Win-back, 30-Day Win-back, Trial Ending, Billing Issue, Subscription Expired |
| **Features** | `/features` | Feature usage counts, feature usage over time, usage by user segment |
| **Research** | `/research` | Reports initiated/completed/viewed, completion rate, exports, shares, report type distribution, research funnel, tone/citation preferences, avg source/word count |
| **Notes** | `/notes` | Notes created/viewed/saved/deleted, published, shared, document uploads, writing tool usage, save trigger distribution, feature adoption, retention rate |
| **Onboarding** | `/onboarding` | Onboarding funnel steps, drop-off analysis |

### Global Filters

Every dashboard page supports:
- **Date Range:** 1d, 7d, 30d, 90d, 365d, custom range
- **Platform:** All, iOS, iPadOS, macOS, visionOS, Web
- **User Type:** All, Authenticated, Subscribers, Visitors

Platform detection uses Mixpanel event properties (`$os`, `platform`, `mp_lib`).

### User Categorization Logic

Users are categorized from Mixpanel events (no separate user database):
- **Subscriber:** Has `Purchase_Completed`, `Subscription_Started`, or `subscription_status: active` events
- **Authenticated:** Has `Signup_Completed`, `Login_Completed`, or `$user_id` property (includes subscribers)
- **Visitor:** All other users (anonymous)

### API Routes

| Route | Data Source | Description |
|-------|------------|-------------|
| `/api/events` | Mixpanel Export API | Raw event fetching |
| `/api/metrics/overview` | Mixpanel | Overview stats with trend comparison |
| `/api/metrics/users` | Mixpanel | DAU/WAU/MAU, sessions, geographic |
| `/api/metrics/searches` | Mixpanel | Search analytics |
| `/api/metrics/funnel` | Mixpanel | Subscription funnel metrics |
| `/api/metrics/push` | Mixpanel | Push notification metrics |
| `/api/metrics/emails` | Cerebral Backend | Email campaign stats from `/webhooks/revenuecat/email-stats` |
| `/api/metrics/features` | Mixpanel | Feature usage metrics |
| `/api/metrics/research` | Mixpanel | Research report metrics |
| `/api/metrics/notes` | Mixpanel | Notes feature metrics |
| `/api/metrics/onboarding` | Mixpanel | Onboarding funnel metrics |
| `/api/metrics/advanced` | Mixpanel | Insights (retention, DAU/MAU, adoption) |

### Chart Components

| Component | Type | Library |
|-----------|------|---------|
| `LineChart` | Multi-series line | Recharts |
| `AreaChart` | Filled area | Recharts |
| `BarChart` | Horizontal/vertical bars | Recharts |
| `PieChart` | Donut/pie | Recharts |
| `FunnelChart` | Conversion funnel | Recharts |
| `HeatmapChart` | Grid heatmap | Recharts |
| `DataTable` | Sortable table | Custom |

### Key Environment Variables

| Variable | Purpose |
|----------|---------|
| `MIXPANEL_API_SECRET` | Mixpanel Export API authentication |
| `CEREBRAL_API_URL` | Cerebral backend URL for email stats |
| `CEREBRAL_AUTH_TOKEN` | Auth token for Cerebral email stats endpoint |

---

## 14. Cross-Platform Feature Matrix

| Feature | iOS/iPadOS | macOS | visionOS | Web |
|---------|-----------|-------|----------|-----|
| **AI Chat (multi-model)** | ✅ | ✅ | ✅ | ✅ |
| **Web Search** | ✅ | ✅ | ✅ | ✅ |
| **Vector/Document Search** | ✅ | ✅ | ✅ | ✅ |
| **Deep Research** | ✅ | ✅ | ✅ | ✅ |
| **Image Generation** | ✅ | ✅ | ✅ | ✅ |
| **Artifacts (Transform)** | ✅ | ✅ | ✅ | ✅ |
| **Documents (upload & view)** | ✅ | ✅ | ✅ | ✅ |
| **Notes (rich text)** | ✅ (native) | ✅ (native) | ✅ (native) | ✅ (TipTap) |
| **Notes Folders** | ✅ | ✅ | ✅ | ✅ |
| **Wiki Links & Backlinks** | ✅ | ✅ | ✅ | ✅ |
| **Knowledge Graph View** | ✅ | ✅ | ✅ | ✅ |
| **AI Related Notes** | ✅ | ✅ | ✅ | ✅ |
| **Backlink-Aware AI Chat** | ✅ | ✅ | ✅ | ✅ |
| **MOC Generation** | ✅ | ✅ | ✅ | ✅ |
| **KG Search** | ✅ | ✅ | ✅ | ✅ |
| **Orphan Detection** | ✅ | ✅ | ✅ | ✅ |
| **Spaced Repetition** | ✅ | ✅ | ✅ | ✅ |
| **Notes Publish/Share** | ✅ | ✅ | ✅ | ✅ |
| **Collections** | ✅ | ✅ | ✅ | ✅ |
| **AI Memory (Layer 1 + 2)** | ✅ | ✅ | ✅ | ✅ |
| **Memory Profile Summary** | ✅ | ✅ | ✅ | ✅ |
| **Memory Contradiction Detection** | ✅ | ✅ | ✅ | ✅ |
| **Conversation History** | ✅ | ✅ | ✅ | ✅ |
| **Subscription (Pro)** | ✅ (App Store) | ✅ (App Store) | ✅ (App Store) | ✅ (Stripe) |
| **Share Extension** | ✅ | ❌ | ❌ | ❌ |
| **Push Notifications** | ✅ | ✅ | ❌ | ❌ |
| **Referral System** | ✅ | ❌ | ❌ | ❌ |
| **CloudKit Sync** | ✅ | ✅ | ✅ | ❌ |
| **Offline / Local Storage** | ✅ (SwiftData) | ✅ (SwiftData) | ✅ (SwiftData) | ❌ |
| **Guest Mode** | ❌ | ❌ | ❌ | ✅ |
| **Spatial Computing** | ❌ | ❌ | ✅ | ❌ |
| **Keyboard Shortcuts** | ✅ (custom) | ✅ (native menu) | ✅ (custom) | ✅ (browser) |
| **Writing Tools (AI)** | ✅ | ✅ | ✅ | ✅ |
| **Mixpanel Analytics** | ✅ | ✅ | ✅ | ✅ |
