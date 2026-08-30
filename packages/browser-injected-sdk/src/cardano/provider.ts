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
  code: 1 | 2;
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
export type PubDRepKey = string;
export type DRepID = string;
export type PubStakeKey = string;
export interface CIP95TxSignError {
  code: 1 | 2 | 3;
  info: string;
}
export interface CIP95API {
  getPubDRepKey(): Promise<PubDRepKey>;
  getUnregisteredPubStakeKeys(): Promise<PubStakeKey[]>;
  signData(addr: string, payload: string): Promise<DataSignature>;
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
  getRegisteredPubStakeKeys?: () => Promise<PubStakeKey[]>;
  cip95?: CIP95API;
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
const CIP95 = 95;

function isExtension(value: unknown): value is Extension {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
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
  private readonly requestTimeoutMs: number;

  constructor(options: CardanoProviderOptions = {}) {
    const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 0) {
      throw new TypeError("requestTimeoutMs must be a non-negative finite number.");
    }
    this.requestTimeoutMs = requestTimeoutMs;
  }

  public get supportedExtensions(): Extension[] {
    return [{ cip: CIP95 }];
  }

  public async isEnabled(): Promise<boolean> {
    return this._sendIPC<boolean>("isEnabled");
  }

  public async enable(options: EnableOptions = {}): Promise<CardanoAPI> {
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
      throw { code: -1, info: "Invalid enable options." } satisfies APIError;
    }
    const extensions = options.extensions ?? [];
    assertExtensions(extensions);
    const response = await this._sendIPC<boolean | EnableResult>("enable", { extensions });
    const enabled = typeof response === "boolean" ? response : response.enabled;
    if (!enabled) throw { code: -3, info: "User declined enablement." } satisfies APIError;
    const enabledExtensions = typeof response === "boolean" ? [] : (response.extensions ?? []).filter(isExtension);
    const cip95Enabled =
      extensions.some(({ cip }) => cip === CIP95) && enabledExtensions.some(({ cip }) => cip === CIP95);

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
    if (cip95Enabled) {
      api.getRegisteredPubStakeKeys = () => this._sendIPC<PubStakeKey[]>("getRegisteredPubStakeKeys");
      api.cip95 = {
        getPubDRepKey: () => this._sendIPC<PubDRepKey>("cip95.getPubDRepKey"),
        getUnregisteredPubStakeKeys: () => this._sendIPC<PubStakeKey[]>("cip95.getUnregisteredPubStakeKeys"),
        signData: (addr: string, payload: string) => this._sendIPC<DataSignature>("cip95.signData", { addr, payload }),
      };
    }
    return api;
  }

  private _sendIPC<T>(method: string, params?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const internalError = (info: string): APIError => ({ code: -2, info });
      let requestId: string;
      try {
        requestId = globalThis.crypto.randomUUID();
      } catch {
        reject(internalError("Secure request ID generation failed."));
        return;
      }
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
      const hasRequestId = (value: unknown): value is Pick<IPCResponse<T>, "requestId"> & Partial<IPCResponse<T>> => {
        if (typeof value !== "object" || value === null) return false;
        const response = value as Partial<IPCResponse<T>>;
        return response.requestId === requestId;
      };
      const isWindowResponse = (value: unknown): value is IPCResponse<T> => {
        if (!hasRequestId(value)) return false;
        return value.sender === "phantom-extension" && value.target === "phantom-sdk" && value.channel === "cardano";
      };
      const handleMessage = (event: MessageEvent) => {
        if (event.source !== window || event.origin !== window.location.origin) return;
        if (isWindowResponse(event.data)) settle(event.data);
      };
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(internalError(`Cardano IPC request timed out: ${method}`));
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
            if (!runtime.lastError && hasRequestId(response)) settle(response as IPCResponse<T>);
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
