# KV Code

KV Code is being rewritten from first principles as a local-first AI workbench
for developers and technical knowledge workers.

This repository currently contains one runnable application:
`apps/desktop`. It is a TypeScript, Electron, React, and Vite Desktop
implementation. The CLI, daemon, shared `packages/` architecture, SQLite
persistence, browser control, memory, skills, and
multi-agent runtime described later in this document are target requirements;
they do not exist in the current source tree.

The previous implementation was removed because its inherited architecture,
unused features, build cost, compatibility layers, and product boundaries made
continued development slower and less reliable than a clean rewrite.

## Development and Test Packaging

Run the Desktop application from source with `pnpm dev`. Build a portable
Windows x64 test executable with `pnpm package:win`; the artifact is written to
`apps/desktop/dist/` and can be copied to another Windows computer without a
Node.js or pnpm installation.

The package contains only compiled application files, runtime dependencies,
and desktop icons. Provider credentials, conversations, settings, workspace
history, and all other user data live under Electron's per-user application
data directory and are never included in the executable. A copied executable
therefore starts with the target computer's own clean user profile.

## Implemented Snapshot

**Status: rewrite in progress**

The statements in this section describe the source code that exists now. The
rest of the README is the product and engineering specification unless a
section explicitly says that a feature is implemented.

The current repository shape is:

```text
apps/
  desktop/          Electron main process, preload, and React renderer
```

There is currently no `apps/cli`, `apps/daemon`, or `packages/` directory.

The current Desktop implementation includes:

- sandboxed Electron IPC with OS-encrypted provider credentials;
- native tool-capable loops for OpenAI Responses, OpenAI-compatible Chat
  Completions, Anthropic Messages, and Google Gemini;
- persistent conversations stored independently per workspace, without silent
  history eviction, with per-message tool audit records;
- incremental rolling-summary context compaction that preserves the original
  transcript and keeps recent turns verbatim;
- a lazy, read-only current-workspace file tree that tracks external file
  changes and provides source, text, image, PDF, and Markdown previews;
- source/rendered Markdown switching with GFM, safe embedded HTML, and KaTeX;
- safe GFM, HTML, and KaTeX rendering for assistant responses, with deferred
  streaming updates;
- user-authored global and project rules with resolved-order preview, bounded
  model injection, and local Git exclusion for `.kv-code/`;
- workspace file listing and search, text search, ranged reads, exact text
  patches, writes, directory creation, moves, and deletion;
- structured Git status, diff, log, show, branch, conflict, staging,
  unstaging, branch creation and checkout, commit, and worktree tools;
- one-shot terminal execution plus an integrated node-pty/xterm terminal with
  tabs, retained output, input, resize, lifecycle controls, and model-visible
  session output;
- Read-only, Auto, and YOLO tool policies, including Auto approval dialogs,
  an explicit YOLO warning, safely parallelized read-only calls, and persisted
  tool audit records attached to the corresponding assistant message;
- a wide, left-aligned, collapsible work-process timeline whose individual
  tool entries reveal parameters, output, edit diffs, durations, exit codes,
  and changed files on demand;
- in-place sandboxed JSX/TSX interactive components and sanitized SVG output,
  each with source/preview switching;
- sandboxed source/rendered HTML file previews with scripts and network access
  disabled;
- built-in Work Mode rendering for DOCX, PPTX, and XLSX files, including
  embedded DOCX media; and
- dark/light themes, English/Chinese localization, and nonlinear reasoning
  controls with reduced-motion support.

Current local persistence uses Electron user-data files, not SQLite. Provider
secrets are protected with operating-system encryption. Integrated terminal
sessions are process-local and close with the application; conversation tool
audit records remain durable with their assistant messages.

The following major capabilities remain planned rather than implemented:

- the CLI and persistent runtime daemon;
- the shared package architecture shown in the target repository shape;
- SQLite persistence and migrations;
- an AI-controllable browser with text and visual context;
- AI-authored global and project memory;
- reusable skills and user-defined agents; and
- swarm and multi-agent execution.

The rewrite will use TypeScript across the application, including the backend.
It will not retain the previous Rust runtime, app server, TUI, sidecar, crate
graph, legacy protocol, or compatibility surface.

The first implementation milestone must prove a narrow but real vertical slice:

1. Start the desktop application.
2. Configure a model provider securely.
3. Create a persistent session.
4. Stream a real model response.
5. Cancel an active turn.
6. Run a terminal tool through an approval boundary.
7. Inspect a real Git diff.
8. Restart the application and recover the session.

