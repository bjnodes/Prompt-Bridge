const fs = require("node:fs");
const path = require("node:path");

if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(__dirname, "..", ".playwright-browsers");
}

const { chromium } = require("playwright");

class ChatGPTAutomation {
  constructor({ sessionDir, chatUrl }) {
    this.sessionDir = sessionDir;
    this.chatUrl = chatUrl;
    this.context = null;
    this.page = null;
  }

  resetRuntimeState() {
    this.context = null;
    this.page = null;
  }

  clearStaleProfileLocks() {
    const lockNames = ["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"];
    for (const lockName of lockNames) {
      const filePath = path.join(this.sessionDir, lockName);
      if (!fs.existsSync(filePath)) {
        continue;
      }

      try {
        fs.rmSync(filePath, { force: true });
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  isContextUsable() {
    return Boolean(this.context && this.context.pages);
  }

  isPageUsable() {
    return Boolean(this.page && !this.page.isClosed());
  }

  async safeGoto(url) {
    if (!this.isPageUsable()) {
      throw new Error("PAGE_CLOSED");
    }

    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async launchContext() {
    fs.mkdirSync(this.sessionDir, { recursive: true });
    this.clearStaleProfileLocks();

    const launchOptions = {
      headless: false,
      viewport: { width: 1440, height: 960 },
      args: ["--disable-blink-features=AutomationControlled"]
    };

    try {
      this.context = await chromium.launchPersistentContext(this.sessionDir, launchOptions);
    } catch (error) {
      fs.rmSync(this.sessionDir, { recursive: true, force: true });
      fs.mkdirSync(this.sessionDir, { recursive: true });
      this.clearStaleProfileLocks();
      this.context = await chromium.launchPersistentContext(this.sessionDir, launchOptions);
    }

    this.context.on("page", (page) => {
      this.page = page;
    });

    this.context.on("close", () => {
      this.resetRuntimeState();
    });

    this.page = this.context.pages()[0] || (await this.context.newPage());
  }

  async ensureSession() {
    if (!this.isContextUsable() || !this.isPageUsable()) {
      this.resetRuntimeState();
      await this.launchContext();
      return;
    }

    try {
      await this.page.title().catch(() => {
        throw new Error("PAGE_CLOSED");
      });
    } catch {
      this.resetRuntimeState();
      await this.launchContext();
    }
  }

  async start() {
    await this.ensureSession();

    try {
      await this.safeGoto(this.chatUrl);
    } catch {
      this.resetRuntimeState();
      await this.launchContext();
      await this.safeGoto(this.chatUrl);
    }

    return this.getStatus();
  }

  async getStatus() {
    if (!this.isContextUsable() || !this.isPageUsable()) {
      return {
        browserOpen: false,
        loggedIn: false,
        ready: false,
        message: "세션이 시작되지 않았습니다."
      };
    }

    try {
      await this.safeGoto(this.chatUrl);
    } catch {
      this.resetRuntimeState();
      return {
        browserOpen: false,
        loggedIn: false,
        ready: false,
        message: "이전 브라우저 세션이 닫혀 다시 시작이 필요합니다."
      };
    }

    const loggedIn = await this.hasComposer();
    return {
      browserOpen: true,
      loggedIn,
      ready: loggedIn,
      message: loggedIn
        ? "ChatGPT 세션이 준비되었습니다."
        : "브라우저는 열려 있지만 아직 ChatGPT 로그인이 완료되지 않았습니다."
    };
  }

  getComposerSelectors() {
    return [
      "textarea[name='prompt-textarea']:visible",
      "#prompt-textarea:visible",
      "form textarea:visible",
      "textarea:visible",
      "div[contenteditable='true'][data-testid='prompt-textarea']:visible",
      "div[contenteditable='true']:visible"
    ];
  }

  async hasComposer() {
    for (const selector of this.getComposerSelectors()) {
      const locator = this.page.locator(selector).first();
      if ((await locator.count().catch(() => 0)) > 0) {
        return true;
      }
    }
    return false;
  }

  async getComposer() {
    await this.page.waitForLoadState("domcontentloaded");
    await this.page.waitForTimeout(800);

    for (const selector of this.getComposerSelectors()) {
      const locator = this.page.locator(selector).last();
      const count = await locator.count().catch(() => 0);
      if (count > 0) {
        await locator.waitFor({ state: "visible", timeout: 5000 }).catch(() => null);
        if (await locator.isVisible().catch(() => false)) {
          return locator;
        }
      }
    }

    throw new Error("ChatGPT 입력창을 찾지 못했습니다. 로그인 상태와 현재 화면을 확인해 주세요.");
  }

  async countAssistantMessages() {
    const selectors = [
      "[data-message-author-role='assistant']",
      "article[data-testid*='conversation-turn'] [data-message-author-role='assistant']",
      "main article"
    ];

    for (const selector of selectors) {
      const locator = this.page.locator(selector);
      const count = await locator.count().catch(() => 0);
      if (count > 0) {
        return count;
      }
    }

    return 0;
  }

  async extractLastAssistantText() {
    const strategies = [
      () =>
        this.page.evaluate(() => {
          const nodes = Array.from(document.querySelectorAll("[data-message-author-role='assistant']"));
          const texts = nodes.map((node) => node.innerText.trim()).filter(Boolean);
          return texts[texts.length - 1] || "";
        }),
      () =>
        this.page.evaluate(() => {
          const articles = Array.from(document.querySelectorAll("main article"));
          const texts = articles.map((node) => node.innerText.trim()).filter(Boolean);
          return texts[texts.length - 1] || "";
        })
    ];

    for (const strategy of strategies) {
      try {
        const text = await strategy();
        if (text) {
          return text;
        }
      } catch {
        continue;
      }
    }

    return "";
  }

  async waitForResponse(previousCount) {
    let stableText = "";
    let stableRepeats = 0;

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await this.page.waitForTimeout(1000);
      const currentCount = await this.countAssistantMessages();
      const currentText = await this.extractLastAssistantText();

      if (currentCount > previousCount && currentText) {
        if (currentText === stableText) {
          stableRepeats += 1;
        } else {
          stableText = currentText;
          stableRepeats = 0;
        }

        const stopButton = this.page
          .locator("button[aria-label*='Stop'], button[aria-label*='stop'], button[data-testid='stop-button']")
          .first();
        const stopVisible = await stopButton.isVisible().catch(() => false);

        if (!stopVisible && stableRepeats >= 2) {
          return currentText;
        }
      }
    }

    const fallback = await this.extractLastAssistantText();
    if (!fallback) {
      throw new Error("ChatGPT 응답을 읽지 못했습니다.");
    }

    return fallback;
  }

  async setComposerValue(composer, promptText) {
    await composer.scrollIntoViewIfNeeded().catch(() => null);
    const tagName = await composer.evaluate((node) => node.tagName.toLowerCase());

    if (tagName === "textarea") {
      await composer.evaluate((node, value) => {
        node.focus();
        node.value = "";
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.value = value;
        node.dispatchEvent(new Event("input", { bubbles: true }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
      }, promptText);
      return;
    }

    await composer.evaluate((node, value) => {
      node.focus();
      node.textContent = "";
      node.dispatchEvent(new InputEvent("input", { bubbles: true, data: "" }));
      node.textContent = value;
      node.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
    }, promptText);
  }

  async clickSendIfPossible() {
    const sendSelectors = [
      "button[data-testid='send-button']:visible",
      "button[aria-label*='Send']:visible",
      "button[aria-label*='send']:visible"
    ];

    for (const selector of sendSelectors) {
      const button = this.page.locator(selector).last();
      const count = await button.count().catch(() => 0);
      if (count > 0 && (await button.isEnabled().catch(() => false))) {
        await button.click();
        return true;
      }
    }

    return false;
  }

  async getAttachmentInput() {
    const directInput = this.page.locator("input[type='file']").last();
    if ((await directInput.count().catch(() => 0)) > 0) {
      return directInput;
    }

    const attachSelectors = [
      "button[aria-label*='Attach']",
      "button[aria-label*='attach']",
      "button[aria-label*='Upload']",
      "button[aria-label*='upload']",
      "button[data-testid*='attach']",
      "button[data-testid*='upload']"
    ];

    for (const selector of attachSelectors) {
      const button = this.page.locator(selector).last();
      const count = await button.count().catch(() => 0);
      if (count > 0 && (await button.isVisible().catch(() => false))) {
        await button.click().catch(() => null);
        await this.page.waitForTimeout(400);

        const input = this.page.locator("input[type='file']").last();
        if ((await input.count().catch(() => 0)) > 0) {
          return input;
        }
      }
    }

    return null;
  }

  async attachImage(imagePath) {
    if (!imagePath) {
      return;
    }

    const input = await this.getAttachmentInput();
    if (!input) {
      throw new Error("ChatGPT 이미지 첨부 입력을 찾지 못했습니다.");
    }

    await input.setInputFiles(imagePath);
    await this.page.waitForTimeout(1400);
  }

  async sendPrompt(promptText, options = {}) {
    const status = await this.start();
    if (!status.loggedIn) {
      throw new Error("ChatGPT에 로그인된 세션이 필요합니다. 세션 시작 후 브라우저에서 로그인해 주세요.");
    }

    await this.safeGoto(this.chatUrl);

    const composer = await this.getComposer();
    const previousCount = await this.countAssistantMessages();

    if (options.imagePath) {
      await this.attachImage(options.imagePath);
    }

    await this.setComposerValue(composer, promptText);

    const clicked = await this.clickSendIfPossible();
    if (!clicked) {
      await composer.focus();
      await this.page.keyboard.press("Enter");
    }

    return this.waitForResponse(previousCount);
  }
}

module.exports = { ChatGPTAutomation };
