/**
 * In-Game Chat, Dispatch & Communications HUD.
 *
 * Replaces and unifies hud.flash() with an 8-second auto-fading, multi-channel,
 * scrollable message feed. Zero innerHTML is used for message content to ensure
 * XSS safety against untrusted peer payloads.
 */

const MAX_HISTORY = 60;
const FADE_DELAY_MS = 8000;
const FADE_DURATION_MS = 1500;

export class Chat {
  constructor() {
    this.isOpen = false;
    this.onSendCallback = null;
    this.sentHistory = [];
    this.historyIndex = -1;

    this.#build();
    this.post('SYSTEM', 'Welcome to Halstead Bay. Press [Enter] to chat or /help for commands.');
  }

  #build() {
    // Container overlay
    const box = document.createElement('div');
    box.id = 'gta-chat';
    box.style.cssText = `
      position: fixed;
      left: 24px;
      top: 24px;
      width: 440px;
      max-width: calc(100vw - 48px);
      z-index: 85;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      gap: 6px;
    `;

    // Message Feed
    const feed = document.createElement('div');
    feed.id = 'gta-chat-feed';
    feed.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 240px;
      overflow-y: hidden;
      overflow-x: hidden;
      transition: max-height 0.2s ease;
    `;
    box.appendChild(feed);

    // Input Bar (hidden until Enter / Y is pressed)
    const inputWrap = document.createElement('div');
    inputWrap.id = 'gta-chat-input-wrap';
    inputWrap.style.cssText = `
      display: none;
      pointer-events: auto;
      background: rgba(10, 14, 22, 0.92);
      backdrop-filter: blur(14px);
      border: 1px solid rgba(130, 170, 220, 0.4);
      border-radius: 8px;
      padding: 4px 8px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7);
      align-items: center;
      gap: 8px;
    `;

    const channelTag = document.createElement('span');
    channelTag.textContent = 'ALL';
    channelTag.style.cssText = `
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 1px;
      background: rgba(90, 177, 255, 0.25);
      color: #5ab1ff;
      padding: 2px 6px;
      border-radius: 4px;
      user-select: none;
    `;
    inputWrap.appendChild(channelTag);

    const input = document.createElement('input');
    input.id = 'gta-chat-input';
    input.type = 'text';
    input.maxLength = 120;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = 'Type a message or /help...';
    input.style.cssText = `
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: #fff;
      font-size: 13px;
      font-family: inherit;
    `;
    inputWrap.appendChild(input);

    const hint = document.createElement('span');
    hint.textContent = '[ESC]';
    hint.style.cssText = 'font-size: 10px; color: #667; user-select: none;';
    inputWrap.appendChild(hint);

    box.appendChild(inputWrap);
    document.body.appendChild(box);

    this.box = box;
    this.feed = feed;
    this.inputWrap = inputWrap;
    this.input = input;

    // Handle input keyboard navigation
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // prevent bubbling to window game handler

      if (e.code === 'Enter') {
        e.preventDefault();
        this.#submit();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        if (this.sentHistory.length > 0 && this.historyIndex < this.sentHistory.length - 1) {
          this.historyIndex++;
          this.input.value = this.sentHistory[this.sentHistory.length - 1 - this.historyIndex];
        }
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        if (this.historyIndex > 0) {
          this.historyIndex--;
          this.input.value = this.sentHistory[this.sentHistory.length - 1 - this.historyIndex];
        } else if (this.historyIndex === 0) {
          this.historyIndex = -1;
          this.input.value = '';
        }
      }
    });
  }

  onSend(fn) {
    this.onSendCallback = fn;
  }

  open() {
    this.isOpen = true;
    this.inputWrap.style.display = 'flex';
    this.feed.style.maxHeight = '320px';
    this.feed.style.overflowY = 'auto';
    this.#wakeAllMessages();
    setTimeout(() => this.input.focus(), 10);
  }

  close() {
    this.isOpen = false;
    this.inputWrap.style.display = 'none';
    this.input.value = '';
    this.input.blur();
    this.historyIndex = -1;
    this.feed.style.maxHeight = '240px';
    this.feed.style.overflowY = 'hidden';
    this.feed.scrollTop = this.feed.scrollHeight;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  #submit() {
    const raw = this.input.value.trim();
    if (raw.length > 0) {
      this.sentHistory.push(raw);
      if (this.sentHistory.length > 30) this.sentHistory.shift();

      if (this.onSendCallback) {
        this.onSendCallback(raw);
      }
    }
    this.close();
  }

  /**
   * Post a safe message to the chat feed.
   * Uses textContent exclusively -- zero innerHTML.
   *
   * @param {string} channel - 'GLOBAL' | 'DISPATCH' | 'STREET' | 'RADIO' | 'CONTACT' | 'SYSTEM'
   * @param {string} text - The raw text message (capped at 120 chars)
   * @param {string|null} [author] - Optional author name/tag
   */
  post(channel, text, author = null) {
    if (!text) return;
    const cleanText = String(text).slice(0, 120);

    const row = document.createElement('div');
    row.style.cssText = `
      display: flex;
      align-items: baseline;
      gap: 6px;
      font-size: 12.5px;
      line-height: 1.4;
      text-shadow: 0 1px 3px rgba(0,0,0,0.9);
      background: rgba(8, 11, 18, 0.65);
      backdrop-filter: blur(8px);
      padding: 3px 8px;
      border-radius: 5px;
      width: fit-content;
      max-width: 100%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      transition: opacity ${FADE_DURATION_MS}ms ease, transform 0.2s ease;
      opacity: 1;
    `;

    // Channel badge
    const badge = document.createElement('span');
    badge.style.cssText = 'font-size: 10px; font-weight: 800; letter-spacing: 0.5px; flex-shrink: 0;';

    const ch = (channel || 'SYSTEM').toUpperCase();
    if (ch === 'GLOBAL' || ch === 'PEER') {
      badge.textContent = '💬 [PEER]';
      badge.style.color = '#5ab1ff';
    } else if (ch === 'DISPATCH' || ch === 'POLICE') {
      badge.textContent = '🚨 [DISPATCH]';
      badge.style.color = '#ff5555';
    } else if (ch === 'STREET' || ch === 'NPC') {
      badge.textContent = '🏙️ [STREET]';
      badge.style.color = '#ffd166';
    } else if (ch === 'RADIO') {
      badge.textContent = '📻 [RADIO]';
      badge.style.color = '#90e0ef';
    } else if (ch === 'CONTACT' || ch === 'HEIST') {
      badge.textContent = '💼 [CONTACT]';
      badge.style.color = '#06d6a0';
    } else {
      badge.textContent = '⚙️ [SYSTEM]';
      badge.style.color = '#94a3b8';
    }
    row.appendChild(badge);

    // Optional Author tag
    if (author) {
      const authorSpan = document.createElement('span');
      authorSpan.textContent = String(author) + ':';
      authorSpan.style.cssText = 'font-weight: 700; color: #fff; flex-shrink: 0;';
      row.appendChild(authorSpan);
    }

    // Message Body - textContent ONLY for complete XSS safety
    const bodySpan = document.createElement('span');
    bodySpan.textContent = cleanText;
    bodySpan.style.cssText = 'color: #f1f5f9; word-break: break-word;';
    row.appendChild(bodySpan);

    this.feed.appendChild(row);

    // Prune excessive scrollback history
    while (this.feed.children.length > MAX_HISTORY) {
      this.feed.removeChild(this.feed.firstChild);
    }

    // Auto-scroll to latest
    this.feed.scrollTop = this.feed.scrollHeight;

    // Auto-fade timer
    this.#scheduleFade(row);
  }

  #scheduleFade(row) {
    clearTimeout(row._fadeTimer);
    row.style.opacity = '1';

    row._fadeTimer = setTimeout(() => {
      // Don't fade out if chat is currently open and player is reading/typing
      if (!this.isOpen) {
        row.style.opacity = '0';
      }
    }, FADE_DELAY_MS);
  }

  #wakeAllMessages() {
    for (const row of this.feed.children) {
      row.style.opacity = '1';
    }
  }
}
