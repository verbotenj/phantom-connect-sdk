import type { CardanoProvider as CardanoProviderType } from "./provider";

export {
  CardanoProvider,
  type APIError,
  type CardanoAPI,
  type CardanoProviderOptions,
  type CIP95API,
  type DataSignature,
  type DataSignError,
  type EnableOptions,
  type Extension,
  type Paginate,
  type PaginateError,
  type DRepID,
  type PubDRepKey,
  type PubStakeKey,
  type TxSendError,
  type TxSignError,
} from "./provider";

declare module "../index" {
  interface Phantom {
    cardano: CardanoProviderType;
  }
}
