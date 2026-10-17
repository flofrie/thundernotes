/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Minimal types for the Thunderbird MV3 APIs this add-on uses.
// Reference: https://webextension-api.thunderbird.net/en/mv3/
// (@types/thunderbird-webext-browser stops at TB 127 and lacks scripting.messageDisplay.)

declare namespace tb {
  interface SpaceButtonProperties {
    title?: string | null;
    defaultIcons?: string | null;
    badgeText?: string | null;
    badgeBackgroundColor?: string | null;
  }

  interface Event<L extends (...args: any[]) => any> {
    addListener(listener: L): void;
    removeListener(listener: L): void;
  }

  interface Tab {
    id?: number;
    type?: string;
    windowId?: number;
  }

  interface Window {
    id?: number;
    left?: number;
    top?: number;
    width?: number;
    height?: number;
  }

  interface MailFolder {
    id: string;
    accountId?: string;
    path: string;
    name?: string;
    specialUse?: string[];
  }

  interface MessageHeader {
    id: number;
    headerMessageId: string;
    subject: string;
    author: string;
    date: Date;
    folder?: MailFolder;
    tags: string[];
  }

  interface MessagePart {
    partName?: string;
    contentType?: string;
    name?: string;
    headers?: Record<string, string[]>;
    parts?: MessagePart[];
  }

  interface MailAccount {
    id: string;
    name: string;
    type: string;
    rootFolder?: MailFolder;
  }

  interface MessageTag {
    key: string;
    tag: string;
    color: string;
    ordinal: string;
  }

  interface MessageList {
    id: string | null;
    messages: MessageHeader[];
  }

  interface MessageSender {
    tab?: Tab;
    frameId?: number;
    id?: string;
  }

  interface Runtime {
    sendMessage<T = unknown>(message: unknown): Promise<T>;
    openOptionsPage(): Promise<void>;
    getBrowserInfo(): Promise<{ name: string; version: string }>;
    getURL(path: string): string;
    onMessage: Event<(message: any, sender: MessageSender) => Promise<unknown> | undefined | void>;
    onInstalled: Event<(details: { reason: string }) => void>;
  }

