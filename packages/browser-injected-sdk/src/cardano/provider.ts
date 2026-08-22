/**
 * @file provider.ts
 * @description Standard CIP-30 compliant Cardano bridge provider for Phantom.
 * Delegates ledger methods to the private IPC messenger communicating with the Phantom browser extension.
 * Reference: CIP-0030 | Cardano dApp-Wallet Web Bridge (https://cips.cardano.org/cip/CIP-0030)
 */

import { PHANTOM_ICON } from "@phantom/constants";

/**
 * CIP-30 compliant Paginate parameter.
 */
export interface Paginate {
  page: number;
  limit: number;
}

/**
 * CIP-30 compliant response for signData.
 */
export interface DataSignature {
  /**
   * CBOR-encoded COSE_Sign1 signature string (Hex).
   */
  signature: string;
  /**
   * CBOR-encoded COSE_Key string containing public key (Hex).
   */
  key: string;
}

/**
 * Full CIP-30 API returned upon successful execution of enable().
 */
export interface CardanoAPI {
  /**
   * Returns the network ID: 0 for Testnet/Preprod/Preview, 1 for Mainnet.
   * @returns {Promise<number>} Network ID.
   */
  getNetworkId(): Promise<number>;

  /**
   * Returns the total balance available of the wallet.
   * @returns {Promise<string>} CBOR-encoded Value (Hex).
   */
  getBalance(): Promise<string>;

  /**
   * Returns a list of UTXOs owned by the wallet.
   * @param {string} [amount] Optional hex-encoded CBOR Value to filter UTXOs that can satisfy the amount.
   * @param {Paginate} [paginate] Optional pagination parameters.
   * @returns {Promise<string[] | null>} Array of hex-encoded CBOR TransactionUnspentOutput, or null if empty.
   */
  getUtxos(amount?: string, paginate?: Paginate): Promise<string[] | null>;

  /**
   * Returns the change address of the wallet.
   * @returns {Promise<string>} Hex-encoded CBOR change Address.
   */
  getChangeAddress(): Promise<string>;

  /**
   * Returns the reward/stake addresses associated with the wallet.
   * @returns {Promise<string[]>} Array of hex-encoded CBOR reward/stake Addresses.
   */
  getRewardAddresses(): Promise<string[]>;

  /**
   * Requests the wallet to sign a transaction.
   * @param {string} tx CBOR-encoded TransactionBody or Transaction (Hex).
   * @param {boolean} [partialSign] Set to true if the dApp is doing a multi-sig or partial signing.
   * @returns {Promise<string>} CBOR-encoded TransactionWitnessSet (Hex).
   */
  signTx(tx: string, partialSign?: boolean): Promise<string>;

  /**
   * Requests the wallet to sign generic data using COSE_Sign1.
   * @param {string} addr Address (Hex) or Stake Address (Hex) to sign with.
   * @param {string} sigStructure Arbitrary data payload (Hex).
   * @returns {Promise<DataSignature>} Signed signature payload.
   */
  signData(addr: string, sigStructure: string): Promise<DataSignature>;

  /**
   * Submits a signed transaction to the Cardano network.
   * @param {string} tx CBOR-encoded Transaction (Hex).
   * @returns {Promise<string>} Transaction ID (hash) as hex string.
   */
  submitTx(tx: string): Promise<string>;
}

/**
 * Standard CIP-30 'window.cardano.phantom' bridge class.
 */
export class CardanoProvider {
  /**
   * The name of the wallet provider.
   */
  public readonly name: string = "Phantom";

  /**
   * SVG base64 URL icon of the wallet provider.
   */
  public readonly icon: string = PHANTOM_ICON;

  /**
   * CIP-30 Bridge API Version.
   */
  public readonly apiVersion: string = "1.0.0";

  /**
   * Internal connection state.
   */
  private _isEnabled: boolean = false;

  constructor() {}

  /**
   * Checks if the Phantom Cardano bridge is enabled (connected) to the current site.
   * @returns {Promise<boolean>} True if enabled, false otherwise.
   */
  public async isEnabled(): Promise<boolean> {
    try {
      const isEnabledResult = await this._sendIPC<boolean>("isEnabled");
      this._isEnabled = !!isEnabledResult;
      return this._isEnabled;
    } catch (err) {
      return false;
    }
  }

  /**
   * Enables (connects) the Phantom Cardano bridge for the current site.
   * If successful, returns the full CIP-30 Cardano API.
   * @returns {Promise<CardanoAPI>} Full Cardano API instance.
   */
  public async enable(): Promise<CardanoAPI> {
    const success = await this._sendIPC<boolean>("enable");
    if (!success) {
      throw new Error("CIP-30 Connection Refused: User declined enablement.");
    }
    this._isEnabled = true;

    // Return the standard Cardano API instance
    return {
      getNetworkId: () => this._sendIPC<number>("getNetworkId"),
      getBalance: () => this._sendIPC<string>("getBalance"),
      getUtxos: (amount?: string, paginate?: Paginate) =>
        this._sendIPC<string[] | null>("getUtxos", { amount, paginate }),
      getChangeAddress: () => this._sendIPC<string>("getChangeAddress"),
      getRewardAddresses: () => this._sendIPC<string[]>("getRewardAddresses"),
      signTx: (tx: string, partialSign?: boolean) =>
        this._sendIPC<string>("signTx", { tx, partialSign }),
      signData: (addr: string, sigStructure: string) =>
        this._sendIPC<DataSignature>("signData", { addr, sigStructure }),
      submitTx: (tx: string) => this._sendIPC<string>("submitTx", { tx }),
    };
  }

  /**
   * Sends an IPC message payload to the Phantom extension.
   * Supports both standard window.postMessage and chrome.runtime.sendMessage if available.
   *
   * @private
   * @template T
   * @param {string} method IPC method name.
   * @param {any} [params] Parameters to send.
   * @returns {Promise<T>} Resolves with response from the extension.
   */
  private _sendIPC<T>(method: string, params?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      // Create a unique request ID to match with incoming response
      const requestId = Math.random().toString(36).substring(2, 15);

      const handleMessage = (event: MessageEvent) => {
        // Enforce safety checks on message origin
        if (event.source !== window) return;

        const data = event.data;
        if (
          data &&
          data.sender === "phantom-extension" &&
          data.channel === "cardano" &&
          data.requestId === requestId
        ) {
          window.removeEventListener("message", handleMessage);
          if (data.error) {
            reject(new Error(data.error));
          } else {
            resolve(data.result);
          }
        }
      };

      // Register the event listener to catch the response
      window.addEventListener("message", handleMessage);

      const payload = {
        sender: "phantom-sdk",
        target: "phantom-extension",
        channel: "cardano",
        requestId,
        method,
        params,
      };

      // Attempt to communicate via chrome.runtime if extension context (e.g. content script context)
      if (
        typeof chrome !== "undefined" &&
        chrome.runtime &&
        typeof chrome.runtime.sendMessage === "function"
      ) {
        try {
          chrome.runtime.sendMessage(payload, (response: any) => {
            if (chrome.runtime.lastError) {
              // Fail silently and fall back to postMessage
              window.postMessage(payload, "*");
            } else if (response && response.requestId === requestId) {
              window.removeEventListener("message", handleMessage);
              if (response.error) {
                reject(new Error(response.error));
              } else {
                resolve(response.result);
              }
            }
          });
          return;
        } catch (e) {
          // Fallback to window.postMessage on exception
        }
      }

      // Default fallback: window.postMessage
      window.postMessage(payload, "*");
    });
  }
}
