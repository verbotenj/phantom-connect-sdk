export { CardanoProvider, type CardanoAPI, type Paginate, type DataSignature } from "./provider";

declare module "../index" {
  interface Phantom {
    cardano: CardanoProvider;
  }
}