No decorative prototype will be accepted as a substitute for that slice.

Everything below this point defines the intended product, architecture, and
delivery requirements. It must not be interpreted as an inventory of the
current repository. Use the Implemented Snapshot above for current facts.

## Product Mission

KV Code should become the developer tool people trust for sustained work, not a
chat page wrapped in a desktop shell.

The product must combine:

- rigorous agent behavior;
- deep Git awareness;
- a real local terminal;
- a real, controllable browser;
- durable rules, memory, and reusable skills;
- model-provider independence;
- observable multi-agent execution;
- excellent keyboard-driven ergonomics;
- fast iteration and predictable performance;
- an artistic, technological, and distinctly metallic visual identity.

Correctness and trust come before spectacle. Visual quality and interaction
quality are still first-class requirements, not polish deferred until the end.

## Product Principles

### 1. Evidence over confidence

The agent must distinguish observed facts, reasonable inferences, and unknowns.
It must never invent command output, test results, file contents, model
capabilities, context usage, progress, or completion.

### 2. Completion over performance theater

When asked to implement a change, the agent should carry it through inspection,
implementation, verification, and a clear handoff. Plans, placeholders, fake
data, and disabled controls are not completed features.

### 3. Local control over hidden automation

The user must be able to see, approve, interrupt, and audit consequential local
or remote actions. KV Code should automate work without taking ownership away
from the developer.

### 4. One source of truth

The UI, CLI, model context, browser tools, Git tools, settings, and session state
must reflect the same underlying runtime state. Parallel mock state and duplicate
configuration stores are prohibited in production paths.

### 5. Product boundaries over inherited compatibility

The rewrite will implement the product KV Code needs. It will not recreate old
APIs, migration layers, cloud features, or protocol surfaces solely because they
existed before.

### 6. Fast feedback without feature cuts

Routine changes should be verifiable quickly. Build and test architecture must
avoid duplicated compilation and duplicated checks. Speed must come from clear
boundaries, caching, focused tests, and smaller packages, not from removing core
capabilities.

### 7. Art with restraint

KV Code should look authored rather than generated. Motion, light, texture, and
metallic surfaces must communicate state and hierarchy. The interface must not
look like a generic AI dashboard, a collection of floating cards, or a marketing
landing page.

## Non-Negotiable Requirements

- The implementation and backend are written in TypeScript.
- The desktop application uses Electron and React.
- The CLI and Desktop share the same core runtime packages.
- The shipped desktop application does not require a globally installed npm
  package or a hidden external runtime.
- The application has no inherited legacy branding, naming, paths, or protocol
  compatibility requirements.
- The project is licensed under the MIT License.
- Every production control must perform a real action or clearly explain why it
  is unavailable.
- All model-visible context is bounded and inspectable.
- All consequential actions support cancellation, timeout, and audit.
- Provider credentials never enter logs, memory, SQLite content, Git output, or
  model context.
- Dark and light themes are complete themes, not color inversion.
- English and Simplified Chinese are first-release interface languages.
- Reduced motion and keyboard accessibility are first-release requirements.

## Modes

KV Code has two first-class operating modes. A mode changes tools, defaults,
skills, presentation, and agent guidance. It is not a cosmetic label.

The user selects Code Mode or Work Mode while creating a conversation. The
selection becomes immutable when the first message is sent and remains fixed
for the lifetime of that conversation. Changing mode requires a new
conversation; reopening an existing conversation restores its recorded mode.

### Code Mode

Code Mode is optimized for software engineering. It should provide:

- repository inspection and navigation;
- file editing and structured patches;
- terminal execution;
- Git status, diff, staging, commits, branches, and worktrees;
- test, lint, build, and debugging workflows;
- browser-based application inspection;
- architecture and code review;
- provider-aware model selection;
- engineering skills and project rules;
- isolated agent delegation for bounded subtasks.

Code Mode should prefer evidence from the repository, Git, terminal output, and
runtime state over generic advice.

Users may preview Office documents from the workspace tree in either mode.
Code Mode must not give the AI direct Office-document read or mutation tools.
It may still
produce Office artifacts through explicit engineering workflows such as
writing package XML and assembling a DOCX archive, with the resulting artifact
treated as an output rather than an Office document opened for model editing.

### Work Mode

Work Mode is optimized for technical documents and office artifacts. It should
provide:

- DOCX creation and repair;
- direct XML package work when libraries are insufficient;
- spreadsheets, formulas, tables, and data validation;
- PDF creation and inspection;
- presentations and structured reports;
- render-based verification;
- reusable templates and artifact skills;
- explicit output directories and temporary-file management;
- specialized models and tools independent from Code Mode defaults.

Work Mode must verify final artifacts by reopening or rendering them. A file
that was merely written is not automatically considered correct.

Direct model access to read, create, or modify DOCX, PPTX, XLSX, and other
office artifacts is restricted to Work Mode. This permission boundary applies
to future agent tools and cannot be bypassed by changing a control after a
conversation has started. It does not restrict the user's read-only previews.

## Planned Technology Direction

The intended foundation is:

| Area | Direction |
| --- | --- |
| Language | TypeScript |
| Desktop | Electron |
| Interface | React and Vite |
| Runtime validation | Zod |
| Persistent state | SQLite with versioned migrations |
| Terminal | `node-pty` or an equivalently mature PTY implementation |
| Browser control | Electron WebContents and Chrome DevTools Protocol |
| Unit and integration tests | Vitest |
| Desktop end-to-end tests | Playwright with Electron |
| Packaging | Project-owned, reproducible Desktop and CLI installers |
| Formatting and linting | Prettier and ESLint |

Bun is not the default runtime because Electron and native-module compatibility
matter more than benchmark novelty. Native dependencies may be used when they
are mature and maintained, but KV Code should not introduce a custom Rust or C++
backend unless a measured platform limitation makes it unavoidable.

## Target Repository Shape

The initial monorepo should remain small and explicit:

```text
apps/
  desktop/          Electron main process, preload, and React renderer
  cli/              Node.js command-line client
  daemon/           Persistent local runtime process

packages/
  protocol/         Versioned IPC commands, events, and schemas
  runtime/          Sessions, turns, context, approvals, and cancellation
  providers/        Provider adapters and model capability metadata
  tools/            File, terminal, Git, MCP, and shared tool contracts
  browser/          Desktop browser adapter and CDP operations
  memory/           Global and project memory storage and retrieval
  skills/           Skill discovery, validation, and loading
  agents/           Agent trees, workers, budgets, and aggregation
  prompts/          Stable system policies and mode guidance
  config/           Global and project configuration
  git/              Structured Git operations and repository state
  ui/               Shared design tokens and interface components
```

Packages should be added only when they own a durable boundary. A directory per
minor helper is not architecture.

## Planned Process Architecture

KV Code should use three explicit process roles.

### Renderer process

The renderer owns presentation only:

- workbench layout;
- conversation rendering;
- editors and diff views;
- terminal rendering;
- settings forms;
- animation and themes;
- accessibility and input handling.

The renderer must not receive unrestricted Node.js access, raw credentials, or
arbitrary filesystem access.

### Electron main process

The main process owns desktop capabilities:

- windows and WebContents;
- the integrated browser session;
- secure credential access;
- narrow, validated IPC;
- application lifecycle;
- native menus, notifications, and updates;
- spawning and supervising the local daemon.

Electron must use `contextIsolation`, a sandboxed renderer, a narrow preload
bridge, a strict Content Security Policy, and an IPC allowlist.

### Runtime daemon

The daemon owns durable agent behavior:

- sessions and turns;
- provider requests and streaming;
- context construction;
- approvals and tool scheduling;
- terminal and Git tool coordination;
- rules, memory, and skills;
- agent workers;
- persistence and recovery;
- structured diagnostics.

The daemon communicates over a Windows named pipe or Unix domain socket. It must
not expose an unauthenticated localhost HTTP control port.

Desktop-specific browser actions must be implemented through a validated bridge
between the daemon and Electron main process. CLI use must not load Electron.

## Information Architecture

The main navigation is reserved for high-frequency work surfaces. Persistent
configuration must not be dumped into the sidebar.

### Main navigation

The primary workbench may contain:

- Sessions;
- Git;
- Terminal;
- Browser;
- live Agent Cluster;
- Work artifacts when Work Mode is active.

Settings should be a single entry near the bottom of the navigation. Providers,
rules, memory administration, skill management, theme configuration, privacy,
and default policies belong in Settings.

### Contextual controls

Controls that change frequently during work stay near the work they affect:

- current working directory;
- Code Mode or Work Mode;
- active model;
- per-turn reasoning intensity;
- send and stop;
- current branch;
- terminal session selection;
- browser address and navigation.

Settings stores their defaults, not the only way to change them.

## Settings

