export class HarnessBrewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessBrewError";
  }
}
