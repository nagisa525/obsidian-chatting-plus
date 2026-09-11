import {
  Plugin,
  Notice,
  type MarkdownFileInfo,
  type Editor,
  Menu,
  TFile,
  type TAbstractFile,
} from "obsidian";
import type {
  ChatSettings,
  SelectionScope,
  ChatHistoryEntry,
  ConversationRecord,
  ConversationSummary,
} from "./types";
import { DEFAULT_SETTINGS, CHATGPT_OAUTH_DEFAULT_MODEL } from "./types";
import { ChatSettingTab, getModelDisplayName } from "./settings";
import { ObsidianChatView, VIEW_TYPE_CHAT } from "./ui/chat-view";
import { AgentLoop } from "./agent/loop";
import { ChatGPTOAuthStore } from "./auth/chatgptOAuthStore";
import { ChatGPTOAuthService } from "./auth/chatgptOAuth";
import { setChatGPTOAuthService } from "./api/chatgpt-oauth";

const PLUGIN_ID = "chatting-with-ai-plus";

export default class ChatPlugin extends Plugin {
  settings: ChatSettings = DEFAULT_SETTINGS;
  /** Shared agent loop that persists across view open/close cycles */
  agent!: AgentLoop;
  /** ChatGPT OAuth service (used by the chatgpt-oauth provider). */
  chatgptOAuth!: ChatGPTOAuthService;
  /** Chat messages for replaying into the UI when the view reopens */
  chatHistory: ChatHistoryEntry[] = [];
  /** All saved conversations, newest activity first in the History drawer. */
  conversations: ConversationRecord[] = [];
  activeConversationId = "";

  async onload(): Promise<void> {
    await this.loadSettings();

    // Wire ChatGPT OAuth before constructing the agent: the OAuth API client
    // looks up the service via setChatGPTOAuthService().
    const oauthStore = new ChatGPTOAuthStore(this.app);
    this.chatgptOAuth = new ChatGPTOAuthService(oauthStore);
    setChatGPTOAuthService(this.chatgptOAuth);

    this.agent = new AgentLoop(this.app, this.settings);

    // Restore persisted chat history
    await this.loadChatHistory();

    this.addSettingTab(new ChatSettingTab(this.app, this));

    // Register sidebar view (loads deferred by default in v1.7.2+)
    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ObsidianChatView(leaf, this));

    // Ribbon icon (users can hide; commands are the primary access)
    this.addRibbonIcon("message-circle", "Open chat", (evt) => {
      if (evt.type === "contextmenu" || evt.button === 2) {
        // Right-click: show menu with options
        const menu = new Menu();
        menu.addItem((item) =>
          item.setTitle("Open chat").setIcon("message-circle").onClick(() => void this.openChat())
        );
        menu.addItem((item) =>
          item.setTitle("Chat about active note").setIcon("file-text").onClick(() => void this.chatAboutActiveNote())
        );
        menu.addItem((item) =>
          item.setTitle("Copy transcript").setIcon("clipboard").onClick(() => this.shareTranscript())
        );
        menu.showAtMouseEvent(evt);
      } else {
        void this.openChat();
      }
    });

    // ─── Commands ────────────────────────────────────────────────────────

    this.addCommand({
      id: "open-chat",
      name: "Open chat",
      callback: () => void this.openChat(),
    });

    this.addCommand({
      id: "copy-transcript",
      name: "Copy conversation transcript to clipboard",
      callback: () => this.shareTranscript(),
    });

    // Editor command: chat about the current note (only when editor is active)
    this.addCommand({
      id: "chat-about-note",
      name: "Chat about this note",
      editorCallback: (editor: Editor, ctx: MarkdownFileInfo) => {
        void this.openChatWithMessage(`Summarize this note: ${ctx.file?.path ?? "the active document"}`);
      },
    });

    // Editor command: chat about selected text (conditional, only when text is selected)
    this.addCommand({
      id: "send-selection",
      name: "Send selection to chat",
      editorCheckCallback: (checking: boolean, editor: Editor, ctx: MarkdownFileInfo) => {
        const sel = editor.getSelection();
        if (!sel || sel.length === 0) return false;
        if (checking) return true;
        const scope: SelectionScope = { text: sel, filePath: ctx.file?.path ?? "" };
        void this.openChatWithSelection(scope);
        return true;
      },
    });

