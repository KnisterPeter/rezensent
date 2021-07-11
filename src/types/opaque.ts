declare const kind: unique symbol;

export type Opaque<K extends string, T> = T & { [kind]: K };
