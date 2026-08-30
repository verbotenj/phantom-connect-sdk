import { PHANTOM_ICON } from "@phantom/constants";

export interface Paginate {
  page: number;
  limit: number;
}
export interface Extension {
  cip: number;
}
export interface EnableOptions {
  extensions?: Extension[];
}
export interface DataSignature {
  signature: string;
  key: string;
}
export interface APIError {
  code: -1 | -2 | -3 | -4;
  info: string;
}
export interface TxSignError {
  code: 1 | 2 | 3;
  info: string;
}
export interface DataSignError {
  code: 1 | 2 | 3;
  info: string;
}
export interface TxSendError {
  code: 1 | 2;
  info: string;
}
export interface PaginateError {
  maxSize: number;
}

export interface CardanoAPI {
  getExtensions(): Promise<Extension[]>;
  getNetworkId(): Promise<number>;
  getBalance(): Promise<string>;
  getUtxos(amount?: string, paginate?: Paginate): Promise<string[] | null>;
  getUsedAddresses(paginate?: Paginate): Promise<string[]>;
  getUnusedAddresses(): Promise<string[]>;
  getChangeAddress(): Promise<string>;
  getRewardAddresses(): Promise<string[]>;
  signTx(tx: string, partialSign?: boolean): Promise<string>;
  signData(addr: string, payload: string): Promise<DataSignature>;
  submitTx(tx: string): Promise<string>;
}

interface EnableResult {
  enabled: boolean;
  extensions?: Extension[];
}
interface IPCResponse<T> {
  sender: "phantom-extension";
  target: "phantom-sdk";
  channel: "cardano";
  requestId: string;
  result?: T;
  error?: unknown;
}
interface ChromeRuntime {
  lastError?: unknown;
  sendMessage: (payload: unknown, callback: (response?: unknown) => void) => void;
}
export interface CardanoProviderOptions {
  requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function isExtension(value: unknown): value is Extension {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isSafeInteger((value as Extension).cip) &&
    (value as Extension).cip >= 0
  );
}

function assertExtensions(extensions: Extension[]): void {
  if (!Array.isArray(extensions) || !extensions.every(isExtension)) {
    throw { code: -1, info: "Invalid extensions request." } satisfies APIError;
  }
}

export class CardanoProvider {
  public readonly name = "Phantom";
  public readonly icon = PHANTOM_ICON;
  public readonly apiVersion = "1";
  public readonly supportedExtensions: readonly Extension[] = Object.freeze([]);
  private readonly requestTimeoutMs: number;

  constructor(options: CardanoProviderOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  public async isEnabled(): Promise<boolean> {
    return this._sendIPC<boolean>("isEnabled");
  }

  public async enable(options: EnableOptions = {}): Promise<CardanoAPI> {
    const extensions = options.extensions ?? [];
    assertExtensions(extensions);
    const response = await this._sendIPC<boolean | EnableResult>("enable", { extensions });
    const enabled = typeof response === "boolean" ? response : response.enabled;
    if (!enabled) throw { code: -3, info: "User declined enablement." } satisfies APIError;

    const api: CardanoAPI = {
      getExtensions: () => this._sendIPC<Extension[]>("getExtensions"),
      getNetworkId: () => this._sendIPC<number>("getNetworkId"),
      getBalance: () => this._sendIPC<string>("getBalance"),
      getUtxos: (amount?: string, paginate?: Paginate) =>
        this._sendIPC<string[] | null>("getUtxos", { amount, paginate }),
      getUsedAddresses: (paginate?: Paginate) => this._sendIPC<string[]>("getUsedAddresses", { paginate }),
      getUnusedAddresses: () => this._sendIPC<string[]>("getUnusedAddresses"),
      getChangeAddress: () => this._sendIPC<string>("getChangeAddress"),
      getRewardAddresses: () => this._sendIPC<string[]>("getRewardAddresses"),
      signTx: (tx: string, partialSign?: boolean) => this._sendIPC<string>("signTx", { tx, partialSign }),
      signData: (addr: string, payload: string) => this._sendIPC<DataSignature>("signData", { addr, payload }),
      submitTx: (tx: string) => this._sendIPC<string>("submitTx", { tx }),
    };
    return api;
  }

  private _sendIPC<T>(method: string, params?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const requestId = globalThis.crypto.randomUUID();
      let settled = false;
      const cleanup = () => {
        window.removeEventListener("message", handleMessage);
        window.clearTimeout(timeoutId);
      };
      const settle = (response: IPCResponse<T>) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (response.error !== undefined) reject(response.error);
        else resolve(response.result as T);
      };
      const isMatchingResponse = (value: unknown): value is IPCResponse<T> => {
        if (typeof value !== "object" || value === null) return false;
        const response = value as Partial<IPCResponse<T>>;
        return (
          response.sender === "phantom-extension" &&
          response.target === "phantom-sdk" &&
          response.channel === "cardano" &&
          response.requestId === requestId
        );
      };
      const handleMessage = (event: MessageEvent) => {
        if (event.source !== window || event.origin !== window.location.origin) return;
        if (isMatchingResponse(event.data)) settle(event.data);
      };
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Cardano IPC request timed out: ${method}`));
      }, this.requestTimeoutMs);

      window.addEventListener("message", handleMessage);
      const payload = {
        sender: "phantom-sdk",
        target: "phantom-extension",
        channel: "cardano",
        requestId,
        method,
        params,
      };
      const runtime = (globalThis as typeof globalThis & { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
      if (runtime?.sendMessage) {
        try {
          runtime.sendMessage(payload, response => {
            if (!runtime.lastError && isMatchingResponse(response)) settle(response);
            else window.postMessage(payload, window.location.origin);
          });
          return;
        } catch {
          // Use the page bridge when extension messaging is unavailable.
        }
      }
      window.postMessage(payload, window.location.origin);
    });
  }
}
