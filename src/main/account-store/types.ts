export * from "../../shared/types";

export class StoreTamperException extends Error {
  public readonly corruptedFilePath?: string;

  constructor(message: string, corruptedFilePath?: string) {
    super(message);
    this.name = "StoreTamperException";
    this.corruptedFilePath = corruptedFilePath;
    Object.setPrototypeOf(this, StoreTamperException.prototype);
  }
}