    // ─── Context menus ──────────────────────────────────────────────────

    // File explorer context menu
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) =>
          item
            .setTitle("Chat about this note")
            .setIcon("message-circle")
            .onClick(() => void this.openChatWithMessage(`Tell me about ${file.path}`))
        );
      })
    );

    // Editor right-click context menu
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, info: MarkdownFileInfo) => {
        const sel = editor.getSelection();
        if (sel && sel.length > 0) {
          menu.addItem((item) =>
            item
              .setTitle("Send selection to chat")
              .setIcon("message-circle")
              .onClick(() => {
                const scope: SelectionScope = { text: sel, filePath: info.file?.path ?? "" };
                void this.openChatWithSelection(scope);
              })
          );
        }
      })
    );
  }

  onunload(): void {
    void this.saveChatHistory();
  }

  // ─── Chat operations ────────────────────────────────────────────────

  /**
   * True if the active provider is configured enough to send a message.
   * - anthropic / openai: an API key is set.
   * - chatgpt-oauth: a credential is present in SecretStorage.
   */
  private isProviderConfigured(): boolean {
    if (this.settings.provider === "chatgpt-oauth") {
      return !!this.chatgptOAuth?.getCredential();
    }
    return !!this.settings.apiKey;
  }

  private notConfiguredMessage(): string {
    if (this.settings.provider === "chatgpt-oauth") {
      return "Connect your ChatGPT account in Chatting with AI Plus settings.";
    }
    return "Please configure your API key in Chatting with AI Plus settings.";
  }

  private async openChat(): Promise<void> {
    if (!this.isProviderConfigured()) {
      new Notice(this.notConfiguredMessage());
      return;
    }
    await this.activateView();
  }

  /** Open chat and immediately send a message */
  private async openChatWithMessage(message: string): Promise<void> {
    if (!this.isProviderConfigured()) {
      new Notice(this.notConfiguredMessage());
      return;
    }
    await this.activateView();
    const view = this.getChatView();
    if (view) {
      window.setTimeout(() => view.sendMessage(message), 100);
    }
  }

  /** Open chat with a selection scope (shows pill, user types their own question) */
  private async openChatWithSelection(selection: SelectionScope): Promise<void> {
    if (!this.isProviderConfigured()) {
      new Notice(this.notConfiguredMessage());
      return;
    }
    await this.activateView();
    const view = this.getChatView();
    if (view) {
      window.setTimeout(() => {
        view.setSelection(selection);
        view.focus();
      }, 100);
    }
  }

  private async chatAboutActiveNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active note.");
      return;
    }
    await this.openChatWithMessage(`Tell me about ${file.path}`);
  }

  /** Open or reveal the chat view in the right sidebar (both desktop and mobile). */
  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_CHAT);

    if (existing.length > 0) {
      await workspace.revealLeaf(existing[0]);
      return;
    }

    // Right sidebar on both desktop and mobile.
    // On mobile, this slides in as a panel from the right edge.
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
      await workspace.revealLeaf(leaf);
    }
  }

  /** Get the active ObsidianChatView using proper instanceof check (deferred view safe) */
  private getChatView(): ObsidianChatView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
    for (const leaf of leaves) {
      if (leaf.view instanceof ObsidianChatView) {
        return leaf.view;
      }
    }
    return null;
  }

  private shareTranscript(): void {
    const view = this.getChatView();
    if (!view) {
      new Notice("No active conversation.");
      return;
    }

    const transcript = view.getTranscript();
    if (!transcript || transcript.endsWith("## Conversation\n\n")) {
      new Notice("Conversation is empty.");
      return;
    }

    navigator.clipboard.writeText(transcript).then(() => {
      new Notice("Transcript copied to clipboard.");
    }).catch(() => {
      new Notice("Failed to copy transcript.");
    });
  }

  // ─── Chat history persistence ─────────────────────────────────────────

  getConversationSummaries(): ConversationSummary[] {
    return this.conversations
      .map(({ id, title, createdAt, updatedAt }) => ({
        id,
        title,
        createdAt,
        updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async createConversation(title: string): Promise<void> {
    const normalizedTitle = title.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!normalizedTitle) return;

    this.snapshotActiveConversation();
    this.agent.abort();
    this.agent.clear();
    this.chatHistory = [];

    const conversation = this.makeEmptyConversation();
    conversation.title = normalizedTitle;
    conversation.customTitle = true;
    this.conversations.unshift(conversation);
    this.activeConversationId = conversation.id;
    this.getChatView()?.showConversation(this.chatHistory);
    await this.writeConversationState();
    this.refreshConversationHistory();
  }

  async selectConversation(id: string): Promise<void> {
    if (!id || id === this.activeConversationId) return;
    const target = this.conversations.find((conversation) => conversation.id === id);
    if (!target) return;

    this.snapshotActiveConversation();
    this.agent.abort();
    this.agent.clear();
    this.chatHistory = target.chatHistory.slice();
    this.agent.importMessages(target.agentMessages.slice());
    this.activeConversationId = target.id;
    this.getChatView()?.showConversation(this.chatHistory);
    await this.writeConversationState();
    this.refreshConversationHistory();
  }

  async renameConversation(id: string, title: string): Promise<void> {
    const conversation = this.conversations.find((item) => item.id === id);
    const normalizedTitle = title.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!conversation || !normalizedTitle) return;

    conversation.title = normalizedTitle;
    conversation.customTitle = true;
    conversation.updatedAt = Date.now();
    await this.writeConversationState();
    this.refreshConversationHistory();
  }

  async deleteConversation(id: string): Promise<void> {
    const index = this.conversations.findIndex((conversation) => conversation.id === id);
    if (index === -1) return;

    this.snapshotActiveConversation();
    const deletingActive = id === this.activeConversationId;
    this.conversations.splice(index, 1);

    if (this.conversations.length === 0) {
      this.conversations.push(this.makeEmptyConversation());
    }

    if (deletingActive) {
      const next = this.conversations
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      this.agent.abort();
      this.agent.clear();
      this.chatHistory = next.chatHistory.slice();
      this.agent.importMessages(next.agentMessages.slice());
      this.activeConversationId = next.id;
      this.getChatView()?.showConversation(this.chatHistory);
    }

    await this.writeConversationState();
    this.refreshConversationHistory();
  }

  async saveChatHistory(): Promise<void> {
    try {
      this.snapshotActiveConversation(true);
      await this.writeConversationState();
      this.refreshConversationHistory();
    } catch {
      // Persistence is best-effort
    }
  }

  private async loadChatHistory(): Promise<void> {
    try {
      const raw = await this.app.vault.adapter.read(this.chatStatePath);
      const state: unknown = JSON.parse(raw);
      if (!isPersistedChatState(state)) throw new Error("Invalid chat history state");

      if (Array.isArray(state.conversations) && state.conversations.length > 0) {
        this.conversations = state.conversations
          .map(normalizeConversation)
          .filter((conversation): conversation is ConversationRecord => conversation !== null);
        const requestedId = typeof state.activeConversationId === "string"
          ? state.activeConversationId
          : "";
        const active = this.conversations.find((conversation) => conversation.id === requestedId)
          ?? this.conversations[0];
        if (active) {
          this.activeConversationId = active.id;
          this.chatHistory = active.chatHistory.slice();
          this.agent.importMessages(active.agentMessages.slice());
        }
      } else {
        // One-time migration from the original single-conversation state.
        const legacyHistory = Array.isArray(state.chatHistory) ? state.chatHistory : [];
        const legacyAgentMessages = Array.isArray(state.agentMessages) ? state.agentMessages : [];
        const migrated = this.makeEmptyConversation();
        migrated.chatHistory = legacyHistory;
        migrated.agentMessages = legacyAgentMessages;
        migrated.title = deriveConversationTitle(migrated.chatHistory);
        this.conversations = [migrated];
        this.activeConversationId = migrated.id;
        this.chatHistory = migrated.chatHistory.slice();
        this.agent.importMessages(migrated.agentMessages.slice());
      }
    } catch {
      // No saved state or parse error — start fresh
    }

    if (this.conversations.length === 0) {
      const initial = this.makeEmptyConversation();
      this.conversations = [initial];
      this.activeConversationId = initial.id;
      this.chatHistory = [];
    }
  }

  private snapshotActiveConversation(touch = false): void {
    let active = this.conversations.find(
      (conversation) => conversation.id === this.activeConversationId
    );
    if (!active) {
      active = this.makeEmptyConversation();
      this.conversations.unshift(active);
      this.activeConversationId = active.id;
    }

    active.chatHistory = this.chatHistory.slice(-100);
    active.agentMessages = this.agent.exportMessages().slice(-80);
    if (!active.customTitle) {
      active.title = deriveConversationTitle(active.chatHistory);
    }
    if (touch) active.updatedAt = Date.now();
  }

  private async writeConversationState(): Promise<void> {
    const state = {
      version: 2,
      activeConversationId: this.activeConversationId,
      conversations: this.conversations.map((conversation) => ({
        ...conversation,
        // Keep image names in lightweight UI history, but avoid a second copy
        // of each base64 image. Agent messages retain multi-turn image context.
        chatHistory: conversation.chatHistory.slice(-100).map(({ images, ...message }) => ({
          ...message,
          imageNames: message.imageNames ?? images?.map((image) => image.name),
        })),
        agentMessages: conversation.agentMessages.slice(-80),
      })),
    };
    await this.app.vault.adapter.write(this.chatStatePath, JSON.stringify(state));
  }

  private refreshConversationHistory(): void {
    this.getChatView()?.updateConversationHistory(
      this.getConversationSummaries(),
      this.activeConversationId
    );
  }

  private makeEmptyConversation(): ConversationRecord {
    const now = Date.now();
    return {
      id: makeConversationId(),
      title: "New conversation",
      createdAt: now,
      updatedAt: now,
      chatHistory: [],
      agentMessages: [],
    };
  }

  // ─── Settings persistence ────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    const saved = normalizeSettings(await this.loadData());
    this.settings = { ...DEFAULT_SETTINGS, ...saved };

    // Fall back to default model if saved model is empty
    if (!this.settings.model) {
      this.settings.model = DEFAULT_SETTINGS.model;
    }

    // Migrate ChatGPT OAuth model slugs that an earlier release wrote with
    // dash-form versions (`gpt-5-5`, `gpt-5-2`, …). The Codex backend only
    // accepts dotted slugs (`gpt-5.5`, `gpt-5.2`, …) and rejects the
    // dash form with HTTP 400. We rewrite in place and persist back.
    if (this.settings.provider === "chatgpt-oauth") {
      const migrated = migrateChatGPTOAuthModelSlug(this.settings.model);
      if (migrated !== this.settings.model) {
        this.settings.model = migrated;
        // Best-effort save; ignore errors during initial load
        this.saveData({ ...this.settings, apiKey: "" }).catch(() => {});
      }
    }

    // Load API key for the current provider from SecretStorage
    this.settings.apiKey = this.loadApiKey(this.settings.provider);
  }

  async saveSettings(): Promise<void> {
    // Store API key in SecretStorage keyed by provider
    this.saveApiKey(this.settings.provider, this.settings.apiKey || "");

    // Save all other settings to data.json (syncs), but strip the API key
    const toSave = { ...this.settings, apiKey: "" };
    await this.saveData(toSave);

    // Update the chat view header with the new model name
    this.getChatView()?.updateModel(
      getModelDisplayName(this.settings.provider, this.settings.model)
    );
  }

  /** Load the correct API key when provider changes */
  reloadApiKeyForProvider(): void {
    this.settings.apiKey = this.loadApiKey(this.settings.provider);
  }

  private loadApiKey(provider: string): string {
    try {
      return this.app.secretStorage.getSecret(`${PLUGIN_ID}-api-key-${provider}`) || "";
    } catch {
      return "";
    }
  }

  private saveApiKey(provider: string, key: string): void {
    try {
      this.app.secretStorage.setSecret(`${PLUGIN_ID}-api-key-${provider}`, key);
    } catch {
      // SecretStorage not available
    }
  }

  private get pluginDataDir(): string {
    return `${this.app.vault.configDir}/plugins/${PLUGIN_ID}`;
  }

  private get chatStatePath(): string {
    return `${this.pluginDataDir}/chat-state.json`;
  }

}