Settings must support search and clearly identify scope:

- **Global** settings affect every workspace.
- **Project** settings affect only the current project.

Every setting should indicate whether it applies immediately, to new sessions,
or after a restart. Project overrides must be visible and reversible.

### General

- default start surface;
- default working directory;
- default mode;
- new-session behavior;
- launch at login;
- background behavior on window close;
- automatic session recovery;
- cache, temporary, and download locations.

### Appearance

- dark, light, and system themes;
- complete metallic visual themes;
- interface density;
- UI and code fonts;
- editor and terminal palettes;
- animation intensity;
- reduced motion;
- transparency, blur, shadow, and material settings;
- Ultra pulse intensity;
- token, status, and performance instrumentation visibility.

A quick theme toggle may also exist in the title bar.

### Language and Accessibility

- interface language;
- preferred model-response language;
- date, time, and number formats;
- keyboard navigation;
- focus visibility;
- high contrast;
- color-vision assistance;
- screen-reader labels;
- global shortcuts and conflict management.

### Models and Providers

- provider catalog and enablement;
- secure API credentials;
- base URLs and custom headers;
- default models by mode;
- model modalities and capabilities;
- real context-window metadata;
- supported reasoning levels;
- request timeouts, retries, and concurrency;
- streaming behavior;
- connection tests;
- custom OpenAI-compatible providers;
- a visual proxy model for text-only models.

Provider management does not receive a permanent sidebar destination.

### Agent Behavior

- rigorous default conduct;
- proactive execution policy;
- default approval policy;
- context compaction policy;
- turn duration and token budgets;
- retry limits;
- verification requirements;
- user-authored additional instructions;
- default reasoning intensity.

Per-turn reasoning intensity remains next to the composer.

### Rules

- global rules editor;
- current-project rules editor;
- resolved rule order;
- conflict and source preview;
- file paths and load status;
- final model-visible rules preview;
- import, export, and restore.

Rules are user-authored. The AI must not silently create or edit them.

### Memory

- enable or disable memory use;
- enable or disable automatic learning;
- browse global memory;
- browse current-project memory;
- inspect source, creation time, and last use;
- delete individual memories;
- clear project or global memory;
- import and export;
- storage and retrieval limits;
- explain why a memory applies to the current project.

Memory is AI-authored and must remain visibly separate from rules.

### Skills and Extensions

- installed skills;
- Code Mode and Work Mode classifications;
- project-local skills;
- enable, disable, update, and remove;
- declared permissions;
- MCP server management;
- connection tests;
- source and signature information;
- tool access per skill.

Models should discover relevant skills automatically during work. Skill
administration belongs in Settings.

### Tools and Permissions

- file read and write policy;
- command execution policy;
- network policy;
- browser-control policy;
- Git mutation policy;
- external application policy;
- project trust;
- allowed and denied paths;
- allowed and denied commands;
- always-confirm operations;
- approval and audit history.

### Terminal

- default shell and arguments;
- startup directory;
- environment variables;
- fonts, colors, and cursor;
- scrollback limits;
- output limits;
- copy and link behavior;
- whether agents may create terminals;
- exit and retention behavior.

The live terminal remains a workbench surface.

### Browser

- home page and search engine;
- download location;
- site data controls;
- proxy and user agent;
- session restoration;
- AI browser permissions;
- screenshot dimensions and quality;
- DOM, OCR, and image-description limits;
- visual proxy model selection;
- dangerous-action approval policy;
- camera, microphone, location, and notification permissions;
- clear browsing data.

The live browser remains a workbench surface.

### Git

- Git executable;
- user name and email;
- default branch name;
- commit and signing defaults;
- diff presentation;
- automatic refresh and fetch;
- AI staging, commit, and branch permissions;
- policies for force push, reset, rebase, and destructive actions;
- worktree location;
- generated and ignored file presentation.

Git operations remain in the Git workbench.

### Agents and Swarm

- enable multi-agent work;
- concurrency limit;
- delegation depth;
- per-agent token and time budgets;
- default roles;
- create, edit, duplicate, and remove custom agents;
- assign a configured provider and model to each custom agent;
- configure each agent's role, instructions, reasoning default, skills, tools,
  permissions, and budget;
- whether child agents may delegate;
- retry policy;
- required result verification;
- model allocation by role;
- separate Code Mode and Work Mode policies.

The live task tree remains a workbench surface.

### Work Mode

