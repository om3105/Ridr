import { createMemoryStorage } from './storage';

// Browser previews deliberately forget credentials on reload and never write them to browser storage.
export const sessionStorage = createMemoryStorage();