function isPersistedChatState(value: unknown): value is {
  activeConversationId?: string;
  conversations?: unknown[];
  chatHistory?: ChatPlugin["chatHistory"];
  agentMessages?: Parameters<AgentLoop["importMessages"]>[0];
} {
  return typeof value === "object" && value !== null;
}

function normalizeConversation(value: unknown): ConversationRecord | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const now = Date.now();
  const chatHistory = Array.isArray(value.chatHistory)
    ? value.chatHistory as ChatHistoryEntry[]
    : [];
  return {
    id: value.id,
    title: typeof value.title === "string" && value.title.trim()
      ? value.title
      : deriveConversationTitle(chatHistory),
    createdAt: typeof value.createdAt === "number" ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : now,
    customTitle: value.customTitle === true,
    chatHistory,
    agentMessages: Array.isArray(value.agentMessages)
      ? value.agentMessages as ConversationRecord["agentMessages"]
      : [],
  };
}

function deriveConversationTitle(history: ChatHistoryEntry[]): string {
  const firstUser = history.find((message) => message.type === "user");
  if (!firstUser) return "New conversation";

  const imageName = firstUser.imageNames?.[0] ?? firstUser.images?.[0]?.name;
  const rawText = firstUser.text?.trim() ?? "";
  if ((!rawText || rawText === "Please analyze the attached image(s).") && imageName) {
    return `Image · ${imageName}`;
  }

  const compact = rawText.replace(/\s+/g, " ");
  if (!compact) return imageName ? `Image · ${imageName}` : "New conversation";
  return compact.length > 42 ? `${compact.slice(0, 42)}…` : compact;
}