- default output directory;
- document, PDF, spreadsheet, and presentation defaults;
- page size, language, and fonts;
- required render verification;
- temporary-file cleanup;
- direct XML-editing permission;
- default Work Mode model, skills, and tools.

### Data and Privacy

- local data locations;
- session retention;
- automatic cleanup;
- export all user data;
- delete all user data;
- log retention;
- telemetry, disabled by default;
- crash reporting;
- a clear preview of data sent to providers;
- credential storage status.

### Advanced and Diagnostics

- log level;
- structured runtime logs;
- IPC and daemon state;
- provider request diagnostics with secrets removed;
- model-context composition preview;
- active tool inventory;
- performance metrics;
- database integrity and repair;
- cache reset;
- runtime restart;
- experimental features.

### Updates and About

- version and build information;
- update channel;
- update checks and install policy;
- release notes;
- license;
- third-party notices;
- quick access to data and log directories.

## Conversation and Runtime

A conversation is a durable session, not a renderer-only array of messages.

The runtime must support:

- real streaming responses;
- accurate turn state;
- per-session model and provider identity;
- cancellation that reaches the provider and active tools;
- bounded retries;
- queued approvals;
- crash recovery;
- session resume after application restart;
- context inspection;
- accurate token and context-window reporting;
- bounded attachments;
- deterministic event ordering;
- explicit failure states.

The runtime must build model history incrementally. It should avoid history
rewrites that destroy provider cache reuse. Every injected context fragment must
have a hard byte or token cap.

## Reasoning Control

Reasoning intensity is a primary interaction, not a row of ordinary buttons.

The composer should provide a continuous-looking nonlinear slider mapped to the
discrete efforts supported by the selected model. The control must:

- expose accessible keyboard increments;
- show the actual provider-supported effort;
- avoid layout movement during interaction;
- animate with a nonlinear, physical response;
- remain responsive while a turn is streaming;
- fall back clearly when a model lacks reasoning controls.

Selecting `ultra` triggers a strong metallic pulse-wave event with directional
light scattering and material response. It must not be a generic colored glow.
The event must respect reduced motion and must not block input, rendering, or
stream processing.

## Providers and Models

Provider logic belongs behind a small adapter contract. Core runtime code must
not contain provider-specific branching beyond declared capabilities.

The initial adapter model should support:

- OpenAI Responses;
- OpenAI-compatible Chat Completions;
- Anthropic Messages;
- local OpenAI-compatible endpoints;
- custom providers with validated configuration.

Every provider declares:

- wire protocol;
- authentication requirements;
- base URL;
- supported input modalities;
- streaming behavior;
- tool-call format;
- reasoning controls;
- context limits;
- model metadata source.

Only credentials for the active provider may be exposed to its request adapter.
Credential values must be stored through operating-system secure storage.

## Integrated Terminal

The terminal must be a real local PTY. It should support:

- multiple sessions;
- resize and reflow;
- search, copy, and paste;
- restart and termination;
- working-directory changes;
- visible process state;
- bounded output capture for models;
- user takeover at any time;
- approval-aware agent execution.

Terminal output sent to a model must be structured, size-limited, and explicit
about truncation. Potential secrets require redaction before model exposure or
diagnostic logging.

## Integrated Browser

The browser is a core product surface.

KV Code must not maintain separate iframe, HTTP-fetch, and headless-screenshot
sessions. The user and the AI must operate the same Chromium WebContents, with
the same URL, cookies, authentication state, history, DOM, and rendered pixels.

Browser tools should use Chrome DevTools Protocol to provide:

- navigation;
- back, forward, and reload;
- DOM and accessibility snapshots;
- keyboard and mouse control;
- clicking, typing, scrolling, and selection;
- viewport and full-page screenshots;
- bounded page text;
- network and console diagnostics;
- download observation;
- clear action results.

### Multimodal models

Multimodal models may receive bounded screenshots plus structured page context.
Image transfer must follow the selected model's real modality support.

### Text-only models

Text-only models must receive useful alternatives:

- visible DOM text;
- accessibility roles and names;
- image alt text, labels, captions, and nearby text;
- OCR for text embedded in images;
- an optional visual proxy that produces bounded image descriptions.

KV Code must never pretend a text-only model can see pixels.

### Browser safety

Web content is untrusted. Page text cannot override system or user instructions.
The runtime must defend against prompt injection and separate page observations
from executable instructions.

Uploading, sending, purchasing, deleting, changing permissions, entering
sensitive data, or accepting browser permissions requires explicit policy and
approval. The user can interrupt browser automation at any time.