  interface Messenger {
    runtime: Runtime;
    /** Our Experiment API (experiments/thundernotes, D19, D26). */
    thundernotes: {
      refreshColumn(): Promise<void>;
      getGlobalSearch(folderId: string): Promise<boolean>;
      setGlobalSearch(folderId: string, include: boolean): Promise<boolean>;
      prepareCarrierFolder(folderId: string): Promise<void>;
      refreshFolder(folderId: string): Promise<void>;
      expungeFolder(folderId: string): Promise<void>;
      deviceName(): Promise<string>;
      focusMessagePane(): Promise<boolean>;
      focusCurrentTab(): Promise<boolean>;
      subscribeCarrierFolder(accountId: string, name: string): Promise<"visible" | "subscribed" | "missing" | "notImap">;
    };
    scripting: {
      messageDisplay: {
        getRegisteredScripts(filter?: { ids?: string[] }): Promise<{ id: string }[]>;
        registerScripts(
          scripts: { id: string; js?: string[]; css?: string[]; runAt?: "document_start" | "document_end" | "document_idle" }[]
        ): Promise<void>;
        unregisterScripts(filter?: { ids?: string[] }): Promise<void>;
      };
    };
    messages: {
      get(messageId: number): Promise<MessageHeader>;
      list(folderId: string): Promise<MessageList>;
      continueList(messageListId: string): Promise<MessageList>;
      query(queryInfo: {
        headerMessageId?: string;
        subject?: string;
        author?: string;
        messagesPerPage?: number;
        autoPaginationTimeout?: number;
      }): Promise<MessageList>;
      abortList?(messageListId: string): Promise<void>;
      update(messageId: number, properties: { tags?: string[]; read?: boolean; flagged?: boolean }): Promise<void>;
      getFull(messageId: number): Promise<MessagePart>;
      getAttachmentFile(messageId: number, partName: string): Promise<File>;
      import(file: File, folderId: string, properties?: { read?: boolean; new?: boolean }): Promise<MessageHeader>;
      delete(messageIds: number[], options?: { deletePermanently?: boolean } | boolean): Promise<void>;
      onNewMailReceived: Event<(folder: MailFolder, messages: MessageList) => void>;
      tags: {
        list(): Promise<MessageTag[]>;
        create(key: string, tag: string, color: string): Promise<string>;
      };
    };
    accounts: {
      get(accountId: string, includeSubFolders?: boolean): Promise<MailAccount | null>;
      list(includeSubFolders?: boolean): Promise<MailAccount[]>;
    };
    folders: {
      getSubFolders(folderId: string, includeSubFolders?: boolean): Promise<MailFolder[]>;
      create(parentFolderId: string, childName: string): Promise<MailFolder>;
      onFolderInfoChanged: Event<(folder: MailFolder, info: object) => void>;
      onDeleted: Event<(folder: MailFolder) => void>;
      onRenamed: Event<(originalFolder: MailFolder, renamedFolder: MailFolder) => void>;
      onMoved: Event<(originalFolder: MailFolder, movedFolder: MailFolder) => void>;
      getParentFolders(folderId: string, includeSubFolders?: boolean): Promise<MailFolder[]>;
    };
    alarms: {
      create(name: string, info: { periodInMinutes?: number; delayInMinutes?: number }): void;
      onAlarm: Event<(alarm: { name: string }) => void>;
    };
    messageDisplay: {
      getDisplayedMessages(tabId?: number): Promise<MessageList>;
      open(properties: { headerMessageId?: string; messageId?: number; location?: "tab" | "window"; active?: boolean }): Promise<Tab>;
    };
    messageDisplayAction: {
      setBadgeText(details: { text: string | null; tabId?: number }): Promise<void>;
      setBadgeBackgroundColor(details: { color: string | null; tabId?: number }): Promise<void>;
      setTitle(details: { title: string | null; tabId?: number }): Promise<void>;
      setIcon(details: { tabId?: number; path?: string; imageData?: Record<number, ImageData> }): Promise<void>;
    };
    menus: {
      create(properties: {
        id: string;
        title: string;
        contexts?: string[];
        type?: "normal" | "checkbox" | "radio" | "separator";
        checked?: boolean;
        visible?: boolean;
        parentId?: string;
        icons?: Record<number, string>;
      }): number | string;
      update(id: string, properties: { title?: string; visible?: boolean; enabled?: boolean; checked?: boolean }): Promise<void>;
      refresh(): Promise<void>;
      removeAll(): Promise<void>;
      onShown: Event<(info: { menuIds: (string | number)[]; contexts: string[] }, tab?: Tab) => void>;
      onClicked: Event<
        (
          info: {
            menuItemId: string | number;
            selectionText?: string;
            checked?: boolean;
            selectedFolders?: MailFolder[];
            selectedMessages?: MessageList;
          },
          tab?: Tab
        ) => void
      >;
    };
    windows: {
      openDefaultBrowser(url: string): Promise<void>;
      create(createData: {
        url?: string;
        type?: "normal" | "popup";
        width?: number;
        height?: number;
        left?: number;
        top?: number;
      }): Promise<Window>;
      get(windowId: number): Promise<Window>;
      getLastFocused(): Promise<Window>;
      update(windowId: number, updateInfo: { focused?: boolean }): Promise<Window>;
    };
    storage: {
      local: {
        get(keys: string | string[]): Promise<Record<string, unknown>>;
        set(items: Record<string, unknown>): Promise<void>;
      };
      onChanged: Event<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void>;
    };
    tabs: {
      sendMessage<T = unknown>(tabId: number, message: unknown): Promise<T>;
      query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
      create(createProperties: { url?: string; active?: boolean; windowId?: number }): Promise<Tab>;
      update(tabId: number, updateProperties: { active?: boolean }): Promise<Tab>;
      getCurrent(): Promise<Tab | undefined>;
    };
    /** A button in the spaces toolbar on the left of the main window (the task view, D38). */
    spaces: {
      create(name: string, tabProperties: string, buttonProperties?: SpaceButtonProperties): Promise<{ id: number }>;
      update(spaceId: number, tabProperties: string, buttonProperties?: SpaceButtonProperties): Promise<void>;
      open(spaceId: number, windowId?: number): Promise<Tab>;
      query(queryInfo: { name?: string }): Promise<{ id: number; name: string }[]>;
    };
    /** The add-on's button in the main toolbar (the task view, D38). */
    action: {
      onClicked: Event<(tab: Tab, info?: { modifiers: string[]; button?: number }) => void>;
      setBadgeText(details: { text: string | null; tabId?: number }): Promise<void>;
      setBadgeBackgroundColor(details: { color: string | null; tabId?: number }): Promise<void>;
      setTitle(details: { title: string | null; tabId?: number }): Promise<void>;
    };
  }
}

declare const messenger: tb.Messenger;
/** Content scripts get `browser`. */
declare const browser: tb.Messenger;
