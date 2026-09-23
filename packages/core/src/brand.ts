declare const brandSymbol: unique symbol;

export type Brand<Value, Name extends string> = Value & {
  readonly [brandSymbol]: Name;
};