## Git as a Core System

Git is not an optional decorative panel. KV Code should support:

- repository discovery;
- branch and HEAD state;
- staged, unstaged, untracked, and conflicted files;
- structured diffs;
- per-file and per-hunk review;
- stage and unstage;
- commits;
- branch creation and switching;
- worktrees;
- history;
- fetch, pull, and push;
- remote divergence;
- explicit recovery points.

The agent must use actual Git state as evidence. It must preserve unrelated user
changes and identify ownership of edits. Reset, force push, destructive rebase,
history rewriting, and bulk deletion require narrow explicit authorization.

Agent tasks should be traceable to their commands, file changes, verification,
and optional commits.

## Rules

Rules are durable instructions written by the user.

KV Code supports:

- global rules;
- project rules;
- explicit source ordering;
- bounded file size;
- model-context preview;
- conflict visibility.

The AI may explain rule formats but must not silently author project rules or
change them on the user's behalf.

## Memory

Memory is durable, AI-authored knowledge and is not a synonym for rules.

KV Code supports two logical scopes:

- **Global memory** contains knowledge safe across unrelated workspaces.
- **Project memory** is bound to an exact project identity and path.

The agent may write memory only when:

- the user explicitly requests a memory change; or
- completed and verified work reveals stable, high-signal knowledge likely to
  help a future task.

The agent must not store credentials, secrets, personal data, guesses,
unverified claims, temporary task state, routine command output, or facts that
are cheap to rediscover.

Users can inspect, disable, delete, clear, import, and export memory. Every entry
must record its scope, source, creation time, and applicability.

## Skills

Skills are reusable, inspectable workflows. They may contain instructions,
templates, scripts, examples, and declared tool requirements.

The runtime must:

- discover global and project skills;
- validate metadata and size limits;
- reveal skill sources;
- separate Code Mode and Work Mode recommendations;
- enforce declared permissions;
- load only relevant skill content;
- tell the model that skills are available;
- avoid injecting an unbounded skill catalog into every turn.

Initial skill families should cover rigorous engineering, debugging, Git,
frontend verification, document packaging, DOCX/XML, spreadsheets, PDFs, and
artifact rendering.

## Agent Cluster and Swarm

Desktop and CLI must expose the same multi-agent capability.

The runtime should support:

- a rooted task tree;
- parent and child identities;
- explicit roles;
- bounded concurrency;
- bounded delegation depth;
- independent context per worker;
- independent tool permissions;
- cancellation and timeout;
- progress and failure events;
- result aggregation;
- token and cost budgets;
- durable audit history.

Delegation is appropriate only for independent, bounded work. A parent agent is
responsible for verifying delegated results before integration. Child agents
must not recursively spawn unbounded trees or repeat work already owned by
another agent.

The live cluster belongs in the workbench. Cluster defaults belong in Settings.

### Custom agents

Users can define reusable agents for specialized work. A custom agent is a
user-owned configuration, not a hidden system prompt.

A custom agent may define:

- display name and description;
- Code Mode, Work Mode, or mode-independent availability;
- role and user-authored instructions;
- provider and model;
- default reasoning intensity;
- allowed skills;
- allowed and denied tools;
- file, terminal, Git, browser, and network permissions;
- token, cost, time, and retry budgets;
- whether it may delegate to child agents;
- required verification before it reports completion;
- optional fallback agent or fallback model policy.

The model selector must only list models that the user has already added and
that are available through a configured provider. Agent configuration must not
store provider credentials. It stores stable provider and model identifiers and
resolves credentials through secure provider configuration at runtime.

If a selected model is removed, disabled, unavailable, or no longer supports a
required capability, KV Code must not silently substitute another model. It
must show the incompatibility and either request a user decision or apply an
explicit fallback policy that the user previously configured.

Custom agent definitions are shared by Desktop and CLI. Global custom agents
are available in every workspace; project custom agents are stored with project
configuration and are available only in that project. Project definitions may
specialize a global agent without mutating the global source.

The runtime validates custom-agent instructions, context size, tool references,
skill references, model capabilities, budgets, and delegation policy before an
agent starts. The live task tree must show which custom agent, provider, and
model own every running task.

## Agent Conduct

The default system policy must enforce professional, evidence-based behavior.

The model must:

