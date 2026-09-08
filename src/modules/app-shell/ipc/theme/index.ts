import { getCurrentThemeMode, setThemeMode, toggleThemeMode } from './handlers';
import { os } from '@orpc/server';

export const theme = os.router({
  getCurrentThemeMode,
  setThemeMode,
  toggleThemeMode,
});