function makeConversationId(): string {
  return window.crypto?.randomUUID?.()
    ?? `conversation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeSettings(value: unknown): Partial<ChatSettings> {
  if (!isRecord(value)) return {};
  const settings: Partial<ChatSettings> = {};
  if (isProvider(value.provider)) settings.provider = value.provider;
  if (typeof value.apiKey === "string") settings.apiKey = value.apiKey;
  if (typeof value.model === "string") settings.model = value.model;
  if (typeof value.maxIterations === "number") settings.maxIterations = value.maxIterations;
  if (typeof value.enableWebSearch === "boolean") settings.enableWebSearch = value.enableWebSearch;
  return settings;
}

function isProvider(value: unknown): value is ChatSettings["provider"] {
  return value === "anthropic" || value === "openai" || value === "chatgpt-oauth";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// ─── Settings migrations ─────────────────────────────────────────────────────

/**
 * Migrate a saved ChatGPT OAuth model slug to a Codex-backend-compatible form.
 *
 * Background: 0.1.0 fetched the model list from `chatgpt.com/backend-api/models`
 * (the chat.com UI catalog) as a fallback. That endpoint returns dash-form
 * slugs like `gpt-5-5`, `gpt-5-2-pro` — which the Codex `/responses` endpoint
 * rejects with HTTP 400 ("model is not supported when using Codex with a
 * ChatGPT account"). 0.1.1+ uses the canonical Codex catalog, but settings
 * persisted before the upgrade still hold the broken slugs.
 *
 * Migration rules:
 *   - `gpt-5-N`           → `gpt-5.N`            (dash to dot version)
 *   - `gpt-5-N-codex`     → `gpt-5.N-codex`
 *   - `gpt-5-N-mini`      → `gpt-5.N-mini`
 *   - any other UI-catalog slug not on the known-good list → reset to the
 *     canonical default (`gpt-5.5`).
 */
const KNOWN_GOOD_OAUTH_SLUGS = new Set([
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2",
]);

function migrateChatGPTOAuthModelSlug(slug: string): string {
  if (!slug) return CHATGPT_OAUTH_DEFAULT_MODEL;
  if (KNOWN_GOOD_OAUTH_SLUGS.has(slug)) return slug;

  // Replace `gpt-5-N` (single-digit version after the model number) with
  // `gpt-5.N`. Tail can be `-codex`, `-mini`, etc. We only touch the version
  // dash, not other dashes — so `gpt-5-mini` (which means a *mini variant*,
  // not a sub-version) stays put and falls through to the default.
  const dashVersion = slug.match(/^gpt-(5)-(\d+)(.*)$/);
  if (dashVersion) {
    const candidate = `gpt-${dashVersion[1]}.${dashVersion[2]}${dashVersion[3]}`;
    if (KNOWN_GOOD_OAUTH_SLUGS.has(candidate)) return candidate;
  }

  // Anything else (gpt-5-mini, gpt-5-5-pro, agent, deep-research, o3, …) isn't
  // valid on the Codex backend. Reset to the safe default.
  return CHATGPT_OAUTH_DEFAULT_MODEL;
}