- avoid flattery and manufactured agreement;
- challenge weak assumptions with concrete evidence;
- be honest about observation, inference, failure, and uncertainty;
- never fabricate tool output or verification;
- inspect relevant code and rules before editing;
- fix root causes rather than mask symptoms;
- preserve user-owned changes;
- avoid fake production data and dead controls;
- carry implementation work through verification;
- report blockers precisely;
- avoid claiming that a timeout is a passing test;
- use relevant skills and agent workers when they materially help;
- verify every delegated result.

System prompts should be stable and cache-friendly. Dynamic state belongs in
bounded structured context, not in a constantly rewritten monolithic prompt.

## Visual Direction

KV Code should feel precise, industrial, and alive.

The visual language should use:

- machined metal rather than soft plastic;
- controlled contrast rather than a one-hue palette;
- structural lines, measured highlights, and material depth;
- compact typography appropriate for a professional workbench;
- clear state signals;
- stable geometry;
- purposeful motion;
- restrained color with distinct semantic accents.

The interface should avoid:

- generic AI gradients;
- decorative orbs and glow blobs;
- excessive floating cards;
- cards nested inside cards;
- oversized marketing typography;
- pill-shaped text controls when an icon or standard control is clearer;
- animation that hides latency or blocks interaction;
- one-note dark blue, purple, beige, or orange themes.

Icons should come from a consistent library. Unfamiliar icon controls require
tooltips and accessible names.

## Interaction Quality

Every feature must define:

- loading state;
- empty state;
- success state;
- recoverable error state;
- disabled state;
- cancellation behavior;
- keyboard behavior;
- narrow-window behavior;
- persistence behavior.

Text must not overlap, clip unpredictably, or resize controls. Boards, toolbars,
sliders, counters, terminal regions, and other fixed-format surfaces require
stable dimensions and responsive constraints.

## Security

Security requirements include:

- sandboxed Electron renderer;
- context isolation;
- no remote content with Node integration;
- narrow typed IPC;
- runtime validation on both sides of IPC;
- secure credential storage;
- per-tool permissions;
- explicit project trust and Read-only/Auto/YOLO tool policy;
- path canonicalization;
- command and argument boundaries;
- bounded data transfer;
- secret redaction;
- untrusted browser-content isolation;
- audit logs for consequential actions;
- signed updates before stable distribution.

The application must not rely on obscurity, UI-only permission checks, or a
localhost port without authentication.

## Privacy

KV Code is local-first.

- Sessions, settings, rules, memory, and indexes are local by default.
- Telemetry is disabled by default.
- Crash reporting is opt-in.
- Source code, Git history, terminal output, browser history, memory, and logs
  are not uploaded except when explicitly included in a provider request or a
  user-authorized action.
- The context inspector should show what will be sent to a model.
- Users can export and delete all KV Code data.

## Persistence

SQLite should store durable runtime state behind versioned migrations.

Persistence must support:

- atomic writes;
- crash-safe turn state;
- session recovery;
- migration rollback or recovery guidance;
- bounded logs and indexes;
- project identity independent from display labels;
- data export;
- complete deletion.

Credentials must not be stored in SQLite.

## Performance Budgets

Performance requirements must be measured in CI and representative desktop
hardware. Initial targets are:

| Operation | Target |
| --- | --- |
| Renderer hot update | under 2 seconds for ordinary UI changes |
| Type check after warm start | under 10 seconds |
| Focused unit test run | under 15 seconds |
| Application window visible | under 2 seconds on a warm system |
| Restored session interactive | under 3 seconds |
| Workbench panel switch | under 100 milliseconds |
| Composer input latency | under 16 milliseconds per frame |
| Turn cancellation dispatch | under 100 milliseconds locally |

Large conversations, diffs, logs, task trees, and terminal buffers require
virtualization or incremental rendering. Background browser pages, terminals,
and agents must have explicit lifecycle limits.

Build scripts must not run equivalent type checks twice. Focused checks run by
default; complete matrices run in CI or explicit release verification.

## Context Budgets

Everything sent to a model must be bounded.

- No individual automatically injected fragment may exceed 10,000 tokens.
- Any fragment likely to exceed 1,000 tokens requires explicit design review.
- Git output, terminal output, browser text, rules, memory, skills, diagnostics,
  and attachments each require independent hard limits.
- Truncation must preserve valid structured output where applicable.
- Truncated content must be labeled.
- Context construction must be inspectable in Advanced Settings.

## Testing Strategy

Testing should scale with risk.

### Unit tests

Use unit tests for deterministic domain logic, schemas, parsers, budgets,
provider transformations, permission decisions, and state transitions.

### Integration tests

