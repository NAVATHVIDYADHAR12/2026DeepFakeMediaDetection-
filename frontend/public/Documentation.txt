================================================================================

                            O M N I G U A R D   A I
                          SEE BEYOND THE REAL

                        TECHNICAL DOCUMENTATION
                    Deepfake & AI-Generated Media Detection

================================================================================

  3 trained CNNs  |  190k training images  |  235 automated tests
  ~200 ms per image on CPU  |  0 cloud calls

A deepfake and AI-generated media detection platform that runs entirely on a
local machine, explains every verdict it produces, and states plainly what it
cannot do.


--------------------------------------------------------------------------------
CONTENTS
--------------------------------------------------------------------------------

   1.  The problem
   2.  What the system does
   3.  System architecture
   4.  Detection pipeline
   5.  Video analysis
   6.  Model training
   7.  Explainability
   8.  Forensic signals
   9.  Face recognition
  10.  Text analysis: plagiarism & AI content
  11.  Standalone browser engine
  12.  Technology choices
  13.  Engineering decisions
  14.  Data model
  15.  API reference
  16.  Security
  17.  Testing
  18.  Project structure
  19.  Limitations
  20.  Running it
  21.  Future work


================================================================================
1.  THE PROBLEM
================================================================================

Synthetic media has crossed the threshold where a convincing forgery no longer
requires skill, budget, or time. A face can be swapped into a video with
consumer software; a person who never existed can be generated in seconds. The
consequences are already concrete: non-consensual imagery, fraud that
impersonates executives on video calls, political disinformation, and evidence
that cannot be trusted.

The defensive problem is harder than the offensive one. A forger needs one
convincing output. A detector needs to be right consistently, across generators
it has never seen, on media that has been re-compressed and resized on its way
through social platforms.

  THE DESIGN POSITION TAKEN HERE
  ------------------------------
  A detector that outputs a bare real/fake label is not useful in a decision
  that matters. OmniGuard is built around three commitments:

    * It SHOWS ITS EVIDENCE      - a heatmap of the pixels that drove the score
    * It ADMITS UNCERTAINTY      - a middle "suspicious" band, not a forced binary
    * It STATES ITS LIMITS       - in the product itself, not in a footnote


================================================================================
2.  WHAT THE SYSTEM DOES
================================================================================

  CAPABILITY                 STATUS          IMPLEMENTATION
  ---------------------------------------------------------------------------
  Image deepfake detection   WORKING         Ensemble of 3 fine-tuned CNNs,
                                             scored per detected face
  Video deepfake detection   WORKING         Frame sampling, per-person
                                             tracking, temporal variance
  Face detection             WORKING         OpenCV YuNet, CPU, 5 landmarks
  Face recognition           WORKING         OpenCV SFace, 128-d embeddings,
                                             enrollable gallery
  Explainability heatmap     WORKING         Class Activation Map, forward-only
  Metadata forensics         WORKING         EXIF camera/software/GPS/stripping
  Error Level Analysis       WORKING         JPEG recompression residual
  C2PA provenance            PRESENCE ONLY   Detects manifest; does NOT verify
                                             its signature
  Local accounts             WORKING         scrypt hashing, HttpOnly cookies
  In-app assistant           WORKING         Curated knowledge base + live data
  Plagiarism detection       WORKING         Exact 5-gram overlap vs a
                                             supplied reference, with the
                                             matching passages marked
  AI-generated text          INDICATORS      Six stylistic statistics with
                                             per-passage marking. Suggestive,
                                             not conclusive - see section 10
  Standalone browser mode    WORKING         Runs EXIF, ELA, C2PA and history
                                             with no backend at all
  Audio / voice cloning      NOT BUILT       Needs separate model and dataset
  Document forensics         NOT BUILT       Out of scope for this prototype

Unbuilt modules appear in the interface as clearly marked placeholders that
explain what building them would involve. Nothing in the product displays
invented numbers.


================================================================================
3.  SYSTEM ARCHITECTURE
================================================================================

