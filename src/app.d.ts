declare global {
  namespace App {
    interface Locals {
      authed: boolean;
      user: import('better-auth').User | null;
      session: import('better-auth').Session | null;
    }
  }
}
export {};