Use integration tests for provider streams, tool scheduling, approval queues,
SQLite migrations, recovery, memory routing, skills, and worker coordination.

### Desktop end-to-end tests

Use Playwright against the real Electron application for:

- first launch;
- provider configuration;
- real conversation and cancellation;
- terminal interaction;
- Git workflows;
- browser navigation and shared-session tools;
- settings persistence;
- dark and light themes;
- English and Simplified Chinese;
- narrow and large windows;
- reduced motion;
- crash and restart recovery.

Visual changes require screenshot coverage at representative viewports. Canvas
or WebContents-based features require nonblank pixel checks in addition to DOM
assertions.

Tests must not mutate process-wide environment variables when dependency
injection is practical. Network tests use deterministic local fixtures unless a
test is explicitly marked as an external compatibility check.

## Observability

Diagnostics should help developers without leaking user data.

KV Code should provide:

- structured logs with correlation IDs;
- session, turn, tool, and worker identifiers;
- provider timing without credential or prompt leakage;
- cancellation and timeout reasons;
- IPC health;
- queue depth and worker state;
- memory and context sizes;
- performance marks;
- an exportable redacted diagnostic bundle.

No success should be inferred from the absence of an error message. Operations
must report explicit terminal states.

## Packaging and Updates

Desktop and CLI releases must be self-contained. A user should not need
Node.js, a global package, a compiler, or a separately installed daemon.
`pnpm` is only the repository's development and build dependency manager. npm
publication and global npm installation are explicitly not part of the product.

Release requirements include:

- reproducible packaging;
- a clear version source;
- architecture-specific artifacts;
- dependency license collection;
- package size reporting;
- smoke launch tests;
- signed stable builds;
- authenticated update metadata;
- rollback support;
- release notes tied to verified behavior.

Desktop and CLI artifacts will be delivered through KV Code's own installer and
update system. The installed products must not depend on npm, pnpm, or a global
CLI installation at runtime.

## Initial Non-Goals

The rewrite will not initially include:

- compatibility with the removed app-server v1 protocol;
- migration of old rollout or session databases;
- a terminal UI clone;
- cloud task infrastructure;
- social or collaboration features;
- analytics enabled by default;
- real-time voice or WebRTC;
- a marketplace before the skill and permission contracts are stable;
- speculative plugin APIs without real consumers;
- invisible autonomous operation without approval and audit.

These may be reconsidered only when they support a validated user workflow.

## Delivery Plan

### Phase 0: foundation

- workspace and package boundaries;
- formatting, linting, tests, and CI;
- protocol schemas;
- Electron security baseline;
- SQLite migration framework;
- design tokens and theme foundation.

### Phase 1: trusted vertical slice

- provider configuration and secure credentials;
- sessions and real streaming turns;
- stop and recovery;
- terminal tool with approval;
- Git status and diff;
- initial Code Mode workbench;
- production packaging smoke test.

### Phase 2: browser and context

- integrated WebContents browser;
- shared user and AI session;
- CDP tools;
- multimodal screenshots;
- OCR and visual proxy for text-only models;
- prompt-injection boundaries;
- context inspector.

### Phase 3: durable knowledge

- global and project rules;
- global and project AI memory;
- skills;
- Code Mode and Work Mode policy separation;
- import, export, and deletion controls.

### Phase 4: developer workflows

- staging and commits;
- branches and worktrees;
- per-hunk review;
- richer terminal workflows;
- test and diagnostics integration;
- recovery points and audit history.

### Phase 5: agents and Work Mode

- bounded agent cluster;
- task tree and worker budgets;
- result verification;
- document, XML, spreadsheet, PDF, and presentation tools;
- render-based artifact verification.

### Phase 6: hardening

- accessibility audit;
- performance budgets in CI;
- security review;
- signed installers and updates;
- failure injection and recovery tests;
- stable extension contracts.

Each phase must deliver functioning workflows. Later phases must not be used to
excuse dead controls or fake state in earlier releases.

## Definition of Done

A feature is done only when:

1. Its user workflow is complete.
2. Its ownership and process boundary are clear.
3. Inputs and outputs are validated and bounded.
4. Permissions and sensitive data are handled explicitly.
5. Loading, error, cancellation, empty, and recovery states exist.
6. It is keyboard accessible and responsive.
7. Relevant automated tests pass.
8. The real Desktop path has been exercised.
9. Diagnostics are useful and redacted.
10. Documentation describes actual behavior without exaggeration.

## License

KV Code is licensed under the [MIT License](LICENSE).