The system splits along a deliberate seam: TRAINING HAPPENS ONCE, ON BORROWED
GPU HARDWARE; INFERENCE HAPPENS LOCALLY, FOREVER, ON A CPU. These two
environments have genuinely different requirements, so they use different
runtimes.


  +==========================================================================+
  |  PHASE 1 - TRAINING  (once, Google Colab free T4 GPU, ~50 minutes)       |
  +==========================================================================+
  |                                                                          |
  |  +----------------+   +----------------+   +----------------+            |
  |  | FaceForensics++|   | Augmentation   |   | Fine-tune      |            |
  |  | ~190,000 crops |-->| JPEG recompress|-->| 3 CNNs         |--+         |
  |  | 4 forgery types|   | blur/crop/flip |   | EfficientNet-B0|  |         |
  |  | via HuggingFace|   | colour jitter  |   | XceptionNet    |  |         |
  |  +----------------+   +----------------+   | MobileNetV3    |  |         |
  |                                            +----------------+  |         |
  |                                                                v         |
  |                                          +---------------------------+   |
  |                                          | Evaluate + export         |   |
  |                                          | held-out test split       |   |
  |                                          | ROC-AUC, F1, confusion    |   |
  |                                          | --> ONNX (2 outputs)      |   |
  |                                          +---------------------------+   |
  +==========================================================================+
                                    |
                                    |  omniguard_models.zip
                                    v
  +==========================================================================+
  |  PHASE 2 - INFERENCE  (local machine, CPU only, no network)              |
  +==========================================================================+
  |                                                                          |
  |  +---------------------+        +---------------------+                  |
  |  | BROWSER - React SPA |  HTTP  | FastAPI - main.py   |                  |
  |  | Landing  Dashboard  |<------>| /api/scan  /api/auth|                  |
  |  | Scanner  Report     |        | /api/identity       |                  |
  |  | History  Face ID    |        | /api/assistant      |                  |
  |  | Vite Tailwind Sass  |        | upload validation   |                  |
  |  | GSAP                |        | session cookies     |                  |
  |  +---------------------+        +----------+----------+                  |
  |                                            |                             |
  |                        +-------------------+-------------------+         |
  |                        |                                       |         |
  |                        v                                       v         |
  |  +--------------------------------------------+   +--------------------+ |
  |  |            ANALYSIS LAYER                  |   | SQLite database.py | |
  |  |                                            |   | scans, identities  | |
  |  | faces.py     YuNet detect, SFace embed,    |   | users, sessions    | |
  |  |              cross-frame tracking          |   | WAL journalling    | |
  |  | detector.py  ONNX ensemble, softmax vote,  |   | shared lock,       | |
  |  |              CAM heatmap (pure numpy)      |   | closing sessions   | |
  |  | forensics.py EXIF, ELA, C2PA presence      |   +--------------------+ |
  |  | pipeline.py  image orchestration           |                          |
  |  | video.py     frame sampling + aggregation  |                          |
  |  +---------------------+----------------------+                          |
  |                        |                                                 |
  |                        v                                                 |
  |            +--------------------------------+                            |
  |            | backend/models/*.onnx          |                            |
  |            | 3 classifiers + YuNet + SFace  |                            |
  |            +--------------------------------+                            |
  +==========================================================================+

  Figure 1 - Two-phase architecture. Training runs once on borrowed GPU;
             everything after is local and offline.


================================================================================
4.  DETECTION PIPELINE
================================================================================

Every uploaded image follows the same path. Timings are measured on the target
machine: an Intel i3-1005G1, two cores, no GPU.


   01 UPLOAD            02 DETECT FACES       03 CROP + MARGIN
   +--------------+     +----------------+    +------------------+
   | extension +  | --> | YuNet          | -->| 20% beyond box   | --+
   | size checks  |     | 5 landmarks    |    | resize to 224x224|   |
   +--------------+     | min 48 px      |    +------------------+   |
                        +----------------+                           |
                                                                     v
   05 CAM HEATMAP                              04 ENSEMBLE
   +------------------+                        +--------------------+
   | sum W . features | <--------------------- | 3 ONNX models      |
   | forward-only     |                        | mean of softmax    |
   +--------+---------+                        +--------------------+
            |
            v
   +--------------------------------------------------------------+
   |  CLASSICAL FORENSICS  (independent of the neural network)     |
   |                                                               |
   |  06 EXIF METADATA      07 ERROR LEVEL         08 C2PA CHECK   |
   |     camera, software      ANALYSIS               manifest     |
   |     GPS, stripping        recompress + diff      presence     |
   |                           block variance         (not signed) |
   +-------------------------------+-------------------------------+
                                   |
                                   v
                    +-----------------------------+
                    | 09 REPORT ASSEMBLED         |
                    | verdict, confidence,        |
                    | findings, evidence timeline |
                    +-----------------------------+

  Figure 2 - Image pipeline. Steps 6-8 are classical forensics, run
             independently of the model.


VERDICT BANDS
-------------
The ensemble emits a probability that the face is manipulated. That maps onto
three bands, configurable in backend/config.py:

    BAND                 RANGE          MEANING
    -----------------------------------------------------------------------
    [OK]  Authentic      < 0.40         No manipulation signature detected
    [!]   Suspicious     0.40 - 0.65    Warrants a second look, not an
                                        accusation
    [X]   Fake           >= 0.65        Manipulation signature detected

  WHY A MIDDLE BAND EXISTS
  ------------------------
  A forced binary hides genuine uncertainty. On a question with these
  consequences, "I am not sure" is a more honest output than a confident
  coin-flip. When an image scores 0.51, the useful action is LOOK CLOSER -
  not accuse, and not clear.

When several faces are present, THE MOST SUSPICIOUS FACE DRIVES THE OVERALL
VERDICT. One forged face in a group photograph makes the image manipulated, and
averaging would dilute exactly the evidence that matters.


================================================================================
5.  VIDEO ANALYSIS
================================================================================

Analysing every frame of a clip would take minutes on a CPU. Instead the system
samples 32 FRAMES EVENLY ACROSS THE CLIP and aggregates along two independent
axes.


  +-------------+    +------------------+    +-------------------+
  | Video upload| -->| Sample 32 frames | -->| Score every face  |
  | MP4 MOV AVI |    | evenly across    |    | per frame,        |
  | MKV WEBM    |    | np.linspace      |    | same ensemble     |
  +-------------+    +------------------+    +---------+---------+
                                                       |
                        +------------------------------+------------------+
                        |                                                 |
                        v                                                 v
  +-------------------------------------+   +-------------------------------+
  | AXIS 1 - PER PERSON                 |   | AXIS 2 - OVER TIME            |
  | track by SFace embedding            |   | std-dev of each person's      |
  | IoU fallback when no embedding      |   | scores across frames          |
  | each person gets own timeline       |   | sigma > 0.18 = unstable       |
  +------------------+------------------+   +---------------+---------------+
                     |                                      |
                     +------------------+-------------------+
                                        v
                          +---------------------------+
                          |  CLIP VERDICT             |
                          |  0.6 x peak               |
                          |  + 0.4 x mean             |
                          |  + temporal flag          |
                          +---------------------------+

  Figure 3 - Video aggregation along two axes: WHO, and WHEN.


WHY PEAK-WEIGHTED
  A convincing fake only breaks down in SOME frames. A plain mean would average
  away exactly the evidence that matters.

WHY VARIANCE IS A SIGNAL
  A real face scores consistently. A swapped one flickers as the generator
  struggles with unusual pose, blinking and occlusion. That flicker is itself
  the evidence, and the standard deviation captures it directly.


================================================================================
6.  MODEL TRAINING
================================================================================

The target machine has no GPU, so training happens once on Google Colab's free
T4 and the result is exported for local use. training/train.py is the single
source of truth - the Colab notebook writes that exact file out and executes
it, so the two cannot drift apart.

DATASET
-------
FaceForensics++ face crops (~190,000 images), the standard academic benchmark,
containing real forgeries from four distinct methods:

    * Deepfakes
    * Face2Face
    * FaceSwap
    * NeuralTextures

Training across all four is what prevents the network latching onto the quirks
of a single generator.

Sources are pulled anonymously from HuggingFace - no account, no API token, no
dataset request form. The loader tries a ranked list of mirrors and reports
which one succeeded, so a moved dataset degrades to a message rather than a
stack trace.

ARCHITECTURES
-------------
    MODEL              WHY IT IS IN THE ENSEMBLE
    -----------------------------------------------------------------------
    EfficientNet-B0    Strong accuracy-per-parameter. The primary model, and
                       the one used for heatmaps.
    XceptionNet        The historical baseline for FaceForensics++.
                       Depthwise-separable convolutions catch different
                       artifacts.
    MobileNetV3        Different inductive biases again, and cheap enough
                       that adding it costs little at inference.

Their votes are averaged. This is not decoration - DIFFERENT ARCHITECTURES FAIL
ON DIFFERENT IMAGES, so the mean beats any single member. Where they disagree,
the report surfaces a "model agreement" figure rather than hiding it behind a
confident number.

AUGMENTATION
------------
  JPEG RECOMPRESSION IS THE HIGHEST-VALUE AUGMENTATION FOR THIS TASK.
  Without it the network learns compression artifacts rather than forgery
  artifacts, and collapses the moment an image is re-saved or passes through a
  social platform.

Random quality between 40 and 95 is applied to half of all training samples,
alongside resized-crop, horizontal flip, colour jitter and Gaussian blur.

EXPORT
------
Each model exports to ONNX with TWO outputs:

    input      (N, 3, 224, 224)    normalised image batch
    logits     (N, 2)              [real, fake] scores
    features   (N, C, H, W)        final convolutional feature map

The second output is what makes local explainability possible. The training
script then verifies each exported model against PyTorch on real test batches
and fails loudly if predictions drift by more than 0.01 - a silent export
mismatch would mean the laptop scoring images differently from the reported
accuracy.


================================================================================
7.  EXPLAINABILITY
================================================================================

Every verdict ships with a CLASS ACTIVATION MAP: a heatmap over the face
showing which regions pushed the score toward "fake". Red argued for
manipulation; blue argued for authenticity.

This is not an approximation. Because these networks end in global-average-
pooling followed by a single linear layer, the fake logit decomposes EXACTLY
into a weighted sum over the final feature map:

        cam(y, x) = SUM over c of  W[fake, c] * features[c, y, x]

The map is therefore a faithful spatial breakdown of the decision the model
actually made. On a genuine face swap, the heat concentrates along the jawline,
hairline, and the edges of the eyes and mouth - precisely where blending is
hardest.

  WHY CAM RATHER THAN GRAD-CAM
  ----------------------------
  Grad-CAM requires backpropagation, and ONNX Runtime performs forward passes
  only. For this network shape the two are mathematically equivalent, and CAM
  needs nothing beyond the forward pass already computed.

  Result: identical explanatory power, no PyTorch on the laptop, ~100 ms per
  face.


================================================================================
8.  FORENSIC SIGNALS
================================================================================

Three classical checks run alongside the network, entirely independently -
which is what makes them worth having.

EXIF METADATA
  Cameras write rich capture data: make, model, exposure, GPS. Generative
  models write none, and most editors destroy it. Absence is weak evidence
  alone but meaningful alongside others. Editing-software traces are reported
  explicitly.

ERROR LEVEL ANALYSIS
  Re-saves the image at a known JPEG quality and measures how much each region
  moves. Untouched areas sit near their compression fixed point; pasted or
  generated regions have a different compression history and move further.
  Block-level variance flags the difference.

C2PA PROVENANCE
  Looks for an embedded Content Credentials manifest. PRESENCE ONLY -
  cryptographic validation against a trust list is not implemented, and the
  report says so. Absence is explicitly NOT treated as evidence of
  manipulation, because most cameras and editors still do not write one.


================================================================================
9.  FACE RECOGNITION
================================================================================

Faces are reduced to 128-DIMENSION EMBEDDINGS via OpenCV's SFace model, where
the same person's photographs cluster together and different people separate.
Matching uses cosine similarity at a threshold of 0.363 - OpenCV's published
recommendation for this model.

Re-enrolling a person averages their embeddings, which makes matching more
robust across pose and lighting. ONLY THE VECTOR IS STORED; THE PHOTOGRAPH IS
DISCARDED IMMEDIATELY.

  WHY IDENTITY AND MANIPULATION ARE REPORTED TOGETHER
  ---------------------------------------------------
  Neither half is worth much alone. "This is a manipulated face" does not say
  whose. "This is Person X" does not say whether the footage is real. The
  useful statement - the one that supports a decision - is:

      "This claims to be Person X, and the face has been altered."

The same embeddings drive video tracking, following each person across sampled
frames so they each get an independent authenticity timeline.


================================================================================
10.  TEXT ANALYSIS: PLAGIARISM & AI CONTENT
================================================================================

A separate module (backend/textcheck.py) reachable from the sidebar under
"Text Analysis". Two independent checks, selected with two filters and run by
one button.

They are deliberately kept apart, because their evidence is not of equal
quality and presenting them identically would mislead.

PLAGIARISM - A REAL MEASUREMENT
-------------------------------
Shared word 5-grams between the submitted text and a reference you supply.
Long enough that a shared run is very unlikely to be coincidental, short enough
to survive light paraphrasing around it.

The percentage is the share of the document's 5-grams that also appear in the
reference. That is an exact quantity, not an estimate.

    verbatim copy        100.0%   HIGH
    unrelated text         0.0%   MINIMAL
    partial copy      somewhere between, with the copied run marked

Matching passages are returned as CHARACTER OFFSETS into the original text, so
the interface highlights them in place with capitalisation, punctuation and
line breaks intact - not a reconstructed lowercase copy.

  IMPORTANT: this compares two documents. It does NOT search the web. Without
  a reference there is nothing to measure against, and the tool says so rather
  than inventing a number.

AI-GENERATED TEXT - INDICATORS, NOT DETECTION
---------------------------------------------
There is no signal that separates machine from human prose the way a blend
seam separates a face swap from a photograph. What IS computable is a set of
stylistic statistics that skew differently on average:

    SIGNAL                      WEIGHT   WHAT IT MEASURES
    ------------------------------------------------------------------------
    Sentence-length variation     28%    Humans mix long and short sentences
                                         more than generated text does
    Vocabulary diversity          20%    Unique words, normalised for length
    Internal repetition           16%    Repeated 5-grams within the passage
    Model-typical phrasing        16%    Phrases current models overuse
    Sentence length               10%    Consistently long sentences
    Punctuation variety           10%    Narrow punctuation range

Measured separation on held-out samples:

    human-written prose     9.0%   MINIMAL INDICATORS
    LLM-style prose        43.1%   FEW INDICATORS

The interface shows every component signal with its weight, so a reader can
judge the reasoning rather than trusting a number.

MARKING SUSPECTED PASSAGES
--------------------------
Both checks return regions, and a combined view marks them in the text:

    amber   matches the reference
    cyan    AI indicators
    red     both

Overlaps are resolved by sweeping span boundaries so every character gets
exactly one classification - two overlapping HTML marks would nest invalidly.

Only signals meaningful for a SINGLE SENTENCE are used to flag a region:
model-typical phrasing, length relative to this document's own average,
participation in repeated phrasing, and low word variety. Burstiness and
length-normalised diversity are properties of a whole document and say nothing
about one sentence, so using them per-sentence would invent precision that is
not there. They still contribute to the document score, where they belong.

PERFORMANCE
-----------
    19,201 words + 2,301-word reference     187 ms
    57,601 words + 4,601-word reference     456 ms

2.4x time for 3x input - sub-linear, because document shingles are counted
once and reused per sentence rather than recomputed.

  THE HONEST FRAMING
  ------------------
  Published AI-text detectors misclassify human writing regularly, and the
  consequences of a false accusation are serious. A high score here is a
  reason to LOOK CLOSER. It is never evidence on its own, and the interface
  says so every time it shows one.


================================================================================
11.  STANDALONE BROWSER ENGINE
================================================================================

When no Python service is reachable - a static deployment on Vercel or
Netlify, for instance - the app does not go dead. It falls back to an engine
that runs entirely in the browser (frontend/src/engine/).

WHAT STILL WORKS, COMPUTED FROM THE FILE'S OWN BYTES
    * EXIF parsing - a JPEG segment walk and TIFF IFD read for camera,
      editing software, timestamps, GPS and metadata stripping
    * Error Level Analysis - canvas re-encode with 8x8 block spread
    * C2PA content-credential detection
    * Scan history and dashboard aggregates, in IndexedDB

Verified equivalent to the Python implementation: given a JPEG with known
EXIF, the browser parser returns the same camera, model, software and
timestamp as the backend, field for field.

WHAT DOES NOT
    The neural verdict. That needs the trained CNN ensemble, which is far too
    large to ship to a browser. Those reports are marked UNVERIFIED and the
    score renders as a dash - never a guessed number.

WHY NOT A PRETRAINED BROWSER MODEL
    One was evaluated: an Apache-2.0 ViT deepfake detector published for
    browser inference. Measured against six genuine photographs it scored
    0.44, 0.49, 0.55, 0.58, 0.74 and 0.77 - no separation, and four of the six
    called fake. Full precision and uint8 agreed within 0.01, so this was the
    model itself rather than quantisation damage. It was discarded: a
    confidently wrong verdict is worse than an absent one.


================================================================================
12.  TECHNOLOGY CHOICES
================================================================================

  LAYER              CHOICE                  RATIONALE
  ---------------------------------------------------------------------------
  Training runtime   PyTorch + timm          Flexible, standard, and free on
                     (Colab T4)              borrowed GPU hardware

  Inference runtime  ONNX Runtime 1.28       ~50 MB against PyTorch's 2 GB, and
                                             ~100 ms per face on a 2-core CPU.
                                             The difference between running on
                                             the target machine and not running
                                             at all.

  Face detection     OpenCV YuNet            Built into OpenCV, fast on CPU,
                                             returns five landmarks. Avoids
                                             mediapipe and dlib, neither of
                                             which builds cleanly on Py 3.13.

  Face recognition   OpenCV SFace            Also built in - zero additional
                                             dependencies for a whole feature

  API                FastAPI + Uvicorn       Same language as the models, so no
                                             cross-process bridge; automatic
                                             OpenAPI docs

  Storage            SQLite (WAL mode)       Ships with Python. No server to
                                             install, configure, or explain

  Frontend           React 18 + Vite         Fast builds; the dashboard is
                                             genuinely interactive

  Styling            Tailwind v4 + Sass      Tailwind for layout velocity; Sass
                                             for the design-token system, so
                                             the whole theme changes from one
                                             file

  Animation          GSAP + ScrollTrigger    Scroll-scrubbed hero and reveal
                                             choreography CSS cannot express

  Charts             Hand-written SVG        Three simple forms; a charting
                                             library would cost more bytes than
                                             the charts do

  Fonts              Space Grotesk + Inter,  A CDN font falls back to Times New
                     self-hosted             Roman the moment venue wifi drops


================================================================================
13.  ENGINEERING DECISIONS
================================================================================

WHY THE 20% CROP MARGIN
  The blend seam of a face swap sits just OUTSIDE the detector's bounding box.
  Cropping tight to the box discards the most informative pixels in the image.

WHY UPLOADS ARE DELETED IMMEDIATELY
  Previews are embedded in the report as data URIs, so the original file has
  served its purpose once analysis completes. Retaining it would grow the disk
  without bound across a long session - an early version accumulated 12 MB in a
  single test run.

WHY ROUTE HANDLERS NEVER CALL EACH OTHER
  FastAPI resolves parameter defaults such as Form(None) only through
  dependency injection. Calling one route handler directly from another passes
  the raw Form object instead of the value. This caused a real defect in which
  EVERY VIDEO UPLOAD RETURNED HTTP 500. Shared logic now lives in plain
  functions that all routes call.

WHY DATABASE SESSIONS ALWAYS CLOSE
  *** A CORRUPTION INCIDENT WORTH DOCUMENTING ***

  Every query originally used:

      with sqlite3.connect(...) as conn:

  That context manager COMMITS but does NOT CLOSE. Across 19 call sites it
  leaked a file handle on every query. Combined with two independent locks over
  the same file, the database eventually developed an invalid page-1 B-tree
  header and became unreadable, returning 500s across the app.

  The fix:
    * one shared re-entrant lock
    * a session() context manager that closes in a finally block
    * WAL journalling, which survives an abrupt process exit
    * automatic quarantine of an unreadable database at startup, so a bad file
      cannot take the whole tool down

  Nine regression tests now cover it, including a 120-operation leak check and
  a four-thread concurrency test that asserts PRAGMA integrity_check afterwards.

WHY THE ASSISTANT IS NOT A LANGUAGE MODEL
  The in-app chat answers from a curated knowledge base and can query the live
  database, so the figures it quotes are real. A generative model would require
  an API key, a network round trip, and per-message cost - and could
  confidently invent claims about how this system works. A curated base cannot.
  It says "I do not know" rather than guessing, and the chat header states
  openly what it is.

WHY THE THEME LIVES IN SASS TOKENS
  The palette is authored once as Sass variables and emitted as CSS custom
  properties. Components reference only the properties, so the entire interface
  re-skins from one file without a single component being edited. Surface and
  border steps are DERIVED with color.adjust rather than hand-picked, keeping
  the elevation ladder even.

  A KNOWINGLY-ACCEPTED ACCESSIBILITY TRADE-OFF
  --------------------------------------------
  The palette's success green and warning amber sit at delta-E 3.9 under
  deuteranopia - for red-green colourblind viewers (~8% of men) the Authentic
  and Suspicious states are close in hue. The mitigation is that COLOUR IS
  NEVER LOAD-BEARING: every verdict carries an icon (check / bang / cross) AND
  its text label, everywhere it appears. All twelve foreground/background pairs
  were verified programmatically against WCAG.


================================================================================
14.  DATA MODEL
================================================================================

    scans        scan_id PK, created_at, filename, media_type, verdict,
                 risk_level, fake_probability, authenticity_score, confidence,
                 faces_detected, file_size_bytes, processing_ms, report_json

    identities   name PK, created_at, embedding (BLOB, 128 x float32),
                 sample_count, notes

    users        id PK, email UNIQUE, name, salt (BLOB),
                 password_hash (BLOB, scrypt), created_at, last_login

    sessions     token PK, user_id FK -> users(id) ON DELETE CASCADE,
                 created_at, expires_at

Full reports are stored as JSON so the schema does not have to model every
nested detail. Face embeddings are stripped before persistence - they are large
and meaningful only during the request that produced them.


================================================================================
15.  API REFERENCE
================================================================================

Interactive documentation is generated at /docs while the server runs.

    METHOD   ROUTE                        PURPOSE
    ---------------------------------------------------------------------------
    POST     /api/scan                    Upload image or video; routes on
                                          file extension
    POST     /api/scan/image              Image pipeline explicitly
    POST     /api/scan/video              Video pipeline, optional max_frames
    GET      /api/scans                   History: limit, offset, verdict filter
    GET      /api/scan/{id}               Full stored report
    DELETE   /api/scan/{id}               Remove a scan
    GET      /api/stats                   Dashboard aggregates + 14-day trend
    GET      /api/models                  Per-model test metrics from training
    POST     /api/identity/enroll         Add a known face to the gallery
    POST     /api/identity/match          Identify faces + deepfake verdict
    GET      /api/identities              List enrolled identities
    DELETE   /api/identity/{name}         Remove an identity
    POST     /api/auth/signup             Create an account
    POST     /api/auth/login              Sign in
    POST     /api/auth/logout             Sign out
    GET      /api/auth/me                 Current session
    POST     /api/text/analyze            Plagiarism overlap + AI indicators
    POST     /api/assistant               Ask the in-app assistant
    GET      /api/system/info             Loaded models, thresholds, limits
    GET      /api/health                  Liveness + model status


================================================================================
16.  SECURITY
================================================================================

    MEASURE               IMPLEMENTATION
    ---------------------------------------------------------------------------
    Password storage      scrypt (n=2^14, r=8, p=1) with a per-account 16-byte
                          random salt and a 64-byte derived key

    Session tokens        secrets.token_urlsafe(32), stored server-side with a
                          14-day expiry

    Token transport       HttpOnly cookie - unreadable from JavaScript, so an
                          XSS bug cannot exfiltrate it

    Account enumeration   Unknown email and wrong password hash identically,
                          take the same time, and return the same message

    Timing comparison     hmac.compare_digest for hash comparison

    DoS surface           Passwords capped at 200 characters - unbounded input
                          into scrypt is an attack vector

    Upload validation     Extension allowlist, 200 MB cap, empty-file
                          rejection, decode verification

    Path safety           Uploaded filenames are never trusted as paths;
                          storage names are UUID-generated

  SCOPE STATEMENT
  ---------------
  This is real authentication for a locally-run tool, NOT a production identity
  system. It has no email verification, no password reset, no rate limiting, no
  OAuth and no 2FA. It should not be exposed to the public internet as-is.


================================================================================
17.  TESTING
================================================================================

235 automated tests, all passing.  Run with:  pytest backend/tests -q

    SUITE                      TESTS   COVERAGE
    ---------------------------------------------------------------------------
    test_core.py                 54    Verdict thresholds, face detection,
                                       cropping, embeddings, tracking, ONNX
                                       ensemble, CAM bounds, forensics
    test_auth.py                 40    Hashing, salting, enumeration
                                       resistance, timing equivalence, session
                                       expiry, endpoint behaviour
    test_assistant.py            37    Intent routing across 17 topics, refusal
                                       on unknown questions, live-data accuracy
    test_pipeline_video.py       37    Image and video pipelines end to end,
                                       edge cases, database round-trips
    test_api.py                  26    Every HTTP endpoint, error handling,
                                       upload cleanup, regression tests
    test_textcheck.py            30    Plagiarism overlap exactness, span
                                       offsets, AI signal ordering, region
                                       marking, endpoint behaviour
    test_db_session.py           11    Connection reuse, write speed guard,
                                       concurrent writes, corruption recovery
    ---------------------------------------------------------------------------
    TOTAL                       235

The suite passes with or without trained models present:
backend/tools/make_dummy_model.py builds a structurally identical placeholder
so every code path is exercised. That placeholder is flagged "dummy": true in
the manifest and surfaced as a warning in the UI, so it can never be mistaken
for a trained model.

Several tests exist specifically because a real defect occurred: the video-
upload 500, the unbounded upload directory, the oversized previews, and the
database connection leak each have a dedicated regression test naming the
failure it prevents.


================================================================================
18.  PROJECT STRUCTURE
================================================================================

    START.bat                     one-click launcher (venv, install, build, run)
    requirements.txt
    README.md

    notebooks/
      OmniGuard_Training.ipynb    <-- run this on Colab

    training/
      train.py              575   the actual training code

    tools/
      build_notebook.py           regenerates the notebook from train.py
      fetch_fonts.py              vendors Space Grotesk + Inter locally
      extract_hero_frames.py      video -> JPEG sequence for scroll animation

    backend/
      assistant.py          604   curated knowledge base + live-data answers
      main.py               515   FastAPI routes, lifespan, static serving
      textcheck.py          375   plagiarism overlap + AI text indicators
      database.py           328   SQLite sessions, scans, identities, recovery
      forensics.py          236   EXIF, ELA, C2PA
      detector.py           232   ONNX ensemble + CAM heatmaps
      auth.py               227   accounts, scrypt hashing, sessions
      video.py              213   frame sampling, tracking, aggregation
      faces.py              180   YuNet detection, SFace embeddings, tracker
      pipeline.py           155   image analysis orchestration
      config.py             113   every tunable number, environment overrides
      bootstrap.py           89   first-boot model fetch for containers
      models/                     YuNet + SFace committed; classifiers from
                                  the training run
      tools/                      placeholder-model generator
      tests/                      235 tests across 7 suites

    frontend/
      src/                        38 files - pages, components, hooks, Sass
        engine/                   browser-side forensics, used when no backend
                                  is reachable
      public/                     logo, self-hosted fonts, hero frame sequence,
                                  this document

    DEPLOYMENT
      Dockerfile                  multi-stage: Node builds the UI, Python
                                  serves both it and the API
      render.yaml                 one-click blueprint - the WHOLE app
      vercel.json                 frontend-only static build
      netlify.toml                same, for Netlify
      requirements-server.txt     container deps (headless OpenCV)

    brand/                        original logo and source video (not shipped)


KEY CONFIGURATION  (backend/config.py)

    SUSPICIOUS_THRESHOLD               0.40
    FAKE_THRESHOLD                     0.65
    FACE_MARGIN                        0.20
    CLASSIFIER_INPUT_SIZE              224
    MIN_FACE_PIXELS                    48
    VIDEO_MAX_FRAMES                   32
    TEMPORAL_INCONSISTENCY_THRESHOLD   0.18
    IDENTITY_MATCH_THRESHOLD           0.363
    MAX_UPLOAD_MB                      200


================================================================================
19.  LIMITATIONS
================================================================================

These are real, and stating them up front is more defensible than being caught
out by them.

  * IT DETECTS FACE-BASED FORGERY.
    Trained on FaceForensics++ face crops, so it is strong on face swaps and
    AI-generated faces. It is NOT a general "was this made by AI" detector - a
    synthetic landscape is outside its training distribution.

  * NO-FACE IMAGES FALL BACK TO WHOLE-FRAME ANALYSIS,
    which is markedly less reliable. The report states this whenever it happens.

  * ACCURACY IS MEASURED ON A HELD-OUT SPLIT OF THE SAME DATASET.
    Cross-dataset generalisation - training on FaceForensics++ and testing on
    Celeb-DF - is the harder benchmark and is not claimed here.

  * HEAVY COMPRESSION, LOW RESOLUTION AND SMALL FACES
    all degrade the signal. Faces below 48 pixels are rejected rather than
    guessed at.

  * C2PA IS A PRESENCE CHECK,
    not signature validation against a trust list.

  * ERROR LEVEL ANALYSIS IS WEAK
    on PNGs and on heavily re-compressed images.

  * AUDIO, TEXT AND DOCUMENT DETECTION ARE NOT BUILT.
    They are labelled as such in the interface rather than stubbed with fake
    output.

  THE HONEST FRAMING
  ------------------
  A verdict is EVIDENCE, NOT PROOF. It belongs as one input to a human
  decision, never as a replacement for one. A "Suspicious" result means LOOK
  CLOSER - it is not an accusation.


================================================================================
20.  RUNNING IT
================================================================================

START THE APPLICATION
  Double-click START.bat. It creates the Python environment, installs
  dependencies, builds the dashboard, and opens http://127.0.0.1:8000. Every
  subsequent run is immediate. The face models are committed, so there is
  nothing to download.

DEPLOY IT
  One Render service hosts the whole app: the Dockerfile builds the dashboard
  and serves it from the same process as the API, so there is no CORS to
  configure and no cross-site cookie handling.

    render.com -> New -> Blueprint -> this repository -> Apply

  Hugging Face Spaces works the same way and is also free. Vercel and Netlify
  can host the frontend only - their function limits (250 MB unzipped and
  50 MB zipped) are below this backend's ~261 MB - and the app falls back to
  its browser engine there. See DEPLOYMENT.md.

TRAIN THE MODELS  (once, ~50 minutes, unattended)
  1.  colab.research.google.com  ->  File  ->  Upload notebook
  2.  Upload notebooks/OmniGuard_Training.ipynb
  3.  Runtime  ->  Change runtime type  ->  T4 GPU  ->  Save
  4.  Runtime  ->  Run all
  5.  Unzip omniguard_models.zip into backend/models/
  6.  Run START.bat again

  No Kaggle account, no dataset request forms, no API tokens.

RUN THE TESTS
  .venv\Scripts\python.exe -m pytest backend/tests -q

ADJUST THE MODEL
  python train.py --epochs 5 --batch-size 32 --img-size 299 --n-train 140000

  Detection thresholds, crop margin, frame budget and upload limits all live in
  backend/config.py.


================================================================================
21.  FUTURE WORK
================================================================================

    DIRECTION                  WHAT IT INVOLVES
    ---------------------------------------------------------------------------
    Cross-dataset validation   Train on FaceForensics++, test on Celeb-DF. This
                               is the benchmark that reveals whether a detector
                               generalises or has memorised one generator.

    Audio deepfake detection   A CNN over mel-spectrograms trained on ASVspoof
                               or WaveFake. A separate model and training run;
                               the pipeline is modular enough to accept it.

    Full C2PA validation       Parse the manifest and verify its signature
                               chain against a trust list, rather than only
                               detecting presence.

    Real-time camera analysis  The inference path is already fast enough on
                               CPU; this needs the capture and streaming layer.

    Vision transformers        Adding a ViT to the ensemble would broaden the
                               set of artifacts covered, at meaningful
                               inference cost.

    Model distillation         Compress the ensemble into a single student
                               network for lower-power devices.


================================================================================

  OMNIGUARD AI - deepfake and AI-generated media detection.

  Built with PyTorch, timm, ONNX Runtime, OpenCV, FastAPI, SQLite, React, Vite,
  Tailwind, Sass and GSAP. Models fine-tuned on FaceForensics++.

  A verdict is evidence, not proof.

================================================================================
