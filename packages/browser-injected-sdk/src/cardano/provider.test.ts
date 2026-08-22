/**
 * @file provider.test.ts
 * @description Unit tests for the standard CIP-30 CardanoProvider class.
 */

import { CardanoProvider } from "./provider";

describe("CardanoProvider CIP-30 Unit Tests", () => {
  let provider: CardanoProvider;

  beforeEach(() => {
    // Clear all window message listeners and re-instantiate
    provider = new CardanoProvider();
  });

  test("Should initialize with correct metadata as per CIP-30 specification", () => {
    expect(provider.name).toBe("Phantom");
    expect(provider.apiVersion).toBe("1.0.0");
  });

  test("Should initially report as not enabled (disconnected)", async () => {
    // Mock the window.postMessage interface
    const spy = jest.spyOn(window, "postMessage");
    
    // isEnabled() should resolve to false if no response is received from the extension
    const isEnabledPromise = provider.isEnabled();
    
    // Fast-forward any timers / reject on timeout
    expect(spy).toHaveBeenCalled();
    const isEnabled = await isEnabledPromise;
    expect(isEnabled).toBe(false);
    
    spy.mockRestore();
  });

  test("Should construct standard Cardano API endpoints on successful enablement", async () => {
    const mockApiResult = true;

    // Stub the private _sendIPC method to simulate a successful connection approval
    const ipcMock = jest.spyOn(provider as any, "_sendIPC").mockResolvedValue(mockApiResult);

    const api = await provider.enable();
    
    // Assert all standard CIP-30 methods are mapped and available on the returned API
    expect(api.getNetworkId).toBeDefined();
    expect(api.getBalance).toBeDefined();
    expect(api.getUtxos).toBeDefined();
    expect(api.getChangeAddress).toBeDefined();
    expect(api.getRewardAddresses).toBeDefined();
    expect(api.signTx).toBeDefined();
    expect(api.signData).toBeDefined();
    expect(api.submitTx).toBeDefined();

    ipcMock.mockRestore();
  });

  test("Should propagate CIP-30 methods to IPC messenger correctly", async () => {
    const ipcMock = jest.spyOn(provider as any, "_sendIPC").mockResolvedValue(true);
    
    const api = await provider.enable();

    // Call getNetworkId and check if IPC is triggered with the correct method name
    ipcMock.mockResolvedValue(0); // Return Preview Network ID
    const networkId = await api.getNetworkId();
    expect(networkId).toBe(0);
    expect(ipcMock).toHaveBeenCalledWith("getNetworkId");

    // Call getBalance and check if IPC is triggered
    ipcMock.mockResolvedValue("820000"); // CBOR hex
    const balance = await api.getBalance();
    expect(balance).toBe("820000");
    expect(ipcMock).toHaveBeenCalledWith("getBalance");

    ipcMock.mockRestore();
  });
});
