export enum ErrorCode {
  no_parent = 0,
}

export class RezensentError extends Error {
  static assertInstance(o: unknown): asserts o is RezensentError {
    if (!(o instanceof RezensentError)) {
      throw o;
    }
  }

  constructor(message: string, public code: ErrorCode) {
    super(message);
  }
}
