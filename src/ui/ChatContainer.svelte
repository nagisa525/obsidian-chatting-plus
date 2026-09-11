<script lang="ts">
  import type { App, Component as ObsidianComponent } from "obsidian";
  import { MarkdownRenderer, Notice } from "obsidian";
  import { tick } from "svelte";
  import { normalizeMathMarkdown } from "./math-markdown";
  import type {
    ToolResult,
    SelectionScope,
    ImageAttachment,
    ConversationSummary,
  } from "../types";

  interface ChatMessage {
    id: number;
    type: "user" | "assistant" | "tool-call" | "tool-result" | "error" | "thinking";
    text?: string;
    images?: ImageAttachment[];
    imageNames?: string[];
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: ToolResult;
  }

  interface Props {
    app: App;
    component: ObsidianComponent;
    provider: string;
    model: string;
    conversations: ConversationSummary[];
    activeConversationId: string;
    onSend: (
      text: string,
      selection: SelectionScope | null,
      images: ImageAttachment[]
    ) => void;
    onStop: () => void;
    onNewConversation: (title: string) => void;
    onSelectConversation: (id: string) => void;
    onRenameConversation: (id: string, title: string) => void;
    onDeleteConversation: (id: string) => void;
  }

  let {
    app,
    component,
    provider,
    model,
    conversations,
    activeConversationId,
    onSend,
    onStop,
    onNewConversation,
    onSelectConversation,
    onRenameConversation,
    onDeleteConversation,
  }: Props = $props();

  let displayModel = $state("");
  let messages = $state<ChatMessage[]>([]);
  let inputText = $state("");
  let inputEnabled = $state(true);
  let placeholder = $state("Ask anything...");
  let messagesEl: HTMLElement | undefined = $state();
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let imageInputEl: HTMLInputElement | undefined = $state();
  let images = $state<ImageAttachment[]>([]);
  let historyOpen = $state(false);
  let conversationItems = $state<ConversationSummary[]>([]);
  let selectedConversationId = $state("");
  let editingConversationId = $state("");
  let editingConversationTitle = $state("");
  let renameInputEl: HTMLInputElement | undefined = $state();
  let nextId = 0;
  let scrollRequestId = 0;
  const pendingMarkdownRenders = new Set<Promise<void>>();

  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const NEW_CONVERSATION_DRAFT_ID = "__new-conversation__";
  const SUPPORTED_IMAGE_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ]);

  // Selection scope (shown as a pill above input)
  let selection = $state<SelectionScope | null>(null);

  // ask_user support
  let askUserResolve: ((value: string) => void) | null = $state(null);

  // Sync model prop to local state (also updateable via setModel)
  $effect(() => {
    displayModel = model;
  });

  $effect(() => {
    conversationItems = conversations.map((conversation) => ({ ...conversation }));
    selectedConversationId = activeConversationId;
  });

  // ─── Public API (called from chat-view.ts / chat-modal.ts) ────────────

  export function addUserMessage(
    text: string,
    attachedImages: ImageAttachment[] = [],
    imageNames: string[] = []
  ): void {
    messages.push({
      id: nextId++,
      type: "user",
      text,
      images: attachedImages,
      imageNames: imageNames.length > 0
        ? imageNames
        : attachedImages.map((image) => image.name),
    });
  }

  export function addAssistantMessage(text: string): void {
    messages.push({ id: nextId++, type: "assistant", text });
  }

  export function addToolCall(name: string, input: Record<string, unknown>): number {
    const id = nextId++;
    messages.push({ id, type: "tool-call", toolName: name, toolInput: input });
    return id;
  }

  export function updateToolResult(msgId: number, name: string, result: ToolResult): void {
    const msg = messages.find((m) => m.id === msgId);
    if (msg) {
      msg.type = "tool-result";
      msg.toolName = name;
      msg.toolResult = result;
    }
  }

  export function showThinking(): void {
    // Only add if not already showing
    if (!messages.some((m) => m.type === "thinking")) {
      messages.push({ id: nextId++, type: "thinking" });
    }
  }

  export function hideThinking(): void {
    const idx = messages.findIndex((m) => m.type === "thinking");
    if (idx !== -1) messages.splice(idx, 1);
  }

  export function addError(text: string): void {
    messages.push({ id: nextId++, type: "error", text });
  }

  export function showAskUser(question: string): Promise<string> {
    addAssistantMessage(question);
    placeholder = "Type your answer...";
    inputEnabled = true;
    textareaEl?.focus();

    return new Promise<string>((resolve) => {
      askUserResolve = resolve;
    });
  }

  export function setInputEnabled(enabled: boolean): void {
    inputEnabled = enabled;
    placeholder = enabled ? "Ask anything..." : "Waiting for response...";
  }

  export function clearMessages(): void {
    messages = [];
    selection = null;
    images = [];
    messagesEl?.style.setProperty("--ochatting-scroll-tail", "0px");
    hideThinking();
  }

  export function focus(): void {
    textareaEl?.focus();
  }

  /** Update the model display name in the header */
  export function setModel(name: string): void {
    displayModel = name;
  }

  export function setConversationHistory(
    nextConversations: ConversationSummary[],
    nextActiveConversationId: string
  ): void {
    // Copy records so an external update always produces a visible Svelte update.
    conversationItems = nextConversations.map((conversation) => ({ ...conversation }));
    selectedConversationId = nextActiveConversationId;
  }

  /** Align the latest user question after Markdown and MathJax finish rendering. */
  export function scrollToLastQuestion(
    alignment: "top" | "center" | "bottom" = "top"
  ): void {
    const requestId = ++scrollRequestId;
    void alignLastQuestion(requestId, alignment);
  }

  /** Set the selection scope (shows pill in UI) */
  export function setSelection(sel: SelectionScope): void {
    selection = sel;
  }

  /** Get the current selection scope */
  export function getSelection(): SelectionScope | null {
    return selection;
  }

  /** Clear the selection scope */
  export function clearSelection(): void {
    selection = null;
  }

  // ─── Internal handlers ────────────────────────────────────────────────

  function handleSend(): void {
    const typedText = inputText.trim();
    if (!typedText && images.length === 0) return;

    if (askUserResolve && images.length > 0) {
      new Notice("Image attachments are not supported for follow-up answers yet.");
      return;
    }

    const text = typedText || "Please analyze the attached image(s).";
    const attachedImages = images.map((image) => ({ ...image }));

    inputText = "";
    images = [];
    resetHeight();

    if (askUserResolve) {
      addUserMessage(text);
      const resolve = askUserResolve;
      askUserResolve = null;
      resolve(text);
      return;
    }

    // Pass current selection and consume it (one-shot per send)
    const currentSelection = selection;
    selection = null;
    onSend(text, currentSelection, attachedImages);
  }

  async function alignLastQuestion(
    requestId: number,
    alignment: "top" | "center" | "bottom"
  ): Promise<void> {
    await tick();
    if (pendingMarkdownRenders.size > 0) {
      await Promise.allSettled(Array.from(pendingMarkdownRenders));
    }
    await tick();
    if (requestId !== scrollRequestId || !messagesEl) return;

    requestAnimationFrame(() => {
      if (requestId !== scrollRequestId || !messagesEl) return;
      const questions = messagesEl.querySelectorAll<HTMLElement>(".ochatting-user-msg");
      const lastQuestion = questions.item(questions.length - 1);
      if (!lastQuestion) {
        messagesEl.scrollTop = 0;
        return;
      }

      messagesEl.style.setProperty("--ochatting-scroll-tail", "0px");
      const viewport = messagesEl.getBoundingClientRect();
      const question = lastQuestion.getBoundingClientRect();
      const questionOffset = alignment === "center"
        ? question.top + question.height / 2 - (viewport.top + viewport.height / 2)
        : alignment === "bottom"
          ? question.bottom - viewport.bottom + 8
          : question.top - viewport.top - 8;
      const target = Math.max(0, messagesEl.scrollTop + questionOffset);
      const currentMaximum = Math.max(0, messagesEl.scrollHeight - messagesEl.clientHeight);
      const requiredTail = Math.max(0, target - currentMaximum);
      messagesEl.style.setProperty("--ochatting-scroll-tail", `${requiredTail}px`);
      messagesEl.scrollTo({
        top: target,
        behavior: alignment === "center" ? "smooth" : "auto",
      });
    });
  }

  function handleKeydown(e: KeyboardEvent): void {
    // Keep Obsidian and other plugins from treating Backspace/Delete/Enter as
    // global shortcuts while the composer owns keyboard focus.
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleKeyup(e: KeyboardEvent): void {
    e.stopPropagation();
  }

  function handlePaste(e: ClipboardEvent): void {
    const imageFiles = Array.from(e.clipboardData?.files ?? [])
      .filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    e.preventDefault();
    void addImageFiles(imageFiles);
  }

  function handleImageInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const selected = Array.from(input.files ?? []);
    input.value = "";
    void addImageFiles(selected);
  }

  async function addImageFiles(files: File[]): Promise<void> {
    for (const file of files) {
      if (images.length >= MAX_IMAGES) {
        new Notice(`You can attach up to ${MAX_IMAGES} images per message.`);
        break;
      }
      if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
        new Notice(`Unsupported image type: ${file.name || file.type}`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        new Notice(`${file.name || "Image"} is larger than 8 MB.`);
        continue;
      }

      try {
        const dataUrl = await readFileAsDataUrl(file);
        images.push({
          id: makeImageId(),
          name: file.name || "pasted-image",
          mediaType: file.type,
          dataUrl,
        });
      } catch {
        new Notice(`Could not read ${file.name || "the pasted image"}.`);
      }
    }
  }

  function removeImage(id: string): void {
    const index = images.findIndex((image) => image.id === id);
    if (index !== -1) images.splice(index, 1);
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Image could not be converted to a data URL."));
      reader.onerror = () => reject(reader.error ?? new Error("Image read failed."));
      reader.readAsDataURL(file);
    });
  }

  function makeImageId(): string {
    return globalThis.crypto?.randomUUID?.()
      ?? `image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  async function beginNewConversation(): Promise<void> {
    if (!inputEnabled) return;
    historyOpen = true;
    editingConversationId = NEW_CONVERSATION_DRAFT_ID;
    editingConversationTitle = "";
    await tick();
    renameInputEl?.focus();
  }

  function selectConversation(id: string): void {
    if (!inputEnabled || id === selectedConversationId) return;
    historyOpen = false;
    onSelectConversation(id);
  }

  async function beginRename(e: MouseEvent, conversation: ConversationSummary): Promise<void> {
    e.stopPropagation();
    if (!inputEnabled) return;
    editingConversationId = conversation.id;
    editingConversationTitle = conversation.title;
    await tick();
    renameInputEl?.focus();
    renameInputEl?.select();
  }

  function commitRename(): void {
    if (!editingConversationId) return;
    const id = editingConversationId;
    const title = editingConversationTitle.trim().replace(/\s+/g, " ").slice(0, 80);
    editingConversationId = "";
    editingConversationTitle = "";
    if (!title) return;

    if (id === NEW_CONVERSATION_DRAFT_ID) {
      historyOpen = false;
      onNewConversation(title);
      return;
    }

    // Show the saved name immediately while persistence completes in the plugin.
    const renamedAt = Date.now();
    conversationItems = conversationItems
      .map((conversation) => conversation.id === id
        ? { ...conversation, title, updatedAt: renamedAt }
        : conversation)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    onRenameConversation(id, title);
  }

  function cancelRename(): void {
    editingConversationId = "";
    editingConversationTitle = "";
  }

  function handleRenameKeydown(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelRename();
    }
  }

  function deleteConversation(e: MouseEvent, conversation: ConversationSummary): void {
    e.stopPropagation();
    if (!inputEnabled) return;
    const confirmed = window.confirm(`Delete “${conversation.title}”?`);
    if (confirmed) onDeleteConversation(conversation.id);
  }

  function formatHistoryTime(timestamp: number): string {
    const date = new Date(timestamp);
    const today = new Date();
    const sameDay = date.getFullYear() === today.getFullYear()
      && date.getMonth() === today.getMonth()
      && date.getDate() === today.getDate();
    return new Intl.DateTimeFormat(undefined, sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : { month: "short", day: "numeric" }
    ).format(date);
  }

  function autoGrow(): void {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 300) + "px";
  }

  function resetHeight(): void {
    if (!textareaEl) return;
    textareaEl.style.height = "auto";
  }

  // Render markdown into a DOM node using Obsidian's renderer
  function renderMarkdown(node: HTMLElement, text: string): void {
    node.empty();
    const rendering = MarkdownRenderer.render(
      app,
      normalizeMathMarkdown(text),
      node,
      "",
      component
    );
    pendingMarkdownRenders.add(rendering);
    void rendering.then(
      () => pendingMarkdownRenders.delete(rendering),
      () => pendingMarkdownRenders.delete(rendering)
    );
  }

  // Use action for markdown rendering
  function markdown(node: HTMLElement, text: string) {
    renderMarkdown(node, text);
    return {
      update(newText: string) {
        renderMarkdown(node, newText);
      },
    };
  }

  function formatToolName(name: string): string {
    return name.replace(/_/g, " ");
  }

  function truncate(str: string, max: number): string {
    if (str.length <= max) return str;
    return str.substring(0, max) + "\n... (truncated)";
  }
</script>

<div class="ochatting-container">
  <!-- Header -->
  <div class="ochatting-header">
    <div class="ochatting-header-left">
      <span class="ochatting-header-title">Chat</span>
      <span class="ochatting-header-model">{displayModel || "No model"}</span>
    </div>
    <div class="ochatting-header-actions">
      <button
        class="ochatting-new-shortcut"
        onclick={beginNewConversation}
        disabled={!inputEnabled}
        aria-label="New conversation"
        title="New conversation"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"></path></svg>
      </button>
      <button
        class:ochatting-history-active={historyOpen}
        class="ochatting-history-btn"
        onclick={() => historyOpen = !historyOpen}
        aria-label="Conversation history"
        title="Conversation history"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l3 2"></path></svg>
      </button>
    </div>
  </div>

  <!-- Messages -->
  <div class="ochatting-messages" bind:this={messagesEl}>
    {#each messages as msg (msg.id)}
      {#if msg.type === "user"}
        <div class="ochatting-msg ochatting-user-msg">
          <div class="ochatting-msg-content">{msg.text}</div>
          {#if msg.images && msg.images.length > 0}
            <div class="ochatting-msg-images">
              {#each msg.images as image (image.id)}
                <img src={image.dataUrl} alt={image.name} title={image.name} />
              {/each}
            </div>
          {:else if msg.imageNames && msg.imageNames.length > 0}
            <div class="ochatting-msg-image-names">
              Attached: {msg.imageNames.join(", ")}
            </div>
          {/if}
        </div>

      {:else if msg.type === "assistant"}
        <div class="ochatting-msg ochatting-assistant-msg">
          <div class="ochatting-msg-content" use:markdown={msg.text ?? ""}></div>
        </div>

      {:else if msg.type === "tool-call"}
        <div class="ochatting-tool-call">
          <div class="ochatting-tool-status">
            <span class="ochatting-spinner"></span>
            <span class="ochatting-tool-name">{formatToolName(msg.toolName ?? "")}</span>
          </div>
          <details class="ochatting-tool-details">
            <summary>Parameters</summary>
            <pre class="ochatting-tool-json">{JSON.stringify(msg.toolInput, null, 2)}</pre>
          </details>
        </div>

      {:else if msg.type === "tool-result"}
        <div class="ochatting-tool-call">
          <div class="ochatting-tool-status">
            <span class={msg.toolResult?.isError ? "ochatting-tool-error" : "ochatting-tool-success"}>
              {msg.toolResult?.isError ? "\u2718" : "\u2714"}
            </span>
            <span class="ochatting-tool-name">{formatToolName(msg.toolName ?? "")}</span>
          </div>
          <details class="ochatting-tool-details">
            <summary>{msg.toolResult?.isError ? "Error" : "Result"}</summary>
            <pre class="ochatting-tool-json">{truncate(msg.toolResult?.result ?? "", 2000)}</pre>
          </details>
        </div>

      {:else if msg.type === "error"}
        <div class="ochatting-msg ochatting-error-msg">
          <div class="ochatting-msg-content">{msg.text}</div>
        </div>

      {:else if msg.type === "thinking"}
        <div class="ochatting-thinking">
          <span class="ochatting-dot"></span>
          <span class="ochatting-dot"></span>
          <span class="ochatting-dot"></span>
        </div>
      {/if}
    {/each}
  </div>

  <!-- Selection pill -->
  {#if selection}
    <div class="ochatting-selection-pill">
      <div class="ochatting-selection-content">
        <span class="ochatting-selection-label">Selection from {selection.filePath.split("/").pop()}</span>
        <span class="ochatting-selection-preview">{selection.text.substring(0, 80)}{selection.text.length > 80 ? "..." : ""}</span>
      </div>
      <button
        class="ochatting-selection-dismiss"
        onclick={() => selection = null}
        aria-label="Remove selection"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  {/if}

  {#if images.length > 0}
    <div class="ochatting-attachments" aria-label="Image attachments">
      {#each images as image (image.id)}
        <div class="ochatting-attachment">
          <img src={image.dataUrl} alt={image.name} title={image.name} />
          <button
            type="button"
            class="ochatting-attachment-remove"
            onclick={() => removeImage(image.id)}
            aria-label={`Remove ${image.name}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Input bar -->
  <div class="ochatting-input-bar">
    <input
      bind:this={imageInputEl}
      class="ochatting-image-input"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      multiple
      onchange={handleImageInput}
    />
    <button
      type="button"
      class="ochatting-attach-btn"
      onclick={() => imageInputEl?.click()}
      disabled={!inputEnabled}
      aria-label="Attach images"
      title="Attach images"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
    </button>
    <textarea
      class="ochatting-input"
      bind:this={textareaEl}
      bind:value={inputText}
      {placeholder}
      disabled={!inputEnabled}
      rows="1"
      onkeydown={handleKeydown}
      onkeyup={handleKeyup}
      onpaste={handlePaste}
      oninput={autoGrow}
    ></textarea>
    {#if inputEnabled}
      <button
        class="ochatting-send-btn"
        onclick={handleSend}
        aria-label="Send message"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>
      </button>
    {:else}
      <button
        class="ochatting-send-btn ochatting-stop-btn"
        onclick={onStop}
        aria-label="Stop generation"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="4" y="4" width="16" height="16" rx="2"></rect></svg>
      </button>
    {/if}
  </div>

  {#if historyOpen}
    <button
      class="ochatting-history-backdrop"
      onclick={() => historyOpen = false}
      aria-label="Close conversation history"
    ></button>
    <aside class="ochatting-history-panel" aria-label="Conversation history">
      <div class="ochatting-history-header">
        <div>
          <div class="ochatting-history-eyebrow">WORKSPACE</div>
          <div class="ochatting-history-title">History</div>
        </div>
        <button
          class="ochatting-history-close"
          onclick={() => historyOpen = false}
          aria-label="Close conversation history"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <button
        class="ochatting-new-conversation"
        onclick={beginNewConversation}
        disabled={!inputEnabled || editingConversationId === NEW_CONVERSATION_DRAFT_ID}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
        <span>New conversation</span>
      </button>

      <div class="ochatting-history-list">
        {#if editingConversationId === NEW_CONVERSATION_DRAFT_ID}
          <div class="ochatting-history-item ochatting-history-create-item">
            <div class="ochatting-history-edit-wrap">
              <span class="ochatting-history-create-label">NAME THIS CONVERSATION</span>
              <input
                bind:this={renameInputEl}
                bind:value={editingConversationTitle}
                class="ochatting-history-edit"
                maxlength="80"
                placeholder="Conversation name"
                aria-label="New conversation name"
                onkeydown={handleRenameKeydown}
                onkeyup={(e) => e.stopPropagation()}
                onclick={(e) => e.stopPropagation()}
                onblur={commitRename}
              />
              <span class="ochatting-history-edit-hint">Enter to create · Esc to cancel</span>
            </div>
          </div>
        {/if}

        {#each conversationItems as conversation (conversation.id)}
          <div
            class:ochatting-history-current={conversation.id === selectedConversationId}
            class="ochatting-history-item"
          >
            {#if editingConversationId === conversation.id}
              <div class="ochatting-history-edit-wrap">
                <input
                  bind:this={renameInputEl}
                  bind:value={editingConversationTitle}
                  class="ochatting-history-edit"
                  maxlength="80"
                  aria-label="Conversation name"
                  onkeydown={handleRenameKeydown}
                  onkeyup={(e) => e.stopPropagation()}
                  onclick={(e) => e.stopPropagation()}
                  onblur={commitRename}
                />
                <span class="ochatting-history-edit-hint">Enter to save · Esc to cancel</span>
              </div>
            {:else}
              <button
                class="ochatting-history-select"
                onclick={() => selectConversation(conversation.id)}
                disabled={!inputEnabled}
                aria-current={conversation.id === selectedConversationId ? "page" : undefined}
              >
                <span class="ochatting-history-item-title" title={conversation.title}>
                  {conversation.title || "Untitled conversation"}
                </span>
                <span class="ochatting-history-item-time">{formatHistoryTime(conversation.updatedAt)}</span>
              </button>
              <div class="ochatting-history-item-actions">
                <button
                  class="ochatting-history-rename"
                  onclick={(e) => beginRename(e, conversation)}
                  disabled={!inputEnabled}
                  aria-label={`Rename ${conversation.title}`}
                  title="Rename conversation"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path></svg>
                </button>
                <button
                  class="ochatting-history-delete"
                  onclick={(e) => deleteConversation(e, conversation)}
                  disabled={!inputEnabled}
                  aria-label={`Delete ${conversation.title}`}
                  title="Delete conversation"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5M14 11v5"></path><path d="M9 6V4h6v2"></path></svg>
                </button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </aside>
  {/if}
</div>

<style>
  /* ─── Container ─────────────────────────────────────────────────────── */
  .ochatting-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    position: relative;
    isolation: isolate;
    box-sizing: border-box;
  }

  /* ─── Header ────────────────────────────────────────────────────────── */
  .ochatting-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
    flex-shrink: 0;
  }

  .ochatting-header-left {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .ochatting-header-title {
    font-weight: var(--font-weight-bold, 600);
    font-size: var(--font-ui-medium);
    color: var(--text-normal);
  }

  .ochatting-header-model {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ochatting-header-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .ochatting-new-shortcut,
  .ochatting-history-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    min-width: 30px;
    padding: 0;
    border: none;
    border-radius: var(--radius-s);
    color: var(--text-muted);
    background: transparent;
    box-shadow: none;
    cursor: pointer;
  }

  .ochatting-new-shortcut:hover,
  .ochatting-history-btn:hover,
  .ochatting-history-btn.ochatting-history-active {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }

  .ochatting-new-shortcut:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ─── Conversation History Drawer ──────────────────────────────────── */
  .ochatting-history-backdrop {
    position: absolute;
    inset: 0;
    z-index: 20;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 0;
    background: color-mix(in srgb, var(--background-primary) 38%, transparent);
    backdrop-filter: blur(1px);
    box-shadow: none;
    cursor: default;
  }

  .ochatting-history-panel {
    position: absolute;
    inset: 0 0 0 auto;
    z-index: 21;
    display: flex;
    flex-direction: column;
    width: min(320px, 88%);
    min-width: 230px;
    color: var(--text-normal);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--interactive-accent) 7%, transparent), transparent 150px),
      var(--background-primary);
    border-left: 1px solid var(--background-modifier-border);
    box-shadow: -18px 0 42px color-mix(in srgb, #000 24%, transparent);
    animation: ochatting-history-enter 160ms ease-out;
  }

  @keyframes ochatting-history-enter {
    from { transform: translateX(18px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }

  .ochatting-history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 14px 10px;
  }

  .ochatting-history-eyebrow {
    margin-bottom: 2px;
    color: var(--text-faint);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.16em;
  }

  .ochatting-history-title {
    font-size: var(--font-ui-large);
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  .ochatting-history-close,
  .ochatting-history-rename,
  .ochatting-history-delete {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    color: var(--text-muted);
    background: transparent;
    box-shadow: none;
    cursor: pointer;
  }

  .ochatting-history-close {
    width: 30px;
    height: 30px;
    border-radius: 50%;
  }

  .ochatting-history-close:hover {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }

  .ochatting-new-conversation {
    display: flex;
    align-items: center;
    gap: 9px;
    margin: 4px 12px 12px;
    padding: 9px 11px;
    border: 1px solid color-mix(in srgb, var(--interactive-accent) 45%, var(--background-modifier-border));
    border-radius: var(--radius-m);
    color: var(--text-normal);
    background: color-mix(in srgb, var(--interactive-accent) 10%, var(--background-secondary));
    box-shadow: none;
    cursor: pointer;
    font-size: var(--font-ui-small);
    font-weight: 600;
  }

  .ochatting-new-conversation:hover {
    border-color: var(--interactive-accent);
    background: color-mix(in srgb, var(--interactive-accent) 16%, var(--background-secondary));
  }

  .ochatting-new-conversation:disabled,
  .ochatting-history-select:disabled,
  .ochatting-history-rename:disabled,
  .ochatting-history-delete:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .ochatting-history-list {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
    overflow-y: auto;
    padding: 0 8px 16px;
  }

  .ochatting-history-item {
    position: relative;
    display: flex;
    align-items: stretch;
    border-radius: var(--radius-m);
    overflow: hidden;
  }

  .ochatting-history-item:hover,
  .ochatting-history-item.ochatting-history-current {
    background: var(--background-modifier-hover);
  }

  .ochatting-history-create-item {
    margin-bottom: 5px;
    border: 1px solid color-mix(in srgb, var(--interactive-accent) 42%, var(--background-modifier-border));
    background: color-mix(in srgb, var(--interactive-accent) 7%, var(--background-secondary));
  }

  .ochatting-history-create-label {
    padding-left: 1px;
    color: var(--text-faint);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.11em;
    line-height: 1.2;
  }

  .ochatting-history-item.ochatting-history-current::before {
    content: "";
    position: absolute;
    inset: 9px auto 9px 0;
    width: 2px;
    border-radius: 2px;
    background: var(--interactive-accent);
  }

  .ochatting-history-select {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 9px 7px 9px 11px;
    border: none;
    color: var(--text-normal);
    background: transparent;
    box-shadow: none;
    cursor: pointer;
    text-align: left;
  }

  .ochatting-history-item-title {
    display: block;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-normal) !important;
    font-size: var(--font-ui-small);
    font-weight: 520;
    line-height: 1.35;
    opacity: 1 !important;
  }

  .ochatting-history-item-time {
    flex: 0 0 auto;
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);
    white-space: nowrap;
  }

  .ochatting-history-item-actions {
    display: flex;
    align-items: center;
    gap: 1px;
    flex: 0 0 auto;
    padding-right: 5px;
    opacity: 0;
    transition: opacity 100ms ease-out;
  }

  .ochatting-history-item:hover .ochatting-history-item-actions,
  .ochatting-history-item-actions:focus-within {
    opacity: 1;
  }

  .ochatting-history-rename,
  .ochatting-history-delete {
    width: 28px;
    height: 28px;
    flex: 0 0 28px;
    border-radius: var(--radius-s);
  }

  .ochatting-history-rename:hover {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }

  .ochatting-history-delete:hover {
    color: var(--text-error);
    background: var(--background-modifier-error-hover, var(--background-modifier-hover));
  }

  .ochatting-history-edit-wrap {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding: 6px 8px 7px 10px;
  }

  .ochatting-history-edit {
    width: 100%;
    min-width: 0;
    height: 28px;
    padding: 3px 7px;
    border: 1px solid var(--interactive-accent);
    border-radius: var(--radius-s);
    color: var(--text-normal);
    background: var(--background-primary);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--interactive-accent) 16%, transparent);
    font-family: inherit;
    font-size: var(--font-ui-small);
  }

  .ochatting-history-edit:focus {
    outline: none;
  }

  .ochatting-history-edit-hint {
    padding-left: 1px;
    color: var(--text-faint);
    font-size: 10px;
    line-height: 1.2;
  }

  /* ─── Messages ──────────────────────────────────────────────────────── */
  .ochatting-messages {
    flex: 1 1 0;
    width: 100%;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    overflow-anchor: none;
    scrollbar-gutter: stable;
    touch-action: pan-y;
    -webkit-overflow-scrolling: touch;
    padding: 12px 12px calc(24px + var(--ochatting-scroll-tail, 0px));
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-sizing: border-box;
    contain: inline-size;
    -webkit-user-select: text;
    user-select: text;
  }

  .ochatting-msg {
    max-width: 90%;
    min-width: 0;
    flex-shrink: 0;
    box-sizing: border-box;
    padding: 8px 12px;
    border-radius: var(--radius-m);
    line-height: 1.5;
    overflow-wrap: anywhere;
    -webkit-user-select: text;
    user-select: text;
  }

  .ochatting-msg-content {
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }

  .ochatting-user-msg {
    align-self: flex-end;
    width: fit-content;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-bottom-right-radius: var(--radius-s);
  }

  .ochatting-assistant-msg {
    align-self: flex-start;
    width: 90%;
    background: var(--background-secondary);
    color: var(--text-normal);
    border-bottom-left-radius: var(--radius-s);
  }

  .ochatting-assistant-msg :global(p:first-child) {
    margin-top: 0;
  }

  .ochatting-assistant-msg :global(p:last-child) {
    margin-bottom: 0;
  }

  .ochatting-assistant-msg :global(.math-block) {
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
  }

  .ochatting-assistant-msg :global(mjx-container[display="true"]) {
    min-width: max-content;
    margin: 0.7em 0 !important;
    padding: 2px 0;
  }

  .ochatting-error-msg {
    align-self: flex-start;
    background: var(--background-secondary);
    color: var(--text-error);
    border-left: 3px solid var(--text-error);
    font-size: var(--font-ui-smaller);
    max-width: 90%;
  }

  /* ─── Tool Calls ────────────────────────────────────────────────────── */
  .ochatting-tool-call {
    align-self: flex-start;
    min-width: 0;
    flex-shrink: 0;
    padding: 6px 10px;
    background: var(--background-secondary-alt);
    border-radius: var(--radius-s);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    max-width: 90%;
  }

  .ochatting-tool-status {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .ochatting-tool-name {
    font-weight: 500;
  }

  .ochatting-tool-success {
    color: var(--text-success);
  }

  .ochatting-tool-error {
    color: var(--text-error);
  }

  .ochatting-tool-details {
    margin-top: 4px;
  }

  .ochatting-tool-details summary {
    cursor: pointer;
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);
  }

  .ochatting-tool-json {
    margin: 4px 0 0;
    padding: 6px 8px;
    background: var(--background-primary);
    border-radius: var(--radius-s);
    font-size: 11px;
    max-height: 150px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  /* ─── Spinner ───────────────────────────────────────────────────────── */
  .ochatting-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid var(--text-faint);
    border-top-color: var(--interactive-accent);
    border-radius: 50%;
    animation: ochatting-spin 0.6s linear infinite;
  }

  @keyframes ochatting-spin {
    to { transform: rotate(360deg); }
  }

  /* ─── Thinking Dots ─────────────────────────────────────────────────── */
  .ochatting-thinking {
    align-self: flex-start;
    display: flex;
    flex-shrink: 0;
    gap: 4px;
    padding: 8px 12px;
  }

  .ochatting-dot {
    width: 8px;
    height: 8px;
    background: var(--text-faint);
    border-radius: 50%;
    animation: ochatting-pulse 1.4s ease-in-out infinite;
  }

  .ochatting-dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .ochatting-dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes ochatting-pulse {
    0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
    40% { opacity: 1; transform: scale(1); }
  }

  /* ─── Input Bar ─────────────────────────────────────────────────────── */
  .ochatting-msg-images {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }

  .ochatting-msg-images img {
    display: block;
    width: min(160px, 100%);
    max-height: 180px;
    object-fit: contain;
    border-radius: var(--radius-s);
    background: var(--background-primary);
  }

  .ochatting-msg-image-names {
    margin-top: 6px;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }

  .ochatting-attachments {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 8px 12px 0;
    flex-shrink: 0;
  }

  .ochatting-attachment {
    position: relative;
    width: 58px;
    height: 58px;
    flex: 0 0 58px;
  }

  .ochatting-attachment img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    background: var(--background-secondary);
  }

  .ochatting-attachment-remove {
    position: absolute;
    top: -6px;
    right: -6px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    min-width: 20px;
    min-height: 20px;
    padding: 0;
    border: 1px solid var(--background-modifier-border);
    border-radius: 50%;
    color: var(--text-normal);
    background: var(--background-primary);
    box-shadow: var(--shadow-s);
    cursor: pointer;
  }

  .ochatting-image-input {
    display: none;
  }

  .ochatting-input-bar {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 8px 12px;
    padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--background-modifier-border);
    background: transparent;
    flex-shrink: 0;
  }

  .ochatting-input {
    flex: 1;
    resize: none;
    border: 1.5px solid var(--background-modifier-border-hover, var(--background-modifier-border));
    border-radius: 20px;
    padding: 8px 16px;
    font-size: var(--font-ui-medium);
    font-family: var(--font-interface);
    background-color: var(--background-secondary);
    color: var(--text-normal);
    line-height: 1.4;
    max-height: 300px;
    overflow-y: auto;
    box-shadow: none;
  }

  .ochatting-input:focus {
    outline: none;
    border-color: var(--interactive-accent);
    box-shadow: none;
  }

  .ochatting-input:disabled {
    opacity: 0.5;
  }

  .ochatting-attach-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    min-width: 34px;
    min-height: 34px;
    margin-bottom: 1px;
    padding: 0;
    border: none;
    border-radius: 50%;
    color: var(--text-muted);
    background: transparent;
    box-shadow: none;
    cursor: pointer;
    flex-shrink: 0;
  }

  .ochatting-attach-btn:hover {
    color: var(--text-normal);
    background: var(--background-modifier-hover);
  }

  .ochatting-attach-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ochatting-send-btn {
    width: 34px;
    height: 34px;
    min-width: 34px;
    min-height: 34px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background-color: var(--interactive-accent);
    color: var(--text-on-accent);
    cursor: pointer;
    flex-shrink: 0;
    box-shadow: none;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 1px;
  }

  .ochatting-send-btn:hover {
    background-color: var(--interactive-accent-hover);
  }

  .ochatting-send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ochatting-stop-btn {
    background-color: var(--text-error);
  }

  .ochatting-stop-btn:hover {
    background-color: var(--text-error);
    opacity: 0.85;
  }

  /* ─── Selection Pill ─────────────────────────────────────────────────── */
  .ochatting-selection-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 8px 0;
    padding: 6px 10px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m);
    flex-shrink: 0;
  }

  .ochatting-selection-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ochatting-selection-label {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    font-weight: 500;
  }

  .ochatting-selection-preview {
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ochatting-selection-dismiss {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--background-modifier-hover);
    color: var(--text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .ochatting-selection-dismiss:hover {
    background: var(--background-modifier-border);
    color: var(--text-normal);
  }

  /* ─── Responsive ────────────────────────────────────────────────────── */
  @media (max-width: 768px) {
    .ochatting-history-panel {
      width: min(340px, 94%);
      min-width: 0;
      padding-top: env(safe-area-inset-top, 0px);
    }

    .ochatting-history-item-actions {
      opacity: 1;
    }

    .ochatting-msg {
      max-width: 95%;
    }

    .ochatting-assistant-msg {
      width: 95%;
    }

    .ochatting-input-bar {
      gap: 10px;
      padding: 10px 12px;
      padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
    }

    .ochatting-input {
      font-size: 16px; /* Prevents iOS zoom on focus */
      padding: 10px 16px;
      border-radius: 22px;
    }

    .ochatting-send-btn {
      width: 36px;
      height: 36px;
      min-width: 36px;
      min-height: 36px;
    }

    .ochatting-attach-btn {
      width: 36px;
      height: 36px;
      min-width: 36px;
      min-height: 36px;
    }
  }

  @media (max-width: 390px) {
    .ochatting-header-model {
      display: none;
    }
  }
</style>
