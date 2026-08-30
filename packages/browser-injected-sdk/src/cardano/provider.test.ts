import { CardanoProvider, type APIError } from "./provider";

type Request = {
  sender: string;
  target: string;
  channel: string;
  requestId: string;
  method: string;
  params?: unknown;
};

function respond(request: Request, result?: unknown, error?: unknown, origin = window.location.origin) {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin,
      source: window,
      data: {
        sender: "phantom-extension",
        target: "phantom-sdk",
        channel: "cardano",
        requestId: request.requestId,
        result,
        error,
      },
    }),
  );
}

function bridge(handler: (request: Request) => { result?: unknown; error?: unknown }) {
  return jest.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
    const request = message as Request;
    const response = handler(request);
    queueMicrotask(() => respond(request, response.result, response.error));
  });
}

describe("CardanoProvider", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      configurable: true,
      value: jest.fn(() => "ad7a0239-a7df-4a29-9787-821931938b21"),
    });
  });

  afterEach(() => jest.restoreAllMocks());

  test("exposes exact CIP-30 metadata", () => {
    const provider = new CardanoProvider();
    expect(provider.name).toBe("Phantom");
    expect(provider.apiVersion).toBe("1");
    expect(provider.supportedExtensions).toEqual([]);
    expect(Object.isFrozen(provider.supportedExtensions)).toBe(true);
  });

  test("requests extensions and exposes the complete base API", async () => {
    const postMessage = bridge(request => ({
      result: request.method === "enable" ? { enabled: true, extensions: [] } : [],
    }));
    const provider = new CardanoProvider();
    const api = await provider.enable({ extensions: [{ cip: 999 }] });

    expect(postMessage.mock.calls[0][0]).toMatchObject({
      method: "enable",
      params: { extensions: [{ cip: 999 }] },
    });
    expect(await api.getExtensions()).toEqual([]);
    expect(Object.keys(api).sort()).toEqual([
      "getBalance",
      "getChangeAddress",
      "getExtensions",
      "getNetworkId",
      "getRewardAddresses",
      "getUnusedAddresses",
      "getUsedAddresses",
      "getUtxos",
      "signData",
      "signTx",
      "submitTx",
    ]);
  });

  test("forwards CIP-30 arguments without renaming payload", async () => {
    bridge(request => ({
      result: request.method === "enable" ? { enabled: true } : "result",
    }));
    const api = await new CardanoProvider().enable();
    await api.getUtxos("1a64", { page: 2, limit: 10 });
    await api.getUsedAddresses({ page: 0, limit: 5 });
    await api.signTx("84a0", true);
    await api.signData("00", "deadbeef");
    await api.submitTx("84a0");

    const requests = (window.postMessage as jest.Mock).mock.calls.map(([request]) => request);
    expect(requests[1]).toMatchObject({
      method: "getUtxos",
      params: { amount: "1a64", paginate: { page: 2, limit: 10 } },
    });
    expect(requests[2]).toMatchObject({ method: "getUsedAddresses", params: { paginate: { page: 0, limit: 5 } } });
    expect(requests[3]).toMatchObject({ method: "signTx", params: { tx: "84a0", partialSign: true } });
    expect(requests[4]).toMatchObject({ method: "signData", params: { addr: "00", payload: "deadbeef" } });
    expect(requests[5]).toMatchObject({ method: "submitTx", params: { tx: "84a0" } });
  });

  test("preserves structured wallet errors", async () => {
    const expected: APIError = { code: -4, info: "Account changed." };
    bridge(request => (request.method === "enable" ? { result: { enabled: true } } : { error: expected }));
    const api = await new CardanoProvider().enable();
    await expect(api.getNetworkId()).rejects.toEqual(expected);
  });

  test("rejects malformed extension requests locally", async () => {
    const postMessage = jest.spyOn(window, "postMessage");
    await expect(new CardanoProvider().enable({ extensions: [{ cip: 1.5 }] })).rejects.toEqual({
      code: -1,
      info: "Invalid extensions request.",
    });
    expect(postMessage).not.toHaveBeenCalled();
  });

  test("ignores responses from another origin and times out without leaking listeners", async () => {
    const removeEventListener = jest.spyOn(window, "removeEventListener");
    jest.spyOn(window, "postMessage").mockImplementation((message: unknown) => {
      queueMicrotask(() => respond(message as Request, true, undefined, "https://attacker.example"));
    });
    await expect(new CardanoProvider({ requestTimeoutMs: 5 }).isEnabled()).rejects.toThrow(
      "Cardano IPC request timed out: isEnabled",
    );
    expect(removeEventListener).toHaveBeenCalledWith("message", expect.any(Function));
  });
});
