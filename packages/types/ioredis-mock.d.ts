declare module 'ioredis-mock' {
  import { Redis } from 'ioredis';
  class IORedisMock extends Redis {
    constructor(options?: Record<string, unknown>);
  }
  export = IORedisMock;
}